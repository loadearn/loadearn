import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { recordClick, recordShown, recordView, serveAd } from '@/background/ads';
import { flushQueue } from '@/background/queue';
import { deviceTokenItem, queueItem, settingsItem, statsItem } from '@/background/state';

const TAB = 7;
const TOKEN = `le_${'a'.repeat(43)}`;
const VIEW_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

/** Answers ad requests with `body`. Event uploads fail, so recorded events stay in the queue to be inspected. */
function apiReturns(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/events')) throw new Error('offline');
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

const directAd = {
  ad: { viewId: VIEW_ID, adId: 'ad_1', source: 'direct', advertiser: 'Acme', text: 'Ship faster', url: 'https://acme.example' },
};

const IMPRESSION_URL = 'https://api.adgentek.ai/ad-server/v1/track-impression?cp=19.8&sig=abc';
const CLICK_URL = 'https://api.adgentek.ai/ad-server/v1/click-redirect?sig=abc';
const partnerAd = {
  ad: {
    viewId: VIEW_ID,
    adId: 'creative_1',
    source: 'partner',
    advertiser: 'acme.example',
    text: 'Ship faster',
    url: CLICK_URL,
    impressionUrl: IMPRESSION_URL,
    valueMicros: 11_880,
  },
};

/**
 * Answers ad requests with `body` and event uploads with `answer` for each uploaded event, and
 * returns the uploaded batches.
 */
function apiCredits(body: unknown, answer: { accepted: boolean; earnedMicros?: unknown; reason?: string }): unknown[][] {
  const uploads: unknown[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/ads')) return new Response(JSON.stringify(body));
      if (url.endsWith('/v1/events')) {
        const { events } = JSON.parse(init?.body as string) as { events: { id: string }[] };
        uploads.push(events);
        return new Response(JSON.stringify({ results: events.map((event) => ({ id: event.id, reason: null, ...answer })) }));
      }
      return new Response(null);
    }),
  );
  return uploads;
}

/** Answers ad requests with `body` and counts every other request, which can only be an impression. */
function apiAndPartner(body: unknown): string[] {
  const impressions: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/ads')) return new Response(JSON.stringify(body));
      if (url.endsWith('/v1/events')) throw new Error('offline');
      impressions.push(url);
      return new Response(null);
    }),
  );
  return impressions;
}

describe('ad lifecycle', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await storage.clear('local');
    await storage.clear('session');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await settingsItem.setValue({ consent: true, enabled: true, pausedUntil: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('serves nothing without consent', async () => {
    await settingsItem.setValue({ consent: false, enabled: true, pausedUntil: null });
    expect(await serveAd('chatgpt', TAB)).toBeNull();
  });

  it('serves nothing while paused and resumes afterwards', async () => {
    await settingsItem.setValue({ consent: true, enabled: true, pausedUntil: Date.now() + 60_000 });
    expect(await serveAd('chatgpt', TAB)).toBeNull();
    await settingsItem.setValue({ consent: true, enabled: true, pausedUntil: Date.now() - 1 });
    expect(await serveAd('chatgpt', TAB)).not.toBeNull();
  });

  it('enforces the minimum interval per tab', async () => {
    expect(await serveAd('chatgpt', TAB)).not.toBeNull();
    expect(await serveAd('chatgpt', TAB)).toBeNull();
    expect(await serveAd('chatgpt', TAB + 1)).not.toBeNull();
  });

  it('shows a connect prompt to unlinked browsers and never counts it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ad = await serveAd('claude', TAB);
    expect(ad).toMatchObject({ source: 'house', text: 'Connect your account to start earning' });
    if (!ad) throw new Error('expected an ad');

    vi.advanceTimersByTime(10_000);
    expect(await recordView(ad.viewId, TAB)).toEqual({ earnedUsd: 0 });
    await recordClick(ad.viewId, TAB);

    expect((await statsItem.getValue()).viewsToday).toBe(0);
    expect(await queueItem.getValue()).toEqual([]);
  });

  it('shows nothing to linked browsers when the API has no ad', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ ad: null });
    expect(await serveAd('gemini', TAB)).toBeNull();
  });

  it('asks a browser whose device was disconnected to connect again', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ error: 'unauthorized' }, 401);
    expect(await serveAd('gemini', TAB)).toMatchObject({ source: 'house', text: 'Connect your account to start earning' });
    expect(await deviceTokenItem.getValue()).toBeNull();
  });

  it('keeps the device connected when the API is unavailable', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ error: 'unavailable' }, 503);
    expect(await serveAd('gemini', TAB)).toBeNull();
    expect(await deviceTokenItem.getValue()).toBe(TOKEN);
  });

  it('uploads a view as soon as it is recorded', async () => {
    await deviceTokenItem.setValue(TOKEN);
    const uploads: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/ads')) return new Response(JSON.stringify(directAd));
        uploads.push(JSON.parse(init?.body as string));
        return new Response('{}');
      }),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    await serveAd('chatgpt', TAB);
    vi.advanceTimersByTime(10_000);
    await recordView(VIEW_ID, TAB);

    await vi.waitFor(async () => expect(await queueItem.getValue()).toEqual([]));
    expect(uploads).toEqual([{ events: [expect.objectContaining({ type: 'view', viewId: VIEW_ID })] }]);
  });

  it('records an API ad once, after the dwell time, from the serving tab only', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns(directAd);
    vi.useFakeTimers({ toFake: ['Date'] });

    const ad = await serveAd('chatgpt', TAB);
    expect(ad).toEqual({ viewId: VIEW_ID, source: 'direct', advertiser: 'Acme', text: 'Ship faster', url: 'https://acme.example/' });

    expect(await recordView(VIEW_ID, TAB)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(await recordView(VIEW_ID, TAB + 1)).toBeNull();
    // The upload fails, so nothing is known to be earned and nothing is shown or counted.
    expect(await recordView(VIEW_ID, TAB)).toEqual({ earnedUsd: 0 });
    expect(await recordView(VIEW_ID, TAB)).toBeNull();

    expect((await statsItem.getValue()).viewsToday).toBe(0);
    expect(await queueItem.getValue()).toEqual([
      expect.objectContaining({ type: 'view', viewId: VIEW_ID, adId: 'ad_1', source: 'direct', surface: 'chatgpt' }),
    ]);
  });

  it('records a click on an API ad once', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns(directAd);
    await serveAd('gemini', TAB);
    await recordClick(VIEW_ID, TAB);
    await recordClick(VIEW_ID, TAB);
    expect((await queueItem.getValue()).filter((event) => event.type === 'click')).toHaveLength(1);
  });

  it('gives the page a partner ad without its impression link', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiAndPartner(partnerAd);
    expect(await serveAd('claude', TAB)).toEqual({
      viewId: VIEW_ID,
      source: 'partner',
      advertiser: 'acme.example',
      text: 'Ship faster',
      url: CLICK_URL,
    });
  });

  it('confirms a partner impression once, when the serving tab shows the ad', async () => {
    await deviceTokenItem.setValue(TOKEN);
    const impressions = apiAndPartner(partnerAd);
    await serveAd('claude', TAB);
    expect(impressions).toEqual([]);

    await recordShown(VIEW_ID, TAB + 1);
    await recordShown('0b8f6c2e-7d0a-4c55-9b1e-2f3a4b5c6d7e', TAB);
    expect(impressions).toEqual([]);

    await recordShown(VIEW_ID, TAB);
    await recordShown(VIEW_ID, TAB);
    expect(impressions).toEqual([IMPRESSION_URL]);
  });

  it('does not confirm an impression for an ad shown too late', async () => {
    await deviceTokenItem.setValue(TOKEN);
    const impressions = apiAndPartner(partnerAd);
    vi.useFakeTimers({ toFake: ['Date'] });
    await serveAd('claude', TAB);
    vi.advanceTimersByTime(31 * 60 * 1000);
    await recordShown(VIEW_ID, TAB);
    expect(impressions).toEqual([]);
  });

  it('contacts no one when other ads are shown', async () => {
    await deviceTokenItem.setValue(TOKEN);
    const impressions = apiAndPartner(directAd);
    await serveAd('claude', TAB);
    await recordShown(VIEW_ID, TAB);
    expect(impressions).toEqual([]);
  });

  it('shows exactly what the server credited for a view', async () => {
    await deviceTokenItem.setValue(TOKEN);
    const uploads = apiCredits(directAd, { accepted: true, earnedMicros: 750 });
    vi.useFakeTimers({ toFake: ['Date'] });
    await serveAd('claude', TAB);
    vi.advanceTimersByTime(10_000);
    expect(await recordView(VIEW_ID, TAB)).toEqual({ earnedUsd: 0.00075 });
    expect(await statsItem.getValue()).toMatchObject({ viewsToday: 1, earnedTodayUsd: 0.00075 });
    expect(uploads).toEqual([[expect.objectContaining({ type: 'view', viewId: VIEW_ID, adId: 'ad_1', source: 'direct' })]]);
    expect(await queueItem.getValue()).toEqual([]);
  });

  it('shows nothing for a view the server refused or credited nothing for', async () => {
    await deviceTokenItem.setValue(TOKEN);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const answer of [
      { accepted: false, reason: 'user_daily_cap' },
      { accepted: true, earnedMicros: 0 },
      { accepted: true },
      { accepted: true, earnedMicros: -5 },
      { accepted: true, earnedMicros: 1.5 },
      { accepted: true, earnedMicros: 5_000_000 },
    ]) {
      apiCredits(directAd, answer);
      vi.advanceTimersByTime(60_000);
      await serveAd('claude', TAB);
      vi.advanceTimersByTime(10_000);
      expect(await recordView(VIEW_ID, TAB)).toEqual({ earnedUsd: 0 });
      await storage.clear('session');
      await storage.clear('local');
      await deviceTokenItem.setValue(TOKEN);
      await settingsItem.setValue({ consent: true, enabled: true, pausedUntil: null });
    }
    expect((await statsItem.getValue()).earnedTodayUsd).toBe(0);
  });

  it('never uploads the same events twice at once', async () => {
    await deviceTokenItem.setValue(TOKEN);
    await queueItem.setValue([
      { id: 'a', type: 'click', viewId: VIEW_ID, surface: 'claude', source: 'direct', adId: 'ad_1', occurredAt: 1 },
    ]);
    const uploads = apiCredits(directAd, { accepted: true });
    const [first, second] = await Promise.all([flushQueue(), flushQueue()]);
    expect(uploads).toHaveLength(1);
    expect(first.get('a')).toEqual({ accepted: true, earnedMicros: 0 });
    expect(second.size).toBe(0);
  });

  it('does not count a partner view whose impression was never confirmed', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiAndPartner(partnerAd);
    vi.useFakeTimers({ toFake: ['Date'] });
    await serveAd('claude', TAB);
    vi.advanceTimersByTime(10_000);
    expect(await recordView(VIEW_ID, TAB)).toBeNull();
    expect((await statsItem.getValue()).viewsToday).toBe(0);
    expect(await queueItem.getValue()).toEqual([]);

    await recordShown(VIEW_ID, TAB);
    expect(await recordView(VIEW_ID, TAB)).toEqual({ earnedUsd: 0 });
    expect(await queueItem.getValue()).toEqual([expect.objectContaining({ type: 'view', viewId: VIEW_ID })]);
  });

  it('uploads a queued view as it was recorded', async () => {
    await deviceTokenItem.setValue(TOKEN);
    await queueItem.setValue([
      { id: 'a', type: 'view', viewId: VIEW_ID, surface: 'claude', source: 'partner', adId: 'creative_1', occurredAt: 1 },
    ]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await flushQueue();
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual({
      events: [{ id: 'a', type: 'view', viewId: VIEW_ID, surface: 'claude', source: 'partner', adId: 'creative_1', occurredAt: 1 }],
    });
    expect(await queueItem.getValue()).toEqual([]);
  });
});

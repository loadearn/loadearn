import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { recordClick, recordView, serveAd } from '@/background/ads';
import { deviceTokenItem, queueItem, settingsItem, statsItem } from '@/background/state';

const TAB = 7;
const TOKEN = `le_${'a'.repeat(43)}`;
const VIEW_ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

function apiReturns(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body))));
}

const partnerAd = {
  ad: { viewId: VIEW_ID, adId: 'ad_1', source: 'partner', advertiser: 'Acme', text: 'Ship faster', url: 'https://acme.example' },
};

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

  it('records an API ad once, after the dwell time, from the serving tab only', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns(partnerAd);
    vi.useFakeTimers({ toFake: ['Date'] });

    const ad = await serveAd('chatgpt', TAB);
    expect(ad).toEqual({ viewId: VIEW_ID, source: 'partner', advertiser: 'Acme', text: 'Ship faster', url: 'https://acme.example/' });

    expect(await recordView(VIEW_ID, TAB)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(await recordView(VIEW_ID, TAB + 1)).toBeNull();
    expect(await recordView(VIEW_ID, TAB)).toEqual({ earnedUsd: 0.0012 });
    expect(await recordView(VIEW_ID, TAB)).toBeNull();

    expect((await statsItem.getValue()).viewsToday).toBe(1);
    expect(await queueItem.getValue()).toEqual([
      expect.objectContaining({ type: 'view', viewId: VIEW_ID, adId: 'ad_1', source: 'partner', surface: 'chatgpt' }),
    ]);
  });

  it('records a click on an API ad once', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns(partnerAd);
    await serveAd('gemini', TAB);
    await recordClick(VIEW_ID, TAB);
    await recordClick(VIEW_ID, TAB);
    expect((await queueItem.getValue()).filter((event) => event.type === 'click')).toHaveLength(1);
  });
});

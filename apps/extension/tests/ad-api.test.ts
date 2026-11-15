import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmImpression, parseAdResponse } from '@/background/ad-api';

const ad = {
  viewId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  adId: 'ad_1',
  source: 'direct',
  advertiser: 'Acme',
  text: 'Ship faster with Acme',
  url: 'https://acme.example/?ref=loadearn',
};

const impressionUrl = 'https://api.adgentek.ai/ad-server/v1/track-impression?cp=19.8&sig=abc';
const partnerAd = {
  ...ad,
  source: 'partner',
  url: 'https://api.adgentek.ai/ad-server/v1/click-redirect?sig=abc',
  impressionUrl,
  valueMicros: 11_880,
};

describe('parseAdResponse', () => {
  it('maps a valid ad', () => {
    expect(parseAdResponse({ ad })).toEqual(ad);
  });

  it('returns null when no ad is available or the payload is malformed', () => {
    expect(parseAdResponse({ ad: null })).toBeNull();
    expect(parseAdResponse(null)).toBeNull();
    expect(parseAdResponse({ ad: { ...ad, viewId: 'not-a-uuid' } })).toBeNull();
    expect(parseAdResponse({ ad: { ...ad, source: 'unknown' } })).toBeNull();
  });

  it('rejects non-https destinations', () => {
    expect(parseAdResponse({ ad: { ...ad, url: 'javascript:alert(1)' } })).toBeNull();
    expect(parseAdResponse({ ad: { ...ad, url: 'http://acme.example' } })).toBeNull();
  });

  it('keeps a valid image reference and ignores invalid ones', () => {
    const id = 'b'.repeat(64);
    expect(parseAdResponse({ ad: { ...ad, format: 'banner', imageId: id } })?.imageRef).toEqual({ format: 'banner', id });
    expect(parseAdResponse({ ad: { ...ad, format: 'logo', imageId: '../x' } })?.imageRef).toBeUndefined();
    expect(parseAdResponse({ ad: { ...ad, format: 'video', imageId: id } })?.imageRef).toBeUndefined();
    expect(parseAdResponse({ ad: { ...ad, format: 'text' } })).toEqual(ad);
  });

  it('truncates long copy', () => {
    expect(parseAdResponse({ ad: { ...ad, text: 'x'.repeat(300) } })?.text.length).toBeLessThanOrEqual(90);
  });
});

describe('partner ads', () => {
  it('keeps the partner links and what the view pays', () => {
    const parsed = parseAdResponse({ ad: partnerAd });
    expect(parsed?.url).toBe(partnerAd.url);
    expect(parsed?.partner).toEqual({ impressionUrl, valueUsd: 0.01188 });
  });

  it('keeps a description when there is one', () => {
    expect(parseAdResponse({ ad: { ...partnerAd, detail: 'Free delivery this week.' } })?.detail).toBe('Free delivery this week.');
    expect(parseAdResponse({ ad: { ...partnerAd, detail: 'x'.repeat(300) } })?.detail?.length).toBeLessThanOrEqual(140);
    for (const detail of [undefined, null, '  ', 42, 'x'.repeat(501)]) {
      const parsed = parseAdResponse({ ad: { ...partnerAd, detail } });
      expect(parsed).not.toBeNull();
      expect(parsed && 'detail' in parsed).toBe(false);
    }
  });

  it('drops a partner ad whose links are not the partner\'s', () => {
    expect(parseAdResponse({ ad: { ...partnerAd, impressionUrl: 'https://evil.example/ad-server/v1/track-impression' } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, impressionUrl: undefined } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, url: 'https://acme.example/' } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, url: impressionUrl } })).toBeNull();
  });

  it('drops a partner ad without a sane value', () => {
    expect(parseAdResponse({ ad: { ...partnerAd, valueMicros: undefined } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, valueMicros: -1 } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, valueMicros: 200_001 } })).toBeNull();
    expect(parseAdResponse({ ad: { ...partnerAd, valueMicros: 0 } })?.partner?.valueUsd).toBe(0);
  });

  it('ignores partner fields on other ads', () => {
    expect(parseAdResponse({ ad: { ...ad, impressionUrl, valueMicros: 5 } })).toEqual(ad);
  });
});

describe('confirmImpression', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends one request without cookies from a service worker', async () => {
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    await confirmImpression(impressionUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(impressionUrl);
    expect(init).toMatchObject({ mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  });

  it('loads the link as an image where the background has a DOM', async () => {
    const fetchMock = vi.fn();
    const loaded: string[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      referrerPolicy = '';
      set src(value: string) {
        loaded.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', FakeImage);
    await confirmImpression(impressionUrl);
    expect(loaded).toEqual([impressionUrl]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never contacts anything but the partner\'s impression link', async () => {
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    await confirmImpression('https://evil.example/ad-server/v1/track-impression');
    await confirmImpression('https://api.adgentek.ai/ad-server/v1/click-redirect?sig=abc');
    await confirmImpression('http://api.adgentek.ai/ad-server/v1/track-impression');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(confirmImpression(impressionUrl)).resolves.toBeUndefined();
  });
});

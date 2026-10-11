import { describe, expect, it } from 'vitest';
import { parseAdResponse } from '@/background/ad-api';

const ad = {
  viewId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  adId: 'ad_1',
  source: 'partner',
  advertiser: 'Acme',
  text: 'Ship faster with Acme',
  url: 'https://acme.example/?ref=loadearn',
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

  it('truncates long copy', () => {
    expect(parseAdResponse({ ad: { ...ad, text: 'x'.repeat(300) } })?.text.length).toBeLessThanOrEqual(90);
  });
});

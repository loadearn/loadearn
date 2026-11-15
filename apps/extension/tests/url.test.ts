import { describe, expect, it } from 'vitest';
import { partnerTrackingUrl, resolveApiBase, safeHttpsUrl } from '@/lib/url';

describe('safeHttpsUrl', () => {
  it('accepts https urls', () => {
    expect(safeHttpsUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'https://user:pass@example.com',
    'not a url',
    '',
    42,
    `https://example.com/${'a'.repeat(3000)}`,
  ])('rejects %s', (value) => {
    expect(safeHttpsUrl(value)).toBeNull();
  });
});

describe('resolveApiBase', () => {
  const fallback = 'https://api.loadearn.com';

  it('uses the fallback when unset or insecure', () => {
    expect(resolveApiBase(undefined, fallback, false)).toBe(fallback);
    expect(resolveApiBase('http://evil.example', fallback, true)).toBe(fallback);
  });

  it('allows https origins', () => {
    expect(resolveApiBase('https://staging.loadearn.com/v1', fallback, false)).toBe('https://staging.loadearn.com');
  });

  it('allows localhost only in development', () => {
    expect(resolveApiBase('http://localhost:3000', fallback, true)).toBe('http://localhost:3000');
    expect(resolveApiBase('http://localhost:3000', fallback, false)).toBe(fallback);
  });
});

describe('partnerTrackingUrl', () => {
  const impression = 'https://api.adgentek.ai/ad-server/v1/track-impression?cp=19.8&sig=abc';
  const click = 'https://api.adgentek.ai/ad-server/v1/click-redirect?sig=abc';

  it('accepts the partner links of the right kind', () => {
    expect(partnerTrackingUrl(impression, 'impression')).toBe(impression);
    expect(partnerTrackingUrl(click, 'click')).toBe(click);
  });

  it.each([
    click,
    impression.replace('https:', 'http:'),
    impression.replace('api.adgentek.ai', 'api.adgentek.ai.evil.example'),
    impression.replace('api.adgentek.ai', 'evil.example'),
    impression.replace('api.adgentek.ai', 'user@api.adgentek.ai'),
    impression.replace('api.adgentek.ai', 'api.adgentek.ai:8443'),
    'https://api.adgentek.ai/ad-server/v1/get-ad',
    'javascript:alert(1)',
    null,
  ])('rejects %s as an impression link', (value) => {
    expect(partnerTrackingUrl(value, 'impression')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { resolveApiBase, safeHttpsUrl } from '@/lib/url';

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

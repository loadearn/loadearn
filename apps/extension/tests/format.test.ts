import { describe, expect, it } from 'vitest';
import { formatUsd, truncate } from '@/lib/format';

describe('truncate', () => {
  it('collapses whitespace and shortens long text', () => {
    expect(truncate('  Ship\n\tfaster  ', 20)).toBe('Ship faster');
    expect(truncate('abcdefghij', 5)).toBe('abcd\u2026');
  });

  it('removes control and bidirectional override characters', () => {
    expect(truncate('Acme\u202eevil\u0000 tools\u200b', 40)).toBe('Acme evil tools');
  });
});

describe('formatUsd', () => {
  it('shows sub-dollar amounts with four decimals', () => {
    expect(formatUsd(0.0012 * 3)).toBe('$0.0036');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });
});

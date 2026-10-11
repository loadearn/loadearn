import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from '@/lib/config';

type Mutable = {
  [key: string]: unknown;
  sites: Record<string, { generating: string[] }>;
};

const clone = (): Mutable => structuredClone(DEFAULT_CONFIG) as unknown as Mutable;

describe('parseConfig', () => {
  it('accepts the bundled defaults', () => {
    expect(parseConfig(clone())).toEqual(DEFAULT_CONFIG);
  });

  it('rejects out-of-range limits', () => {
    expect(parseConfig({ ...clone(), minDwellMs: 1_000 })).toBeNull();
    expect(parseConfig({ ...clone(), dailyViewCap: 5_000 })).toBeNull();
  });

  it('rejects missing or oversized selectors', () => {
    const missing = clone();
    delete missing.sites.claude;
    expect(parseConfig(missing)).toBeNull();

    const oversized = clone();
    oversized.sites.chatgpt!.generating = ['a'.repeat(500)];
    expect(parseConfig(oversized)).toBeNull();
  });
});

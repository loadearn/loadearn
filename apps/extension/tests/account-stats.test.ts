import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from 'wxt/utils/storage';
import { fetchAccountStats } from '@/background/ad-api';
import { deviceTokenItem, queueItem } from '@/background/state';

const TOKEN = `le_${'a'.repeat(43)}`;

function apiReturns(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status })));
}

describe('fetchAccountStats', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await storage.clear('local');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns nothing for unlinked browsers', async () => {
    expect(await fetchAccountStats()).toBeNull();
  });

  it('adds views still waiting in the upload queue to the server totals', async () => {
    await deviceTokenItem.setValue(TOKEN);
    await queueItem.setValue([
      { id: 'a', type: 'view', viewId: 'v1', surface: 'chatgpt', source: 'partner', adId: 'x', occurredAt: Date.now() },
      { id: 'b', type: 'view', viewId: 'v2', surface: 'claude', source: 'house', adId: 'y', occurredAt: Date.now() },
      { id: 'c', type: 'click', viewId: 'v1', surface: 'chatgpt', source: 'partner', adId: 'x', occurredAt: Date.now() },
    ]);
    apiReturns({ viewsToday: 4, earnedTodayMicros: 2400, pendingMicros: 2400, lifetimeMicros: 10000, payoutMinimumMicros: 5_000_000 });

    expect(await fetchAccountStats()).toEqual({
      viewsToday: 6,
      earnedTodayUsd: 0.0024 + 0.0012,
      lifetimeUsd: 0.01 + 0.0012,
      payoutMinimumUsd: 5,
    });
  });

  it('falls back to null when the server fails or returns bad data', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ error: 'unavailable' }, 503);
    expect(await fetchAccountStats()).toBeNull();
    apiReturns({ viewsToday: -1, earnedTodayMicros: 0, lifetimeMicros: 0 });
    expect(await fetchAccountStats()).toBeNull();
  });
});

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
    apiReturns({
      viewsToday: 4,
      earnedTodayMicros: 2400,
      pendingMicros: 2400,
      availableMicros: 5000,
      lifetimeMicros: 10000,
      payoutMinimumMicros: 5_000_000,
    });

    expect(await fetchAccountStats()).toEqual({
      viewsToday: 6,
      earnedTodayUsd: 0.0024 + 0.0012,
      lifetimeUsd: 0.01 + 0.0012,
      balanceUsd: 0.0074 + 0.0012,
      availableUsd: 0.005,
      payoutMinimumUsd: 5,
    });
  });

  it('counts a queued partner view at what it pays', async () => {
    await deviceTokenItem.setValue(TOKEN);
    await queueItem.setValue([
      { id: 'a', type: 'view', viewId: 'v1', surface: 'chatgpt', source: 'partner', adId: 'x', occurredAt: Date.now(), valueUsd: 0.01188 },
      { id: 'b', type: 'view', viewId: 'v2', surface: 'claude', source: 'direct', adId: 'y', occurredAt: Date.now() },
    ]);
    apiReturns({ viewsToday: 0, earnedTodayMicros: 0, pendingMicros: 0, availableMicros: 0, lifetimeMicros: 0, payoutMinimumMicros: 5_000_000 });

    const stats = await fetchAccountStats();
    expect(stats?.viewsToday).toBe(2);
    expect(stats?.earnedTodayUsd).toBeCloseTo(0.01188 + 0.0012);
    expect(stats?.lifetimeUsd).toBeCloseTo(0.01188 + 0.0012);
  });

  it('never shows a negative balance', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ viewsToday: 0, earnedTodayMicros: 0, pendingMicros: 1000, availableMicros: -4000, lifetimeMicros: 0, payoutMinimumMicros: 5_000_000 });
    expect(await fetchAccountStats()).toMatchObject({ balanceUsd: 0, availableUsd: 0 });
  });

  it('forgets a device the server no longer accepts', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ error: 'unauthorized' }, 401);
    expect(await fetchAccountStats()).toBeNull();
    expect(await deviceTokenItem.getValue()).toBeNull();
  });

  it('falls back to null when the server fails or returns bad data', async () => {
    await deviceTokenItem.setValue(TOKEN);
    apiReturns({ error: 'unavailable' }, 503);
    expect(await fetchAccountStats()).toBeNull();
    apiReturns({ viewsToday: -1, earnedTodayMicros: 0, lifetimeMicros: 0 });
    expect(await fetchAccountStats()).toBeNull();
  });
});

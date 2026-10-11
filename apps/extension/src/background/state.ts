import { storage } from 'wxt/utils/storage';
import type { ClientConfig, Settings, Stats } from '@/lib/types';
import type { AdEvent } from './queue';

export interface PendingView {
  viewId: string;
  tabId: number;
  servedAt: number;
  viewedAt: number | null;
  clickedAt: number | null;
  tracked: boolean;
  event: Omit<AdEvent, 'id' | 'type' | 'occurredAt'>;
}

export interface CachedConfig {
  fetchedAt: number;
  config: ClientConfig;
}

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { consent: false, enabled: true, pausedUntil: null },
});

export const statsItem = storage.defineItem<Stats>('local:stats', {
  fallback: { day: '', viewsToday: 0, earnedTodayUsd: 0, viewsTotal: 0, earnedTotalUsd: 0 },
});

export const queueItem = storage.defineItem<AdEvent[]>('local:queue', { fallback: [] });

export const configItem = storage.defineItem<CachedConfig | null>('local:config', { fallback: null });

export const installIdItem = storage.defineItem<string>('local:installId', {
  init: () => crypto.randomUUID(),
});

export const deviceTokenItem = storage.defineItem<string | null>('local:deviceToken', { fallback: null });

export const pendingItem = storage.defineItem<Record<string, PendingView>>('session:pending', { fallback: {} });

export const lastServeItem = storage.defineItem<Record<string, number>>('session:lastServe', { fallback: {} });

export function dayKey(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-CA');
}

export function rollStats(stats: Stats, now: number): Stats {
  const day = dayKey(now);
  return stats.day === day ? stats : { ...stats, day, viewsToday: 0, earnedTodayUsd: 0 };
}

export function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export const withLock = createLock();

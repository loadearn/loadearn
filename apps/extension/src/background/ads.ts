import { CONNECT_URL } from '@/lib/env';
import type { Ad, Settings, StateSnapshot, Surface } from '@/lib/types';
import { fetchAd } from './ad-api';
import { enqueue } from './queue';
import { getConfig } from './remote-config';
import {
  deviceTokenItem,
  lastServeItem,
  pendingItem,
  rollStats,
  settingsItem,
  statsItem,
  withLock,
  type PendingView,
} from './state';

const PENDING_TTL_MS = 60 * 60 * 1000;
const MAX_VIEW_DELAY_MS = 30 * 60 * 1000;

const CONNECT_PROMPT = {
  advertiser: 'LoadEarn',
  text: 'Connect your account to start earning',
  url: CONNECT_URL,
};

function prunePending(pending: Record<string, PendingView>, now: number): Record<string, PendingView> {
  return Object.fromEntries(Object.entries(pending).filter(([, view]) => now - view.servedAt < PENDING_TTL_MS));
}

export function isPaused(settings: Settings, now: number): boolean {
  return settings.pausedUntil !== null && settings.pausedUntil > now;
}

export async function getSnapshot(): Promise<StateSnapshot> {
  const [settings, stats, token] = await Promise.all([
    settingsItem.getValue(),
    statsItem.getValue(),
    deviceTokenItem.getValue(),
  ]);
  return { settings, stats: rollStats(stats, Date.now()), connected: token !== null };
}

async function reserveSlot(tabId: number): Promise<boolean> {
  return withLock(async () => {
    const [settings, stats, config, lastServe] = await Promise.all([
      settingsItem.getValue(),
      statsItem.getValue(),
      getConfig(),
      lastServeItem.getValue(),
    ]);
    const now = Date.now();
    if (!settings.consent || !settings.enabled || isPaused(settings, now)) return false;
    if (rollStats(stats, now).viewsToday >= config.dailyViewCap) return false;
    if (now - (lastServe[tabId] ?? 0) < config.minIntervalMs) return false;
    await lastServeItem.setValue({ ...lastServe, [tabId]: now });
    return true;
  });
}

export async function serveAd(surface: Surface, tabId: number): Promise<Ad | null> {
  if (!(await reserveSlot(tabId))) return null;

  const remote = await fetchAd(surface);
  if (!remote && (await deviceTokenItem.getValue())) return null;

  let ad: Ad;
  let adId: string;
  if (remote) {
    ({ adId, ...ad } = remote);
  } else {
    adId = 'connect-prompt';
    ad = { viewId: crypto.randomUUID(), source: 'house', ...CONNECT_PROMPT };
  }

  const pending: PendingView = {
    viewId: ad.viewId,
    tabId,
    servedAt: Date.now(),
    viewedAt: null,
    clickedAt: null,
    tracked: remote !== null,
    event: { viewId: ad.viewId, surface, source: ad.source, adId },
  };
  const stored = await withLock(async () => {
    const current = prunePending(await pendingItem.getValue(), Date.now());
    if (current[ad.viewId]) return false;
    await pendingItem.setValue({ ...current, [ad.viewId]: pending });
    return true;
  });
  return stored ? ad : null;
}

export async function recordView(viewId: string, tabId: number): Promise<{ earnedUsd: number } | null> {
  return withLock(async () => {
    const [pending, config] = await Promise.all([pendingItem.getValue(), getConfig()]);
    const view = pending[viewId];
    const now = Date.now();
    if (!view || view.tabId !== tabId || view.viewedAt !== null) return null;
    const elapsed = now - view.servedAt;
    if (elapsed < config.minDwellMs || elapsed > MAX_VIEW_DELAY_MS) return null;
    if (!view.tracked) {
      await pendingItem.setValue({ ...pending, [viewId]: { ...view, viewedAt: now } });
      return { earnedUsd: 0 };
    }

    const stats = rollStats(await statsItem.getValue(), now);
    if (stats.viewsToday >= config.dailyViewCap) return null;

    const earnedUsd = view.event.source === 'house' ? 0 : config.estimatedViewValueUsd;
    await pendingItem.setValue({ ...pending, [viewId]: { ...view, viewedAt: now } });
    await statsItem.setValue({
      ...stats,
      viewsToday: stats.viewsToday + 1,
      viewsTotal: stats.viewsTotal + 1,
      earnedTodayUsd: stats.earnedTodayUsd + earnedUsd,
      earnedTotalUsd: stats.earnedTotalUsd + earnedUsd,
    });
    await enqueue({ ...view.event, id: crypto.randomUUID(), type: 'view', occurredAt: now });
    return { earnedUsd };
  });
}

export async function recordClick(viewId: string, tabId: number): Promise<null> {
  return withLock(async () => {
    const pending = await pendingItem.getValue();
    const view = pending[viewId];
    if (!view || view.tabId !== tabId || view.clickedAt !== null) return null;
    const now = Date.now();
    await pendingItem.setValue({ ...pending, [viewId]: { ...view, clickedAt: now } });
    if (view.tracked) await enqueue({ ...view.event, id: crypto.randomUUID(), type: 'click', occurredAt: now });
    return null;
  });
}

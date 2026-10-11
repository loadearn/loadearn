import { API_BASE } from '@/lib/env';
import { PAYOUT_MINIMUM_USD } from '@/lib/config';
import { truncate } from '@/lib/format';
import type { AccountStats, Ad, Surface } from '@/lib/types';
import { safeHttpsUrl } from '@/lib/url';
import { getConfig } from './remote-config';
import { deviceTokenItem, queueItem } from './state';

const REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface RemoteAd extends Ad {
  adId: string;
}

function shortString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength ? value : null;
}

export function parseAdResponse(value: unknown): RemoteAd | null {
  if (typeof value !== 'object' || value === null) return null;
  const ad = (value as Record<string, unknown>).ad;
  if (typeof ad !== 'object' || ad === null) return null;
  const fields = ad as Record<string, unknown>;

  const viewId = typeof fields.viewId === 'string' && UUID_PATTERN.test(fields.viewId) ? fields.viewId : null;
  const adId = shortString(fields.adId, 128);
  const advertiser = shortString(fields.advertiser, 200);
  const text = shortString(fields.text, 500);
  const url = safeHttpsUrl(fields.url);
  const source = fields.source === 'partner' || fields.source === 'direct' || fields.source === 'house' ? fields.source : null;
  if (!viewId || !adId || !advertiser || !text || !url || !source) return null;

  return { viewId, adId, source, advertiser: truncate(advertiser, 40), text: truncate(text, 90), url };
}

export async function fetchAd(surface: Surface): Promise<RemoteAd | null> {
  const token = await deviceTokenItem.getValue();
  try {
    const response = await fetch(`${API_BASE}/v1/ads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ surface }),
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseAdResponse(await response.json());
  } catch {
    return null;
  }
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Server totals for the linked account, plus views still waiting in the local upload queue. */
export async function fetchAccountStats(): Promise<AccountStats | null> {
  const token = await deviceTokenItem.getValue();
  if (!token) return null;

  let body: unknown;
  try {
    const response = await fetch(`${API_BASE}/v1/device/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }

  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const views = nonNegativeNumber(fields.viewsToday);
  const earnedMicros = nonNegativeNumber(fields.earnedTodayMicros);
  const lifetimeMicros = nonNegativeNumber(fields.lifetimeMicros);
  if (views === null || earnedMicros === null || lifetimeMicros === null) return null;

  const [queue, config] = await Promise.all([queueItem.getValue(), getConfig()]);
  const queuedViews = queue.filter((event) => event.type === 'view');
  const queuedPaid = queuedViews.filter((event) => event.source !== 'house').length;
  const queuedUsd = queuedPaid * config.estimatedViewValueUsd;

  return {
    viewsToday: views + queuedViews.length,
    earnedTodayUsd: earnedMicros / 1_000_000 + queuedUsd,
    lifetimeUsd: lifetimeMicros / 1_000_000 + queuedUsd,
    payoutMinimumUsd: (nonNegativeNumber(fields.payoutMinimumMicros) || PAYOUT_MINIMUM_USD * 1_000_000) / 1_000_000,
  };
}

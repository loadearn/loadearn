import { API_BASE } from '@/lib/env';
import { PAYOUT_MINIMUM_USD } from '@/lib/config';
import { truncate } from '@/lib/format';
import type { AccountStats, Ad, ImageFormat, Surface } from '@/lib/types';
import { safeHttpsUrl } from '@/lib/url';
import { getConfig } from './remote-config';
import { deviceTokenItem, queueItem } from './state';

const REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_ID_PATTERN = /^[0-9a-f]{64}$/;
const MAX_IMAGE_BYTES = 256 * 1024;

/** Image formats this version can draw. The server only sends campaigns in these formats or text. */
export const SUPPORTED_FORMATS: readonly ImageFormat[] = ['logo', 'banner'];

export interface RemoteAd extends Ad {
  adId: string;
  imageRef?: { format: ImageFormat; id: string };
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

  const format = fields.format === 'logo' || fields.format === 'banner' ? fields.format : null;
  const imageId = typeof fields.imageId === 'string' && IMAGE_ID_PATTERN.test(fields.imageId) ? fields.imageId : null;

  return {
    viewId,
    adId,
    source,
    advertiser: truncate(advertiser, 40),
    text: truncate(text, 90),
    url,
    ...(format && imageId && { imageRef: { format, id: imageId } }),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Downloads a campaign image from our API, never from the advertiser, so users' browsers only
 * talk to LoadEarn. Images are immutable by id, so the HTTP cache serves repeats.
 */
export async function fetchAdImage(id: string): Promise<string | null> {
  if (!IMAGE_ID_PATTERN.test(id)) return null;
  try {
    const response = await fetch(`${API_BASE}/v1/images/${id}`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || response.headers.get('content-type') !== 'image/webp') return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? toBase64(bytes) : null;
  } catch {
    return null;
  }
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
      body: JSON.stringify({ surface, formats: SUPPORTED_FORMATS }),
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const ad = parseAdResponse(await response.json());
    if (!ad?.imageRef) return ad;
    // Without its image the ad still shows, as text.
    const { imageRef, ...rest } = ad;
    const webpBase64 = await fetchAdImage(imageRef.id);
    return webpBase64 ? { ...rest, image: { format: imageRef.format, webpBase64 } } : rest;
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

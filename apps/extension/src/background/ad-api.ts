import { API_BASE } from '@/lib/env';
import { PAYOUT_MINIMUM_USD } from '@/lib/config';
import { truncate } from '@/lib/format';
import type { AccountStats, Ad, ImageFormat, Surface } from '@/lib/types';
import { partnerTrackingUrl, safeHttpsUrl } from '@/lib/url';
import { getConfig } from './remote-config';
import { deviceTokenItem, forgetDeviceToken, queueItem } from './state';

const REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_ID_PATTERN = /^[0-9a-f]{64}$/;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_VIEW_VALUE_MICROS = 200_000;

/** Image formats this version can draw. The server only sends campaigns in these formats or text. */
export const SUPPORTED_FORMATS: readonly ImageFormat[] = ['logo', 'banner'];

export interface RemoteAd extends Ad {
  adId: string;
  imageRef?: { format: ImageFormat; id: string };
  /** Partner ads only: the link that tells the partner the ad was seen, and what the view pays the user. */
  partner?: { impressionUrl: string; valueUsd: number };
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
  const detail = shortString(fields.detail, 500);
  const source = fields.source === 'partner' || fields.source === 'direct' || fields.source === 'house' ? fields.source : null;
  // A partner ad is only usable with the partner's own click and impression links.
  const url = source === 'partner' ? partnerTrackingUrl(fields.url, 'click') : safeHttpsUrl(fields.url);
  if (!viewId || !adId || !advertiser || !text || !url || !source) return null;

  let partner: RemoteAd['partner'];
  if (source === 'partner') {
    const impressionUrl = partnerTrackingUrl(fields.impressionUrl, 'impression');
    const valueMicros = nonNegativeNumber(fields.valueMicros);
    if (!impressionUrl || valueMicros === null || valueMicros > MAX_VIEW_VALUE_MICROS) return null;
    partner = { impressionUrl, valueUsd: valueMicros / 1_000_000 };
  }

  const format = fields.format === 'logo' || fields.format === 'banner' ? fields.format : null;
  const imageId = typeof fields.imageId === 'string' && IMAGE_ID_PATTERN.test(fields.imageId) ? fields.imageId : null;

  return {
    viewId,
    adId,
    source,
    advertiser: truncate(advertiser, 40),
    text: truncate(text, 90),
    ...(detail && { detail: truncate(detail, 140) }),
    url,
    ...(format && imageId && { imageRef: { format, id: imageId } }),
    ...(partner && { partner }),
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
      body: JSON.stringify({ surface, formats: SUPPORTED_FORMATS, partnerAds: true }),
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The device was disconnected, so the user is asked to connect again.
    if (response.status === 401 && token) await forgetDeviceToken(token);
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

/**
 * Tells the ad partner that an ad was seen, from the user's own browser: the partner counts an
 * impression by the request reaching it, and checks it against the browser that asked for the ad.
 * Where the background has a DOM (Firefox) the link is loaded as an image; a service worker
 * (Chrome) has no images, so it sends the same GET with fetch. No cookies are sent or kept.
 */
export async function confirmImpression(value: string): Promise<void> {
  const url = partnerTrackingUrl(value, 'impression');
  if (!url) return;
  try {
    if (typeof Image === 'function') {
      await new Promise<void>((resolve) => {
        const image = new Image();
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, REQUEST_TIMEOUT_MS);
        image.onload = done;
        image.onerror = done;
        image.referrerPolicy = 'no-referrer';
        image.src = url;
      });
      return;
    }
    await fetch(url, {
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The impression is not retried: a late one would no longer describe what the user saw.
  }
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
    if (response.status === 401) await forgetDeviceToken(token);
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }

  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const views = nonNegativeNumber(fields.viewsToday);
  const earnedMicros = nonNegativeNumber(fields.earnedTodayMicros);
  const lifetimeMicros = nonNegativeNumber(fields.lifetimeMicros);
  const pendingMicros = nonNegativeNumber(fields.pendingMicros);
  // The available balance is negative when a survey was reversed after a payout.
  const availableMicros =
    typeof fields.availableMicros === 'number' && Number.isFinite(fields.availableMicros) ? fields.availableMicros : null;
  if (views === null || earnedMicros === null || lifetimeMicros === null || pendingMicros === null || availableMicros === null) {
    return null;
  }

  const [queue, config] = await Promise.all([queueItem.getValue(), getConfig()]);
  const queuedViews = queue.filter((event) => event.type === 'view');
  const queuedUsd = queuedViews
    .filter((event) => event.source !== 'house')
    .reduce((sum, event) => sum + (nonNegativeNumber(event.valueUsd) ?? config.estimatedViewValueUsd), 0);

  return {
    viewsToday: views + queuedViews.length,
    earnedTodayUsd: earnedMicros / 1_000_000 + queuedUsd,
    lifetimeUsd: lifetimeMicros / 1_000_000 + queuedUsd,
    balanceUsd: Math.max(pendingMicros + availableMicros, 0) / 1_000_000 + queuedUsd,
    availableUsd: Math.max(availableMicros, 0) / 1_000_000,
    payoutMinimumUsd: (nonNegativeNumber(fields.payoutMinimumMicros) || PAYOUT_MINIMUM_USD * 1_000_000) / 1_000_000,
  };
}

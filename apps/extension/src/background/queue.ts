import { API_BASE } from '@/lib/env';
import type { AdSource, Surface } from '@/lib/types';
import { deviceTokenItem, forgetDeviceToken, queueItem, withLock } from './state';

export interface AdEvent {
  id: string;
  type: 'view' | 'click';
  viewId: string;
  surface: Surface;
  source: AdSource;
  adId: string;
  occurredAt: number;
}

/** The server's answer for one uploaded event: whether it counted and what it credited. */
export interface EventResult {
  accepted: boolean;
  earnedMicros: number;
}

const MAX_QUEUE_SIZE = 1_000;
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EARNED_MICROS = 1_000_000;

/** Callers must hold `withLock`. */
export async function enqueue(event: AdEvent): Promise<void> {
  const queue = [...(await queueItem.getValue()), event];
  await queueItem.setValue(queue.slice(-MAX_QUEUE_SIZE));
}

function parseResults(body: unknown): Map<string, EventResult> {
  const results = new Map<string, EventResult>();
  const list = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).results : null;
  if (!Array.isArray(list)) return results;
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, accepted, earnedMicros } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof accepted !== 'boolean') continue;
    const earned =
      typeof earnedMicros === 'number' && Number.isInteger(earnedMicros) && earnedMicros >= 0 && earnedMicros <= MAX_EARNED_MICROS
        ? earnedMicros
        : 0;
    results.set(id, { accepted, earnedMicros: accepted ? earned : 0 });
  }
  return results;
}

async function sendBatch(): Promise<Map<string, EventResult>> {
  const none = new Map<string, EventResult>();
  const token = await deviceTokenItem.getValue();
  if (!token) return none;

  const batch = (await queueItem.getValue()).slice(0, BATCH_SIZE);
  if (batch.length === 0) return none;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: batch }),
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return none;
  }

  if (response.status === 401) {
    await forgetDeviceToken(token);
    return none;
  }
  if (!response.ok) return none;

  const results = parseResults(await response.json().catch(() => null));
  const sent = new Set(batch.map((event) => event.id));
  await withLock(async () => {
    const remaining = (await queueItem.getValue()).filter((event) => !sent.has(event.id));
    await queueItem.setValue(remaining);
  });
  return results;
}

let inFlight: Promise<Map<string, EventResult>> = Promise.resolve(new Map());

/**
 * Uploads the oldest queued events and returns the server's answer for each one sent. Uploads run
 * one after another, so the same event is never sent twice at once.
 */
export function flushQueue(): Promise<Map<string, EventResult>> {
  inFlight = inFlight.catch(() => new Map<string, EventResult>()).then(sendBatch);
  return inFlight;
}

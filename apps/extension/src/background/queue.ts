import { API_BASE } from '@/lib/env';
import type { AdSource, Surface } from '@/lib/types';
import { deviceTokenItem, queueItem, withLock } from './state';

export interface AdEvent {
  id: string;
  type: 'view' | 'click';
  viewId: string;
  surface: Surface;
  source: AdSource;
  adId: string;
  occurredAt: number;
}

const MAX_QUEUE_SIZE = 1_000;
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10_000;

/** Callers must hold `withLock`. */
export async function enqueue(event: AdEvent): Promise<void> {
  const queue = [...(await queueItem.getValue()), event];
  await queueItem.setValue(queue.slice(-MAX_QUEUE_SIZE));
}

export async function flushQueue(): Promise<void> {
  const token = await deviceTokenItem.getValue();
  if (!token) return;

  const batch = (await queueItem.getValue()).slice(0, BATCH_SIZE);
  if (batch.length === 0) return;

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
    return;
  }

  if (response.status === 401) {
    await withLock(async () => {
      if ((await deviceTokenItem.getValue()) === token) await deviceTokenItem.setValue(null);
    });
    return;
  }
  if (!response.ok) return;

  const sent = new Set(batch.map((event) => event.id));
  await withLock(async () => {
    const remaining = (await queueItem.getValue()).filter((event) => !sent.has(event.id));
    await queueItem.setValue(remaining);
  });
}

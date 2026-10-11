import { browser } from 'wxt/browser';
import { SURFACES } from './config';
import type { AccountStats, Ad, ContentConfig, StateSnapshot, Surface } from './types';

export type ContentRequest =
  | { type: 'content:init'; surface: Surface }
  | { type: 'ad:request'; surface: Surface }
  | { type: 'ad:viewed'; viewId: string }
  | { type: 'ad:clicked'; viewId: string }
  | { type: 'device:connect'; token: string };

export type PageRequest =
  | { type: 'state:get' }
  | { type: 'stats:account' }
  | { type: 'settings:set-enabled'; enabled: boolean }
  | { type: 'settings:pause'; until: number | null }
  | { type: 'consent:set'; granted: boolean };

export type Request = ContentRequest | PageRequest;

export interface ResponseMap {
  'content:init': ContentConfig | null;
  'ad:request': Ad | null;
  'ad:viewed': { earnedUsd: number } | null;
  'ad:clicked': null;
  'device:connect': { connected: boolean };
  'state:get': StateSnapshot | null;
  'stats:account': AccountStats | null;
  'settings:set-enabled': StateSnapshot | null;
  'settings:pause': StateSnapshot | null;
  'consent:set': StateSnapshot | null;
}

export const MAX_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;

const DEVICE_TOKEN_PATTERN = /^le_[A-Za-z0-9_-]{43}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isSurface(value: unknown): value is Surface {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

function isViewId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function parseContentRequest(value: unknown): ContentRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'content:init':
    case 'ad:request':
      return isSurface(message.surface) ? { type: message.type, surface: message.surface } : null;
    case 'ad:viewed':
    case 'ad:clicked':
      return isViewId(message.viewId) ? { type: message.type, viewId: message.viewId } : null;
    case 'device:connect':
      return typeof message.token === 'string' && DEVICE_TOKEN_PATTERN.test(message.token)
        ? { type: message.type, token: message.token }
        : null;
    default:
      return null;
  }
}

export function parsePageRequest(value: unknown): PageRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'state:get':
      return { type: 'state:get' };
    case 'stats:account':
      return { type: 'stats:account' };
    case 'settings:set-enabled':
      return typeof message.enabled === 'boolean' ? { type: message.type, enabled: message.enabled } : null;
    case 'consent:set':
      return typeof message.granted === 'boolean' ? { type: message.type, granted: message.granted } : null;
    case 'settings:pause':
      if (message.until === null) return { type: message.type, until: null };
      return typeof message.until === 'number' && Number.isFinite(message.until) && message.until > 0
        ? { type: message.type, until: message.until }
        : null;
    default:
      return null;
  }
}

/** Always rejects instead of throwing, so callers can rely on .catch when the extension context is gone. */
export async function sendRequest<T extends Request>(request: T): Promise<ResponseMap[T['type']]> {
  return browser.runtime.sendMessage(request);
}

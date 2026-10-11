import { DEFAULT_CONFIG, parseConfig } from '@/lib/config';
import { API_BASE } from '@/lib/env';
import type { ClientConfig } from '@/lib/types';
import { configItem } from './state';

const REQUEST_TIMEOUT_MS = 10_000;

export async function getConfig(): Promise<ClientConfig> {
  const cached = await configItem.getValue();
  return cached?.config ?? DEFAULT_CONFIG;
}

export async function refreshConfig(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/v1/config`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return;
    const config = parseConfig(await response.json());
    if (config) await configItem.setValue({ fetchedAt: Date.now(), config });
  } catch {
    // Keep the cached or bundled configuration.
  }
}

const MAX_URL_LENGTH = 2048;

export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    return null;
  }
  return url.href;
}

const PARTNER_HOST = 'api.adgentek.ai';
const PARTNER_PATHS = { impression: '/ad-server/v1/track-impression', click: '/ad-server/v1/click-redirect' };

/**
 * Returns the link only if it is one of the ad partner's signed tracking links: https on the
 * partner's API host, at the expected path. The background opens these on the user's behalf,
 * so nothing else may get through, whatever the API sends.
 */
export function partnerTrackingUrl(value: unknown, kind: keyof typeof PARTNER_PATHS): string | null {
  const href = safeHttpsUrl(value);
  if (!href) return null;
  const url = new URL(href);
  return url.hostname === PARTNER_HOST && url.port === '' && url.pathname === PARTNER_PATHS[kind] ? href : null;
}

export function resolveApiBase(value: string | undefined, fallback: string, allowLocal: boolean): string {
  if (!value) return fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fallback;
  }
  const isLocal = allowLocal && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocal) return fallback;
  return url.origin;
}

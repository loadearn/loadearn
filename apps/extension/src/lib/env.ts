import { resolveApiBase } from './url';

export const IS_DEV = import.meta.env.DEV || import.meta.env.WXT_LOCAL_STACK === '1';

export const API_BASE = resolveApiBase(
  import.meta.env.WXT_API_BASE,
  IS_DEV ? 'http://localhost:3000' : 'https://api.loadearn.com',
  IS_DEV,
);

export const SITE_URL = IS_DEV ? 'http://localhost:3001' : 'https://loadearn.com';

export const DASHBOARD_URL = `${SITE_URL}/dashboard`;

export const UNINSTALL_URL = `${SITE_URL}/uninstalled`;

export const CONNECT_URL = `${SITE_URL}/connect`;

export const CONNECT_PAGE_MATCHES = IS_DEV
  ? ['https://loadearn.com/connect*', 'http://localhost:3001/connect*']
  : ['https://loadearn.com/connect*'];

export const CONNECT_PAGE_HOSTS: readonly string[] = IS_DEV ? ['loadearn.com', 'localhost'] : ['loadearn.com'];

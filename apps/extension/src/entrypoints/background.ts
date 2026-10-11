import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { recordClick, recordView, serveAd, getSnapshot } from '@/background/ads';
import { fetchAccountStats } from '@/background/ad-api';
import { flushQueue } from '@/background/queue';
import { getConfig, refreshConfig } from '@/background/remote-config';
import { deviceTokenItem, installIdItem, lastServeItem, pendingItem, settingsItem, withLock } from '@/background/state';
import { SURFACE_HOSTS } from '@/lib/config';
import { CONNECT_PAGE_HOSTS, IS_DEV, UNINSTALL_URL } from '@/lib/env';
import { MAX_PAUSE_MS, parseContentRequest, parsePageRequest, type ContentRequest, type PageRequest } from '@/lib/messages';
import type { Settings } from '@/lib/types';

const FLUSH_ALARM = 'flush-queue';
const CONFIG_ALARM = 'refresh-config';

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function handleContent(request: ContentRequest, tabId: number, hostname: string): Promise<unknown> {
  switch (request.type) {
    case 'content:init':
    case 'ad:request': {
      if (SURFACE_HOSTS[request.surface] !== hostname) return null;
      if (request.type === 'ad:request') return serveAd(request.surface, tabId);
      const config = await getConfig();
      return {
        minDwellMs: config.minDwellMs,
        minIntervalMs: config.minIntervalMs,
        selectors: config.sites[request.surface],
      };
    }
    case 'ad:viewed':
      return recordView(request.viewId, tabId);
    case 'ad:clicked':
      return recordClick(request.viewId, tabId);
    case 'device:connect': {
      if (!CONNECT_PAGE_HOSTS.includes(hostname)) return { connected: false };
      await deviceTokenItem.setValue(request.token);
      void flushQueue();
      return { connected: true };
    }
  }
}

async function updateSettings(patch: Partial<Settings>): Promise<unknown> {
  await withLock(async () => {
    const settings = await settingsItem.getValue();
    await settingsItem.setValue({ ...settings, ...patch });
  });
  return getSnapshot();
}

async function handlePage(request: PageRequest): Promise<unknown> {
  switch (request.type) {
    case 'state:get':
      return getSnapshot();
    case 'stats:account':
      return fetchAccountStats();
    case 'settings:set-enabled':
      return updateSettings({ enabled: request.enabled, pausedUntil: null });
    case 'settings:pause':
      return updateSettings({
        pausedUntil: request.until === null ? null : Math.min(request.until, Date.now() + MAX_PAUSE_MS),
      });
    case 'consent:set':
      return updateSettings({ consent: request.granted });
  }
}

function route(message: unknown, sender: Browser.runtime.MessageSender): Promise<unknown> | null {
  if (sender.id !== browser.runtime.id) return null;

  if (sender.url?.startsWith(browser.runtime.getURL('/'))) {
    const request = parsePageRequest(message);
    return request ? handlePage(request) : null;
  }

  const tabId = sender.tab?.id;
  const hostname = hostnameOf(sender.url);
  const request = parseContentRequest(message);
  if (tabId === undefined || !hostname || !request) return null;
  return handleContent(request, tabId, hostname);
}

async function ensureAlarms(): Promise<void> {
  if (!(await browser.alarms.get(FLUSH_ALARM))) await browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  if (!(await browser.alarms.get(CONFIG_ALARM))) await browser.alarms.create(CONFIG_ALARM, { periodInMinutes: 10 });
}

async function forgetTab(tabId: number): Promise<void> {
  await withLock(async () => {
    const [lastServe, pending] = await Promise.all([lastServeItem.getValue(), pendingItem.getValue()]);
    const { [tabId]: _removed, ...remaining } = lastServe;
    await lastServeItem.setValue(remaining);
    await pendingItem.setValue(Object.fromEntries(Object.entries(pending).filter(([, view]) => view.tabId !== tabId)));
  });
}

async function registerUninstallUrl(): Promise<void> {
  if (IS_DEV) return;
  const url = new URL(UNINSTALL_URL);
  url.searchParams.set('v', browser.runtime.getManifest().version);
  url.searchParams.set('i', await installIdItem.getValue());
  await browser.runtime.setUninstallURL(url.href);
}

export default defineBackground(() => {
  void registerUninstallUrl();
  void ensureAlarms();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    void refreshConfig();
    if (reason === 'install') {
      void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId));

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void flushQueue();
    if (alarm.name === CONFIG_ALARM) void refreshConfig();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const result = route(message, sender);
    if (!result) return false;
    result.then(sendResponse, () => sendResponse(null));
    return true;
  });
});

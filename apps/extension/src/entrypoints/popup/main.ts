import { browser } from 'wxt/browser';
import { PAYOUT_MINIMUM_USD } from '@/lib/config';
import { CONNECT_URL, DASHBOARD_URL } from '@/lib/env';
import { formatUsd } from '@/lib/format';
import { sendRequest } from '@/lib/messages';
import type { AccountStats, StateSnapshot } from '@/lib/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const enabled = byId<HTMLInputElement>('enabled');
const setup = byId('setup');
const earnings = byId('earnings');
const connect = byId('connect');
const pause = byId('pause');
const pauseActions = byId('pause-actions');
const paused = byId('paused');

function pauseTarget(kind: string | undefined): number | null {
  const now = new Date();
  if (kind === 'hour') return now.getTime() + 60 * 60 * 1000;
  if (kind === 'tomorrow') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return null;
}

let account: AccountStats | null = null;
let lastState: StateSnapshot | null = null;

function render(state: StateSnapshot | null): void {
  if (!state) return;
  lastState = state;
  const { settings, stats, connected } = state;
  connect.hidden = !settings.consent || connected;
  enabled.checked = settings.enabled;
  enabled.disabled = !settings.consent;
  setup.hidden = settings.consent;
  earnings.hidden = !settings.consent;

  const pausedUntil = settings.pausedUntil !== null && settings.pausedUntil > Date.now() ? settings.pausedUntil : null;
  pause.hidden = !settings.consent || !settings.enabled;
  pauseActions.hidden = pausedUntil !== null;
  paused.hidden = pausedUntil === null;
  if (pausedUntil !== null) {
    const time = new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sameDay = new Date(pausedUntil).toDateString() === new Date().toDateString();
    byId('paused-until').textContent = sameDay ? `Paused until ${time}` : 'Paused until tomorrow';
  }

  const shown = connected && account
    ? { views: account.viewsToday, today: account.earnedTodayUsd, total: account.lifetimeUsd }
    : { views: stats.viewsToday, today: stats.earnedTodayUsd, total: stats.earnedTotalUsd };

  byId('earned-today').textContent = formatUsd(shown.today);
  byId('earned-total').textContent = formatUsd(shown.total);
  byId('views-today').textContent = `${shown.views} ${shown.views === 1 ? 'view' : 'views'} today`;

  const minimum = connected && account ? account.payoutMinimumUsd : PAYOUT_MINIMUM_USD;
  const progress = Math.min(shown.total / minimum, 1);
  byId('progress-bar').style.width = `${Math.round(progress * 100)}%`;
  byId('payout-hint').textContent =
    progress >= 1
      ? 'You can cash out from the dashboard.'
      : `${formatUsd(minimum - shown.total)} to your first ${formatUsd(minimum)} payout`;
}

enabled.addEventListener('change', async () => {
  render(await sendRequest({ type: 'settings:set-enabled', enabled: enabled.checked }));
});

pauseActions.addEventListener('click', async (event) => {
  const until = pauseTarget((event.target as HTMLElement).closest<HTMLElement>('[data-pause]')?.dataset.pause);
  if (until !== null) render(await sendRequest({ type: 'settings:pause', until }));
});

byId('resume').addEventListener('click', async () => {
  render(await sendRequest({ type: 'settings:pause', until: null }));
});

byId('connect-account').addEventListener('click', async () => {
  await browser.tabs.create({ url: CONNECT_URL });
  window.close();
});

byId('finish-setup').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  window.close();
});

byId<HTMLAnchorElement>('dashboard').href = DASHBOARD_URL;
byId('version').textContent = `v${browser.runtime.getManifest().version}`;

async function refreshAccount(): Promise<void> {
  account = await sendRequest({ type: 'stats:account' }).catch(() => null);
  render(lastState);
}

browser.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  void sendRequest({ type: 'state:get' }).then(render);
  void refreshAccount();
});

render(await sendRequest({ type: 'state:get' }));
void refreshAccount();

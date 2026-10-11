import { CONNECT_URL, SITE_URL } from '@/lib/env';
import { sendRequest } from '@/lib/messages';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const consent = byId('consent');
const done = byId('done');

function showDone(connected: boolean): void {
  consent.hidden = true;
  done.hidden = false;
  byId('connect-step').hidden = connected;
}

byId<HTMLAnchorElement>('terms').href = `${SITE_URL}/terms`;
byId<HTMLAnchorElement>('privacy').href = `${SITE_URL}/privacy`;
byId<HTMLAnchorElement>('connect').href = CONNECT_URL;

byId('accept').addEventListener('click', async () => {
  const state = await sendRequest({ type: 'consent:set', granted: true });
  if (!state?.settings.consent) return;
  if (state.connected) showDone(true);
  else window.location.assign(CONNECT_URL);
});

byId('decline').addEventListener('click', async () => {
  await sendRequest({ type: 'consent:set', granted: false });
  window.close();
});

const state = await sendRequest({ type: 'state:get' });
if (state?.settings.consent) showDone(state.connected);

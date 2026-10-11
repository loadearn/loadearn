import { defineContentScript } from 'wxt/utils/define-content-script';
import { CONNECT_PAGE_MATCHES } from '@/lib/env';
import { sendRequest } from '@/lib/messages';

const PING = 'loadearn:extension-ping';
const READY = 'loadearn:extension-ready';
const TOKEN = 'loadearn:device-token';
const CONNECTED = 'loadearn:device-connected';

export default defineContentScript({
  matches: CONNECT_PAGE_MATCHES,
  runAt: 'document_idle',
  main(ctx) {
    const post = (message: Record<string, unknown>) => window.postMessage(message, location.origin);

    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { type?: unknown; token?: unknown } | null;
      if (data?.type === PING) {
        post({ type: READY });
        return;
      }
      if (data?.type !== TOKEN || typeof data.token !== 'string') return;

      const result = await sendRequest({ type: 'device:connect', token: data.token }).catch(() => null);
      post({ type: CONNECTED, ok: result?.connected === true });
    };

    window.addEventListener('message', onMessage);
    ctx.onInvalidated(() => window.removeEventListener('message', onMessage));
    post({ type: READY });
  },
});

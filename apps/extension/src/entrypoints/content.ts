import { defineContentScript } from 'wxt/utils/define-content-script';
import { startController } from '@/content/controller';
import { SURFACE_HOSTS, SURFACES } from '@/lib/config';
import { sendRequest } from '@/lib/messages';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*', 'https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const surface = SURFACES.find((candidate) => SURFACE_HOSTS[candidate] === location.hostname);
    if (!surface) return;

    const config = await sendRequest({ type: 'content:init', surface }).catch(() => null);
    if (!config || ctx.isInvalid) return;

    const controller = startController(surface, config);
    ctx.onInvalidated(() => controller.stop());
  },
});

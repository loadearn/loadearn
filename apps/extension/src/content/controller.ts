import { sendRequest } from '@/lib/messages';
import type { ContentConfig, Surface } from '@/lib/types';
import { startActivityMonitor } from './activity';
import { createCard, type Card } from './card';
import { startDwell, type DwellTracker } from './dwell';
import { createSiteDetector } from './site';

const CHECK_DELAY_MS = 200;
const ACTIVITY_WINDOW_MS = 60_000;
const REANCHOR_WINDOW_MS = 30_000;
const MAX_UNQUALIFIED_MS = 25 * 60 * 1000;
const OBSERVED_ATTRIBUTES = ['aria-label', 'data-testid', 'data-is-streaming', 'data-turn-working', 'disabled'];

interface ActiveView {
  viewId: string;
  card: Card;
  dwell: DwellTracker;
  qualified: boolean;
  shownAt: number;
}

export interface Controller {
  stop(): void;
}

export function startController(surface: Surface, config: ContentConfig): Controller {
  const detector = createSiteDetector(config.selectors);
  const activity = startActivityMonitor();
  let active: ActiveView | null = null;
  let wasGenerating = false;
  let lastShownAt = Number.NEGATIVE_INFINITY;
  let requesting = false;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;

  const clearActive = () => {
    active?.dwell.stop();
    active?.card.destroy();
    active = null;
  };

  const moveToLatest = (view: ActiveView) => {
    const anchor = detector.findAnchor();
    if (anchor && anchor.nextElementSibling !== view.card.host) anchor.after(view.card.host);
  };

  const showAd = async () => {
    if (active && !active.qualified && performance.now() - active.shownAt < MAX_UNQUALIFIED_MS) {
      moveToLatest(active);
      return;
    }
    if (requesting || performance.now() - lastShownAt < config.minIntervalMs) return;

    if (navigator.webdriver || detector.isSuppressed()) return;
    if (!detector.findAnchor()) return;

    requesting = true;
    try {
      const ad = await sendRequest({ type: 'ad:request', surface });
      const anchor = ad ? detector.findAnchor() : null;
      if (!ad || !anchor) return;

      clearActive();
      const viewId = ad.viewId;
      const card = createCard(ad, anchor, {
        onClick: () => void sendRequest({ type: 'ad:clicked', viewId }).catch(() => undefined),
        onDismiss: () => {
          if (active?.viewId === viewId) clearActive();
        },
      });
      anchor.after(card.host);
      lastShownAt = performance.now();

      const view: ActiveView = {
        viewId,
        card,
        qualified: false,
        shownAt: lastShownAt,
        dwell: startDwell({
          target: card.host,
          requiredMs: config.minDwellMs,
          canCount: () => activity.isActive(ACTIVITY_WINDOW_MS),
          onComplete: () => {
            view.qualified = true;
            void sendRequest({ type: 'ad:viewed', viewId })
              .then((result) => {
                if (result) card.showEarned(result.earnedUsd);
              })
              .catch(() => undefined);
          },
        }),
      };
      active = view;
    } catch {
      // The background may be restarting; the next generation will retry.
    } finally {
      requesting = false;
    }
  };

  const reattach = (view: ActiveView) => {
    const anchor = view.qualified || performance.now() - view.shownAt > REANCHOR_WINDOW_MS ? null : detector.findAnchor();
    if (anchor) anchor.after(view.card.host);
    else clearActive();
  };

  const check = () => {
    checkTimer = undefined;
    if (active && detector.isSuppressed()) clearActive();
    if (active && !active.card.host.isConnected) reattach(active);

    const generating = detector.isGenerating();
    if (generating && !wasGenerating) void showAd();
    wasGenerating = generating;
  };

  const scheduleCheck = () => {
    if (checkTimer === undefined) checkTimer = setTimeout(check, CHECK_DELAY_MS);
  };

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTES,
  });
  scheduleCheck();

  return {
    stop() {
      observer.disconnect();
      clearTimeout(checkTimer);
      activity.stop();
      clearActive();
    },
  };
}

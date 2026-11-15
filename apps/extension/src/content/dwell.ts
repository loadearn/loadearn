const TICK_MS = 250;
const MAX_TICK_CREDIT_MS = 1_000;
const VISIBLE_RATIO = 0.5;
/** The advertising industry's measure of a viewable ad: half of it on screen for one second without a break. */
const VIEWABLE_MS = 1_000;

export interface DwellOptions {
  target: Element;
  requiredMs: number;
  canCount: () => boolean;
  /** Called once, when the target has been at least half on screen in a visible tab for a full second. */
  onVisible?: () => void;
  onComplete: () => void;
}

export interface DwellTracker {
  stop(): void;
}

export function startDwell({ target, requiredMs, canCount, onVisible, onComplete }: DwellOptions): DwellTracker {
  let visible = false;
  let reportedVisible = false;
  let visibleFor = 0;
  let accumulated = 0;
  let last = performance.now();
  let stopped = false;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
    },
    { threshold: [0, VISIBLE_RATIO, 1] },
  );
  observer.observe(target);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    observer.disconnect();
  };

  const timer = setInterval(() => {
    const now = performance.now();
    const delta = Math.min(now - last, MAX_TICK_CREDIT_MS);
    last = now;

    if (!target.isConnected || !visible || document.visibilityState !== 'visible') {
      visibleFor = 0;
      return;
    }
    if (!reportedVisible) {
      visibleFor += delta;
      if (visibleFor >= VIEWABLE_MS) {
        reportedVisible = true;
        onVisible?.();
      }
    }
    if (!document.hasFocus() || !canCount()) return;

    accumulated += delta;
    if (accumulated >= requiredMs) {
      stop();
      onComplete();
    }
  }, TICK_MS);

  return { stop };
}

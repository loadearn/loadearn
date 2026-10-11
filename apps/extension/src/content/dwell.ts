const TICK_MS = 250;
const MAX_TICK_CREDIT_MS = 1_000;
const VISIBLE_RATIO = 0.5;

export interface DwellOptions {
  target: Element;
  requiredMs: number;
  canCount: () => boolean;
  onComplete: () => void;
}

export interface DwellTracker {
  stop(): void;
}

export function startDwell({ target, requiredMs, canCount, onComplete }: DwellOptions): DwellTracker {
  let visible = false;
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

    if (!target.isConnected || !visible || document.visibilityState !== 'visible' || !document.hasFocus() || !canCount()) return;

    accumulated += delta;
    if (accumulated >= requiredMs) {
      stop();
      onComplete();
    }
  }, TICK_MS);

  return { stop };
}

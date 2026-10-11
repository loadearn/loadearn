const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface ActivityMonitor {
  isActive(windowMs: number): boolean;
  stop(): void;
}

export function startActivityMonitor(target: Window = window): ActivityMonitor {
  let lastInputAt = 0;
  const onInput = (event: Event) => {
    if (event.isTrusted) lastInputAt = performance.now();
  };
  const options: AddEventListenerOptions = { capture: true, passive: true };

  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onInput, options);

  return {
    isActive: (windowMs) => lastInputAt > 0 && performance.now() - lastInputAt <= windowMs,
    stop: () => {
      for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onInput, options);
    },
  };
}

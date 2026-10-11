import { formatUsd } from '@/lib/format';
import type { Ad } from '@/lib/types';

const LABEL = 'Sponsored · LoadEarn';
const EARNED_VISIBLE_MS = 3_000;

const STYLES = `
:host { all: initial; display: block; margin: 12px 0; }
.card {
  --fg: #121211; --muted: #6e6a61; --line: rgba(18, 18, 17, 0.12); --signal: #ff5b1f; --money: #127a49;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; padding: 8px 4px 10px;
  border-bottom: 1px solid var(--line); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--fg);
}
.card.dark { --fg: #f2efe8; --muted: #a8a397; --line: rgba(242, 239, 232, 0.14); --money: #3ecf8e; }
.label { display: flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); }
.label::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--signal); }
.label.earned { color: var(--money); font-weight: 600; }
.label.earned::before { background: var(--money); }
.row { display: flex; align-items: center; gap: 8px; }
.ad { flex: 1; min-width: 0; color: var(--fg); text-decoration: underline; text-decoration-color: var(--line);
  text-underline-offset: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad:hover { text-decoration-color: var(--signal); }
.advertiser { font-weight: 700; }
.close { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent;
  color: var(--muted); font: 16px/1 system-ui, sans-serif; cursor: pointer; }
.close:hover { background: var(--line); color: var(--fg); }
.ad:focus-visible, .close:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
`;

export interface CardHandlers {
  onClick: () => void;
  onDismiss: () => void;
}

export interface Card {
  host: HTMLElement;
  showEarned(amountUsd: number): void;
  destroy(): void;
}

function isDarkBackground(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    const match = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (match?.[1]) {
      const [r = 0, g = 0, b = 0, a = 1] = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (a > 0.5) return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    }
    node = node.parentElement;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createCard(ad: Ad, themeSource: Element, handlers: CardHandlers): Card {
  const host = document.createElement('loadearn-card');
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const card = element('div', isDarkBackground(themeSource) ? 'card dark' : 'card');
  card.setAttribute('role', 'complementary');
  card.setAttribute('aria-label', 'Sponsored message');

  const label = element('div', 'label', LABEL);

  const link = element('a', 'ad');
  link.href = ad.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer sponsored';
  link.append(element('span', 'advertiser', ad.advertiser), document.createTextNode(` — ${ad.text}`));
  link.addEventListener('click', (event) => {
    if (event.isTrusted) handlers.onClick();
  });

  const close = element('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Hide sponsored message');
  close.addEventListener('click', (event) => {
    if (event.isTrusted) handlers.onDismiss();
  });

  const row = element('div', 'row');
  row.append(link, close);
  card.append(label, row);
  shadow.append(style, card);

  let labelTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    host,
    showEarned(amountUsd) {
      if (amountUsd <= 0) return;
      label.textContent = `+${formatUsd(amountUsd)} earned`;
      label.classList.add('earned');
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => {
        label.textContent = LABEL;
        label.classList.remove('earned');
      }, EARNED_VISIBLE_MS);
    },
    destroy() {
      clearTimeout(labelTimer);
      host.remove();
    },
  };
}

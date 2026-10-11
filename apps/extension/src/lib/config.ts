import type { ClientConfig, SiteSelectors, Surface } from './types';

export const SURFACES: readonly Surface[] = ['chatgpt', 'claude', 'gemini', 'deepseek'];

export const SURFACE_HOSTS: Record<Surface, string> = {
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
  deepseek: 'chat.deepseek.com',
};

export const PAYOUT_MINIMUM_USD = 5;

export const DEFAULT_CONFIG: ClientConfig = {
  minDwellMs: 10_000,
  minIntervalMs: 10_000,
  dailyViewCap: 150,
  estimatedViewValueUsd: 0.0012,
  sites: {
    chatgpt: {
      generating: [
        'form button[aria-label="Stop"]',
        'button[data-testid="stop-button"]',
        '[data-talvt-turn-state]:not([data-talvt-turn-state="complete"])',
      ],
      anchor: ['[data-user-message-bubble]', '[data-message-author-role="user"]'],
      container: ['[data-chatgpt-search-unit-key]', 'article'],
      suppress: [],
    },
    claude: {
      generating: [
        '[data-is-streaming="true"]',
        'button[aria-label="Stop response"]',
        '[data-testid="code-working-line"][data-turn-working="true"]',
      ],
      anchor: ['[data-testid="user-message"]'],
      container: ['[data-transcript-row]', '[data-cds="UserMessage"]'],
      suppress: [],
    },
    gemini: {
      generating: ['pending-request', 'button[aria-label="Stop response"]'],
      anchor: ['user-query'],
      container: [],
      suppress: ['shopping-list', '[data-ad-slot]'],
    },
    deepseek: {
      generating: [
        '.ds-loading',
        '.ds-button--primary.ds-button--circle:not(.ds-button--disabled) path[d^="M2 4.88"]',
      ],
      anchor: ['.ds-message:has(.ds-collapsible-text):not(:has(.ds-markdown))'],
      container: ['[data-virtual-list-item-key]'],
      suppress: [],
    },
  },
};

const MAX_SELECTORS = 10;
const MAX_SELECTOR_LENGTH = 200;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function parseSelectorList(value: unknown, allowEmpty: boolean): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTORS) return null;
  if (!allowEmpty && value.length === 0) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_SELECTOR_LENGTH) return null;
    result.push(item);
  }
  return result;
}

function parseSite(value: unknown): SiteSelectors | null {
  if (!isObject(value)) return null;
  const generating = parseSelectorList(value.generating, false);
  const anchor = parseSelectorList(value.anchor, false);
  const container = parseSelectorList(value.container ?? [], true);
  const suppress = parseSelectorList(value.suppress ?? [], true);
  if (!generating || !anchor || !container || !suppress) return null;
  return { generating, anchor, container, suppress };
}

export function parseConfig(value: unknown): ClientConfig | null {
  if (!isObject(value) || !isObject(value.sites)) return null;

  const minDwellMs = boundedInt(value.minDwellMs, 5_000, 60_000);
  const minIntervalMs = boundedInt(value.minIntervalMs, 5_000, 600_000);
  const dailyViewCap = boundedInt(value.dailyViewCap, 0, 1_000);
  const estimatedViewValueUsd = boundedNumber(value.estimatedViewValueUsd, 0, 0.05);
  if (minDwellMs === null || minIntervalMs === null || dailyViewCap === null || estimatedViewValueUsd === null) {
    return null;
  }

  const sites = {} as Record<Surface, SiteSelectors>;
  for (const surface of SURFACES) {
    const site = parseSite(value.sites[surface]);
    if (!site) return null;
    sites[surface] = site;
  }

  return { minDwellMs, minIntervalMs, dailyViewCap, estimatedViewValueUsd, sites };
}

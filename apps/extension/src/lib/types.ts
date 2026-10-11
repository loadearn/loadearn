export type Surface = 'chatgpt' | 'claude' | 'gemini' | 'deepseek';

export type AdSource = 'partner' | 'direct' | 'house';

export interface Ad {
  viewId: string;
  source: AdSource;
  advertiser: string;
  text: string;
  url: string;
}

export interface SiteSelectors {
  generating: string[];
  anchor: string[];
  container: string[];
  suppress: string[];
}

export interface ClientConfig {
  minDwellMs: number;
  minIntervalMs: number;
  dailyViewCap: number;
  estimatedViewValueUsd: number;
  sites: Record<Surface, SiteSelectors>;
}

export interface ContentConfig {
  minDwellMs: number;
  minIntervalMs: number;
  selectors: SiteSelectors;
}

export interface Settings {
  consent: boolean;
  enabled: boolean;
  pausedUntil: number | null;
}

export interface Stats {
  day: string;
  viewsToday: number;
  earnedTodayUsd: number;
  viewsTotal: number;
  earnedTotalUsd: number;
}

export interface AccountStats {
  viewsToday: number;
  earnedTodayUsd: number;
  lifetimeUsd: number;
  payoutMinimumUsd: number;
}

export interface StateSnapshot {
  settings: Settings;
  stats: Stats;
  connected: boolean;
}

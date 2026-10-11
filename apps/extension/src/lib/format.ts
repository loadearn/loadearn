export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

const INVISIBLE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function truncate(value: string, maxLength: number): string {
  const text = value.replace(INVISIBLE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}\u2026`;
}

import { describe, expect, it } from 'vitest';
import { parseContentRequest, parsePageRequest } from '@/lib/messages';

const viewId = '0b8f6c2e-7d0a-4c55-9b1e-2f3a4b5c6d7e';

describe('parseContentRequest', () => {
  it('accepts valid requests and drops extra fields', () => {
    expect(parseContentRequest({ type: 'ad:request', surface: 'chatgpt' })).toEqual({ type: 'ad:request', surface: 'chatgpt' });
    expect(parseContentRequest({ type: 'ad:viewed', viewId, extra: 1 })).toEqual({ type: 'ad:viewed', viewId });
  });

  it('rejects unknown surfaces, malformed ids and page-only requests', () => {
    expect(parseContentRequest({ type: 'ad:request', surface: 'example.com' })).toBeNull();
    expect(parseContentRequest({ type: 'ad:viewed', viewId: 'nope' })).toBeNull();
    expect(parseContentRequest({ type: 'consent:set', granted: true })).toBeNull();
    expect(parseContentRequest('ad:request')).toBeNull();
  });
});

describe('parsePageRequest', () => {
  it('validates payload types', () => {
    expect(parsePageRequest({ type: 'consent:set', granted: true })).toEqual({ type: 'consent:set', granted: true });
    expect(parsePageRequest({ type: 'settings:set-enabled', enabled: 'yes' })).toBeNull();
    expect(parsePageRequest({ type: 'ad:request', surface: 'chatgpt' })).toBeNull();
    expect(parsePageRequest({ type: 'settings:pause', until: 1_900_000_000_000 })).toEqual({ type: 'settings:pause', until: 1_900_000_000_000 });
    expect(parsePageRequest({ type: 'settings:pause', until: null })).toEqual({ type: 'settings:pause', until: null });
    expect(parsePageRequest({ type: 'settings:pause', until: 'later' })).toBeNull();
  });
});

describe('sendRequest', () => {
  it('rejects instead of throwing when the extension context is gone', async () => {
    const { browser } = await import('wxt/browser');
    const original = browser.runtime.sendMessage;
    browser.runtime.sendMessage = (() => {
      throw new Error('Extension context invalidated.');
    }) as typeof browser.runtime.sendMessage;
    const { sendRequest } = await import('@/lib/messages');
    let thrownSynchronously = false;
    let promise: Promise<unknown> | undefined;
    try {
      promise = sendRequest({ type: 'state:get' });
    } catch {
      thrownSynchronously = true;
    }
    browser.runtime.sendMessage = original;
    expect(thrownSynchronously).toBe(false);
    await expect(promise).rejects.toThrow('Extension context invalidated.');
  });
});

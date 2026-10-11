// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createSiteDetector } from '@/content/site';
import { DEFAULT_CONFIG } from '@/lib/config';

const turn = (key: string, state: string) => `
  <div data-turn-key="${key}">
    <div data-talvt-turn-state="${state}">
      <div data-chatgpt-search-unit-key="${key}:0:user"><div data-user-message-bubble="true">prompt</div></div>
      <div data-conversation-role="assistant">reply</div>
    </div>
  </div>`;

describe('chatgpt detector', () => {
  const detector = () => createSiteDetector(DEFAULT_CONFIG.sites.chatgpt);

  beforeEach(() => {
    document.body.innerHTML = `<form><button aria-label="Send"></button></form>${turn('t1', 'complete')}${turn('t2', 'complete')}`;
  });

  it('is idle when every turn is complete', () => {
    expect(detector().isGenerating()).toBe(false);
  });

  it('detects generation from the stop button or a streaming turn', () => {
    document.querySelector('form')!.innerHTML = '<button aria-label="Stop"></button>';
    expect(detector().isGenerating()).toBe(true);

    document.querySelector('form')!.innerHTML = '';
    document.body.insertAdjacentHTML('beforeend', turn('t3', 'streaming'));
    expect(detector().isGenerating()).toBe(true);
  });

  it('anchors to the full-width unit of the last user message', () => {
    expect(detector().findAnchor()?.getAttribute('data-chatgpt-search-unit-key')).toBe('t2:0:user');
  });
});

describe('claude detector', () => {
  it('anchors outside the message bubble', () => {
    document.body.innerHTML = `
      <div data-transcript-row="" id="row"><div data-user-scope=""><div data-cds="UserMessage">
        <div data-testid="user-message">prompt</div>
      </div></div></div>
      <div data-is-streaming="true"></div>`;
    const detector = createSiteDetector(DEFAULT_CONFIG.sites.claude);
    expect(detector.isGenerating()).toBe(true);
    expect(detector.findAnchor()?.id).toBe('row');
  });
});

describe('gemini detector', () => {
  it('detects pending requests and host ads', () => {
    document.body.innerHTML = '<pending-request><user-query></user-query></pending-request>';
    const detector = createSiteDetector(DEFAULT_CONFIG.sites.gemini);
    expect(detector.isGenerating()).toBe(true);
    expect(detector.isSuppressed()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<shopping-list></shopping-list>');
    expect(detector.isSuppressed()).toBe(true);
  });
});

describe('invalid selectors', () => {
  it('are ignored', () => {
    const detector = createSiteDetector({ generating: ['[[invalid'], anchor: ['[[invalid'], container: [], suppress: ['[['] });
    expect(detector.isGenerating()).toBe(false);
    expect(detector.isSuppressed()).toBe(false);
    expect(detector.findAnchor()).toBeNull();
  });
});

describe('claude working line', () => {
  it('detects an active turn from the working line', () => {
    document.body.innerHTML = `
      <div data-transcript-row="" id="row"><div data-user-scope=""><div data-cds="UserMessage">
        <div data-testid="user-message">prompt</div>
      </div></div></div>
      <div data-testid="code-working-line" data-turn-working="true"></div>`;
    const detector = createSiteDetector(DEFAULT_CONFIG.sites.claude);
    expect(detector.isGenerating()).toBe(true);
    expect(detector.findAnchor()?.id).toBe('row');

    document.querySelector('[data-testid="code-working-line"]')!.setAttribute('data-turn-working', 'false');
    expect(detector.isGenerating()).toBe(false);
  });
});

describe('deepseek detector', () => {
  it('anchors to the user row, ignores the reply, and detects streaming', () => {
    document.body.innerHTML = `
      <div data-virtual-list-item-key="1" id="user-row"><div class="ds-message"><div><div class="ds-collapsible-text">prompt</div></div></div></div>
      <div data-virtual-list-item-key="2"><div class="ds-message"><div class="ds-markdown">reply</div></div></div>
      <div class="ds-button ds-button--primary ds-button--circle ds-button--disabled"><svg><path d="M8.3125 0.98"></path></svg></div>`;
    const detector = createSiteDetector(DEFAULT_CONFIG.sites.deepseek);
    expect(detector.findAnchor()?.id).toBe('user-row');
    expect(detector.isGenerating()).toBe(false);

    const button = document.querySelector('.ds-button')!;
    button.classList.remove('ds-button--disabled');
    button.querySelector('path')!.setAttribute('d', 'M2 4.88C2 3.68');
    expect(detector.isGenerating()).toBe(true);
  });
});

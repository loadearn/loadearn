import type { SiteSelectors } from '@/lib/types';

export interface SiteDetector {
  isGenerating(): boolean;
  isSuppressed(): boolean;
  findAnchor(): Element | null;
}

function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const element = root.querySelector(selector);
      if (element) return element;
    } catch {
      continue;
    }
  }
  return null;
}

function queryLast(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const elements = root.querySelectorAll(selector);
      const last = elements[elements.length - 1];
      if (last) return last;
    } catch {
      continue;
    }
  }
  return null;
}

function closestMatch(element: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const match = element.closest(selector);
      if (match) return match;
    } catch {
      continue;
    }
  }
  return null;
}

export function createSiteDetector(selectors: SiteSelectors, root: ParentNode = document): SiteDetector {
  return {
    isGenerating: () => queryFirst(root, selectors.generating) !== null,
    isSuppressed: () => queryFirst(root, selectors.suppress) !== null,
    findAnchor: () => {
      const message = queryLast(root, selectors.anchor);
      if (!message) return null;
      return closestMatch(message, selectors.container) ?? message;
    },
  };
}

import { CITATION_PILL_SELECTOR, COMPOSER_ROOT_SELECTOR, MESSAGE_SELECTOR } from "./composer-bridge";

export const OVERLAY_ID = "paseo-cite-overlay";

const EXCLUDED_SELECTOR = `${COMPOSER_ROOT_SELECTOR}, ${CITATION_PILL_SELECTOR}, #${OVERLAY_ID}, textarea, input`;

export interface SelectionSnapshot {
  text: string;
  rect: DOMRect;
  range: Range;
}

export function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof window.Element ? node : node.parentElement;
}

function isExcluded(node: Node | null): boolean {
  return Boolean(elementForNode(node)?.closest(EXCLUDED_SELECTOR));
}

export function readSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (!text || isExcluded(selection.anchorNode) || isExcluded(selection.focusNode)) return null;

  // Cloned so that a later selection cannot move the range cached for a citation.
  const range = selection.getRangeAt(0).cloneRange();
  return { text, rect: range.getBoundingClientRect(), range };
}

function rangeIsConnected(range: Range): boolean {
  return range.startContainer.isConnected && range.endContainer.isConnected;
}

export function liveRect(range: Range | null, fallback: DOMRect): DOMRect {
  if (!range || !rangeIsConnected(range)) return fallback;
  const rect = range.getBoundingClientRect();
  const isEmpty = rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0;
  return isEmpty ? fallback : rect;
}

// Selection.toString() puts line breaks between blocks that textContent joins with
// nothing, so quotes are matched with all whitespace ignored.
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

export function rangeShowsQuote(range: Range, quote: string): boolean {
  return rangeIsConnected(range) && withoutWhitespace(range.toString()) === withoutWhitespace(quote);
}

export function findQuoteRange(scope: Node, quote: string): Range | null {
  const needle = withoutWhitespace(quote);
  if (!needle) return null;

  const { NodeFilter } = window;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === window.Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return (node as Element).matches(EXCLUDED_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP;
    },
  });

  let haystack = "";
  const nodes: Node[] = [];
  const offsets: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    for (let offset = 0; offset < text.length; offset += 1) {
      if (/\s/.test(text[offset])) continue;
      haystack += text[offset];
      nodes.push(node);
      offsets.push(offset);
    }
  }

  const start = haystack.lastIndexOf(needle);
  if (start < 0) return null;
  const end = start + needle.length - 1;
  const range = document.createRange();
  range.setStart(nodes[start], offsets[start]);
  range.setEnd(nodes[end], offsets[end] + 1);
  return range;
}

function reachesAnotherPane(scope: Element): boolean {
  return scope.querySelectorAll(COMPOSER_ROOT_SELECTOR).length > 1;
}

function conversationOf(composer: Element): Element | null {
  for (let scope = composer.parentElement; scope; scope = scope.parentElement) {
    if (reachesAnotherPane(scope)) return null;
    if (scope.querySelector(MESSAGE_SELECTOR)) return scope;
  }
  return null;
}

export function findQuoteNearComposer(
  input: HTMLTextAreaElement | null,
  quote: string,
): Range | null {
  const composer = input?.closest(COMPOSER_ROOT_SELECTOR);
  const scope = composer ? conversationOf(composer) : document.body;
  return scope ? findQuoteRange(scope, quote) : null;
}

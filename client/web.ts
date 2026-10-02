import { Platform } from "react-native";

import type { CitationComposerAttachment } from "./citation-attachment";
import type { CitationEntry } from "./citation-format";
import { findCommittedFiberPath } from "./react-fiber";

import {
  addCitationToAttachments,
  attachmentCitations,
  containsCitationEntry,
  isCitationComposerAttachment,
  normalizeCitationAttachments,
  replaceCitationInAttachments,
} from "./citation-attachment";
import {
  MAX_CITATION_TEXT_LENGTH,
  createCitationEntry,
  formatCitationEntry,
  normalizeCitationText,
  parseCitationEntries,
} from "./citation-format";

type CitationInsertResult =
  | "attached"
  | "inserted"
  | "duplicate"
  | "too-large"
  | "not-web"
  | "composer-not-found";

interface DomEvent {
  altKey?: boolean;
  isComposing?: boolean;
  key?: string;
  keyCode?: number;
  preventDefault(): void;
  shiftKey?: boolean;
  stopPropagation(): void;
  target?: DomElement | null;
}

type DomListener = (event: DomEvent) => void;

// querySelectorAll returns a NodeList, which has no array methods.
type DomNodeList<T> = ArrayLike<T> & Iterable<T>;

interface DomElement {
  id: string;
  isConnected?: boolean;
  value?: string;
  textContent: string | null;
  style: Record<string, string>;
  parentElement: DomElement | null;
  appendChild(child: DomElement): void;
  remove(): void;
  focus(): void;
  contains(node: unknown): boolean;
  getBoundingClientRect(): DomRect;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomNodeList<DomElement>;
  scrollIntoView(options?: { behavior?: string; block?: string }): void;
  closest(selector: string): DomElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: DomListener, options?: boolean): void;
  removeEventListener(type: string, listener: DomListener, options?: boolean): void;
  dispatchEvent(event: unknown): boolean;
}

interface DomTextInput extends DomElement {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
}

interface DomRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface DomRange {
  commonAncestorContainer: DomElement;
  startContainer: DomElement;
  startOffset: number;
  endContainer: DomElement;
  endOffset: number;
  cloneRange(): DomRange;
  getBoundingClientRect(): DomRect;
  getClientRects(): ArrayLike<DomRect>;
  setStart(container: DomElement, offset: number): void;
  setEnd(container: DomElement, offset: number): void;
  toString(): string;
}

interface DomSelection {
  isCollapsed: boolean;
  anchorNode: DomElement | null;
  focusNode: DomElement | null;
  rangeCount: number;
  getRangeAt(index: number): DomRange;
  addRange(range: DomRange): void;
  removeAllRanges(): void;
  toString(): string;
}

interface DomDocument {
  activeElement: DomElement | null;
  body: DomElement;
  createElement(tagName: string): DomElement;
  createRange(): DomRange;
  getElementById(id: string): DomElement | null;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): DomNodeList<DomElement>;
  addEventListener(type: string, listener: DomListener, options?: boolean): void;
  removeEventListener(type: string, listener: DomListener, options?: boolean): void;
}

interface DomWindow {
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
  getSelection(): DomSelection | null;
  find(
    text: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
  ): boolean;
  innerWidth: number;
  innerHeight: number;
  addEventListener(type: string, listener: DomListener, options?: boolean): void;
  removeEventListener(type: string, listener: DomListener, options?: boolean): void;
  setTimeout(handler: () => void, timeout: number): unknown;
  clearTimeout(handle: unknown): void;
}

declare const document: DomDocument;
declare const window: DomWindow;

const OVERLAY_ID = "paseo-cite-overlay";
const CITE_BUTTON_ID = "paseo-cite-button";
const CITE_PANEL_ID = "paseo-cite-panel";
const CITATION_PILL_SELECTOR = '[data-testid="composer-plugin-resource-attachment-pill"]';
const FONT_STACK =
  'var(--paseo-ui-font, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)';
const FOREGROUND = "var(--colors-foreground, #1a1a1e)";
const MUTED_FOREGROUND = "var(--colors-foreground-muted, #71717a)";
const BORDER = "var(--colors-border, #e4e4e7)";
const SURFACE = "var(--colors-surface0, #ffffff)";
const RAISED_SURFACE = "var(--colors-surface1, #fafafa)";
const ACCENT = "var(--colors-accent, #20744a)";
const ACCENT_FOREGROUND = "var(--colors-accent-foreground, #ffffff)";
const DESTRUCTIVE = "var(--colors-destructive, #dc2626)";
const COMPOSER_INPUT_SELECTOR = '[data-testid="message-input-root"] textarea';
const EXCLUDED_SELECTOR =
  '[data-testid="message-input-root"], [data-testid="paseo-cite-overlay"], textarea, input';
const SELECTION_CHANGE_SUPPRESSION_MS = 250;

function isBrowserRuntime(): boolean {
  return (
    Platform.OS === "web" ||
    (typeof document !== "undefined" && typeof window !== "undefined")
  );
}

interface CitationOverlayOptions {
  copyFallback(text: string): Promise<void>;
}

interface SelectionSnapshot {
  text: string;
  rect: DomRect;
  range: DomRange;
  anchorElement: DomElement | null;
  composerInput: DomTextInput | null;
}

interface ComposerAttachmentBridge {
  attachments: unknown[];
  setAttachments(nextAttachments: unknown[]): void;
}

interface EditingCitation {
  entry: CitationEntry;
  bridgeInput: DomTextInput;
  pill: DomElement;
  range: DomRange | null;
}

interface CitedSelection {
  text: string;
  range: DomRange;
  anchorElement: DomElement | null;
  composerInput: DomTextInput | null;
}

let activeOverlayCleanup: (() => void) | null = null;

function setStyles(element: DomElement, styles: Record<string, string>): void {
  Object.assign(element.style, styles);
}

function createTextElement(tagName: string, text: string): DomElement {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function addChild(parent: DomElement, child: DomElement): DomElement {
  parent.appendChild(child);
  return child;
}

function elementForNode(node: DomElement | null): DomElement | null {
  return node?.parentElement ?? node;
}

function elementIsConnected(element: DomElement | null): boolean {
  return Boolean(element && element.isConnected !== false);
}

// Hidden panes can stay mounted. Their composers have an empty rect.
function elementIsVisible(element: DomElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.right > rect.left && rect.bottom > rect.top;
}

function nearestComposerInput(
  candidates: DomNodeList<DomTextInput>,
  referenceRect: DomRect | null,
): DomTextInput | null {
  const visibleCandidates = Array.from(candidates).filter(elementIsVisible);
  return visibleCandidates.reduce<DomTextInput | null>((closest, candidate) => {
    if (!closest || !referenceRect) return closest ?? candidate;
    return rectDistance(referenceRect, candidate.getBoundingClientRect()) <
      rectDistance(referenceRect, closest.getBoundingClientRect())
      ? candidate
      : closest;
  }, null);
}

function findComposerInputNearElement(
  element: DomElement | null,
  referenceRect: DomRect | null = null,
): DomTextInput | null {
  let current = element;
  while (current) {
    const inputs = current.querySelectorAll(COMPOSER_INPUT_SELECTOR) as DomNodeList<DomTextInput>;
    const input = nearestComposerInput(inputs, referenceRect);
    if (input) return input;
    current = current.parentElement;
  }
  return null;
}

function rectDistance(left: DomRect, right: DomRect): number {
  const horizontalDistance =
    left.right < right.left
      ? right.left - left.right
      : right.right < left.left
        ? left.left - right.right
        : 0;
  const verticalDistance =
    left.bottom < right.top
      ? right.top - left.bottom
      : right.bottom < left.top
        ? left.top - right.bottom
        : 0;
  return horizontalDistance ** 2 + verticalDistance ** 2;
}

function findComposerInputForSelection(
  anchorElement: DomElement | null,
  selectionRect: DomRect,
): DomTextInput | null {
  const nearbyInput = findComposerInputNearElement(anchorElement, selectionRect);
  if (nearbyInput) return nearbyInput;

  const candidates = document.querySelectorAll(COMPOSER_INPUT_SELECTOR) as DomNodeList<DomTextInput>;
  return nearestComposerInput(candidates, selectionRect);
}

function currentSelectionRect(selection: SelectionSnapshot): DomRect {
  if (elementIsConnected(selection.anchorElement)) {
    const rect = selection.range.getBoundingClientRect();
    if (rect.top !== 0 || rect.left !== 0 || rect.right !== 0 || rect.bottom !== 0) {
      return rect;
    }
  }
  return selection.rect;
}

function selectionInsideExcludedElement(selection: DomSelection): boolean {
  const anchor = elementForNode(selection.anchorNode);
  const focus = elementForNode(selection.focusNode);
  return Boolean(anchor?.closest(EXCLUDED_SELECTOR) || focus?.closest(EXCLUDED_SELECTOR));
}

function readSelection(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().trim();
  if (!text || selectionInsideExcludedElement(selection)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const anchorElement = elementForNode(range.commonAncestorContainer);
  return {
    text,
    rect,
    range,
    anchorElement,
    composerInput: findComposerInputForSelection(anchorElement, rect),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function positionElement(element: DomElement, rect: DomRect, height: number): void {
  const width = 78;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
  const top = rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8;
  element.style.left = `${left}px`;
  element.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`;
}

function rectIsEmpty(rect: DomRect): boolean {
  return rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0;
}

function positionPanel(element: DomElement, rect: DomRect): void {
  const width = 560;
  const measured = element.getBoundingClientRect();
  const height = measured.bottom - measured.top || 214;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
  const top = rect.bottom + 8 + height <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8;
  element.style.left = `${left}px`;
  element.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`;
}

function dispatchInputEvent(input: DomTextInput): void {
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function replaceNativeInputValue(input: DomTextInput, value: string): void {
  const prototype = Object.getPrototypeOf(input) as object | null;
  const descriptor = prototype
    ? (Object.getOwnPropertyDescriptor(prototype, "value") as
        | { set?: (nextValue: string) => void }
        | undefined)
    : undefined;

  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  dispatchInputEvent(input);
}

function findComposerAttachmentBridge(input: DomElement): ComposerAttachmentBridge | null {
  for (const fiber of findCommittedFiberPath(input) ?? []) {
    const props = fiber.memoizedProps;
    if (
      props &&
      Array.isArray(props.attachments) &&
      typeof props.onChangeAttachments === "function"
    ) {
      return {
        attachments: props.attachments,
        setAttachments: props.onChangeAttachments as (nextAttachments: unknown[]) => void,
      };
    }
  }
  return null;
}

function migrateBridgeCitationAttachments(bridge: ComposerAttachmentBridge): void {
  const nextAttachments = normalizeCitationAttachments(bridge.attachments);
  if (nextAttachments) bridge.setAttachments(nextAttachments);
}

// Paseo renders each plugin pill with its own attachment as the "attachment" prop.
function citationAttachmentForPill(pill: DomElement): CitationComposerAttachment | null {
  for (const fiber of findCommittedFiberPath(pill) ?? []) {
    const attachment = fiber.memoizedProps?.attachment;
    if (attachment && typeof attachment === "object") {
      return isCitationComposerAttachment(attachment) ? attachment : null;
    }
  }
  return null;
}

function highlightCitationText(
  text: string,
  range: DomRange | null,
  anchorElement: DomElement | null,
): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  const rangeElement = range ? elementForNode(range.commonAncestorContainer) : null;
  if (
    range &&
    elementIsConnected(rangeElement) &&
    normalizeCitationText(range.toString()) === normalizeCitationText(text)
  ) {
    selection.removeAllRanges();
    selection.addRange(range);
    rangeElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  selection.removeAllRanges();
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) ?? text;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const searchTerms = Array.from(new Set([text, firstLine].filter(Boolean)));

  for (const searchText of searchTerms) {
    selection.removeAllRanges();
    for (let attempt = 0; attempt < 64; attempt += 1) {
      if (!window.find(searchText, false, false, true)) break;

      const anchorNode = selection.anchorNode ?? null;
      if (anchorElement && !anchorElement.contains(anchorNode)) continue;

      if (searchText === text || lines.length < 2) {
        elementForNode(anchorNode)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }

      const startRange = selection.getRangeAt(0);
      const lastLine = lines[lines.length - 1];
      if (!window.find(lastLine, false, false, false)) continue;

      const endRange = selection.getRangeAt(0);
      const endNode = selection.anchorNode ?? null;
      if (anchorElement && !anchorElement.contains(endNode)) continue;

      const completeRange = document.createRange();
      completeRange.setStart(startRange.startContainer, startRange.startOffset);
      completeRange.setEnd(endRange.endContainer, endRange.endOffset);
      selection.removeAllRanges();
      selection.addRange(completeRange);
      elementForNode(anchorNode)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
  }

  return false;
}

function tryAttachCitationToComposer(
  input: DomTextInput,
  entry: CitationEntry,
): "attached" | "duplicate" | false {
  const attachmentBridge = findComposerAttachmentBridge(input);
  if (!attachmentBridge) return false;

  const nextAttachments = addCitationToAttachments(attachmentBridge.attachments, entry);
  if (nextAttachments === "duplicate") return nextAttachments;
  try {
    attachmentBridge.setAttachments(nextAttachments);
    return "attached";
  } catch {
    return false;
  }
}

export function appendCitationToComposer(
  entry: CitationEntry,
  preferredInput: DomTextInput | null = null,
): CitationInsertResult {
  if (!isBrowserRuntime()) {
    return "not-web";
  }

  const input =
    (preferredInput && elementIsConnected(preferredInput) && elementIsVisible(preferredInput)
      ? preferredInput
      : null) ??
    nearestComposerInput(document.querySelectorAll(COMPOSER_INPUT_SELECTOR) as DomNodeList<DomTextInput>, null);
  if (!input) {
    return "composer-not-found";
  }

  const attachmentResult = tryAttachCitationToComposer(input, entry);
  if (attachmentResult === "attached") {
    input.focus();
    return "attached";
  }
  if (attachmentResult === "duplicate") {
    return attachmentResult;
  }

  if (containsCitationEntry(parseCitationEntries(input.value), entry)) return "duplicate";
  const formattedCitation = formatCitationEntry(entry);
  const currentDraft = input.value.trimEnd();
  const nextDraft = currentDraft ? `${currentDraft}\n\n${formattedCitation}` : formattedCitation;
  if (nextDraft.length > MAX_CITATION_TEXT_LENGTH) return "too-large";
  replaceNativeInputValue(input, nextDraft);
  input.focus();
  input.setSelectionRange(nextDraft.length, nextDraft.length);
  return "inserted";
}

function setStylesForOverlayRoot(root: DomElement): void {
  setStyles(root, {
    fontFamily: FONT_STACK,
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
}

function styleButton(button: DomElement): void {
  setStyles(button, {
    position: "fixed",
    pointerEvents: "auto",
    padding: "7px 11px",
    border: `1px solid ${BORDER}`,
    borderRadius: "10px",
    background: ACCENT,
    color: ACCENT_FOREGROUND,
    fontFamily: FONT_STACK,
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: "600",
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgb(0 0 0 / 16%), 0 1px 3px rgb(0 0 0 / 10%)",
    transition: "transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
  });
}

function stylePanel(panel: DomElement): void {
  setStyles(panel, {
    position: "fixed",
    width: "560px",
    maxWidth: "calc(100vw - 24px)",
    padding: "12px 14px 14px",
    pointerEvents: "auto",
    border: `1px solid ${BORDER}`,
    borderRadius: "12px",
    background: RAISED_SURFACE,
    color: FOREGROUND,
    boxShadow: "0 12px 30px rgb(0 0 0 / 18%), 0 3px 8px rgb(0 0 0 / 10%)",
    boxSizing: "border-box",
    fontFamily: FONT_STACK,
    fontSize: "14px",
    lineHeight: "1.4",
    colorScheme: "light dark",
    backdropFilter: "blur(16px)",
  });
}

function styleTextArea(textarea: DomElement): void {
  setStyles(textarea, {
    display: "block",
    width: "100%",
    minHeight: "130px",
    margin: "0 0 16px",
    padding: "12px 14px",
    boxSizing: "border-box",
    resize: "vertical",
    border: `2px solid ${ACCENT}`,
    borderRadius: "10px",
    background: SURFACE,
    color: FOREGROUND,
    fontFamily: FONT_STACK,
    fontSize: "14px",
    lineHeight: "1.45",
    outline: "none",
  });
}

function styleActionButton(button: DomElement, primary: boolean): void {
  setStyles(button, {
    padding: primary ? "8px 16px" : "8px",
    border: "1px solid transparent",
    borderRadius: primary ? "10px" : "8px",
    background: primary ? ACCENT : "transparent",
    color: primary ? ACCENT_FOREGROUND : MUTED_FOREGROUND,
    fontFamily: FONT_STACK,
    fontSize: "15px",
    lineHeight: "18px",
    fontWeight: "400",
    cursor: "pointer",
    boxShadow: primary ? "0 1px 2px rgb(0 0 0 / 10%)" : "none",
    transition: "background 120ms ease, opacity 120ms ease",
  });
}

export function startCitationOverlay(options: CitationOverlayOptions): () => void {
  if (!isBrowserRuntime()) {
    return () => {};
  }

  activeOverlayCleanup?.();
  document.getElementById(OVERLAY_ID)?.remove();

  const root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.setAttribute("data-testid", OVERLAY_ID);
  setStylesForOverlayRoot(root);

  const citeButton = addChild(root, createTextElement("button", "Cite"));
  citeButton.id = CITE_BUTTON_ID;
  citeButton.setAttribute("type", "button");
  citeButton.setAttribute("aria-label", "Cite selected answer text");
  styleButton(citeButton);
  citeButton.style.display = "none";

  const panel = addChild(root, document.createElement("form"));
  panel.id = CITE_PANEL_ID;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Add a citation comment");
  panel.setAttribute("tabindex", "-1");
  stylePanel(panel);
  panel.style.display = "none";

  // Shows the full quote when you edit a citation, because the pill shows only part of it.
  const quoteText = addChild(panel, document.createElement("div"));
  setStyles(quoteText, {
    display: "none",
    margin: "0 0 10px",
    padding: "2px 0 2px 10px",
    maxHeight: "72px",
    overflow: "auto",
    borderLeft: `3px solid ${BORDER}`,
    color: MUTED_FOREGROUND,
    fontSize: "13px",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  });

  const commentInput = addChild(panel, document.createElement("textarea")) as DomTextInput;
  commentInput.setAttribute("aria-label", "Citation comment");
  commentInput.setAttribute("placeholder", "Leave a comment");
  styleTextArea(commentInput);

  const actions = addChild(panel, document.createElement("div"));
  setStyles(actions, { display: "flex", justifyContent: "flex-end", gap: "20px" });

  const cancelButton = addChild(actions, createTextElement("button", "Cancel"));
  cancelButton.setAttribute("type", "button");
  styleActionButton(cancelButton, false);

  const submitButton = addChild(actions, createTextElement("button", "Comment"));
  submitButton.setAttribute("type", "submit");
  submitButton.setAttribute("disabled", "");
  styleActionButton(submitButton, true);
  submitButton.style.opacity = "0.48";
  submitButton.style.cursor = "default";

  const toast = addChild(root, createTextElement("div", ""));
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  setStyles(toast, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    display: "none",
    pointerEvents: "none",
    maxWidth: "min(420px, calc(100vw - 24px))",
    padding: "9px 13px",
    borderRadius: "10px",
    boxSizing: "border-box",
    background: RAISED_SURFACE,
    color: FOREGROUND,
    border: `1px solid ${BORDER}`,
    boxShadow: "0 8px 24px rgb(0 0 0 / 18%)",
    fontFamily: FONT_STACK,
    fontSize: "13px",
    lineHeight: "18px",
  });

  // The page selection moves into the comment box when it gets focus, so draw the
  // highlight for an edited citation separately.
  const highlightLayer = addChild(root, document.createElement("div"));

  document.body.appendChild(root);

  const migrateExistingCitationAttachments = (): void => {
    for (const input of document.querySelectorAll(COMPOSER_INPUT_SELECTOR)) {
      const bridge = findComposerAttachmentBridge(input);
      if (bridge) migrateBridgeCitationAttachments(bridge);
    }
  };
  migrateExistingCitationAttachments();

  let activeSelection: SelectionSnapshot | null = null;
  let editingCitation: EditingCitation | null = null;
  let citedSelections: CitedSelection[] = [];
  let previousFocusedElement: DomElement | null = null;
  let toastTimer: unknown = null;
  let ignoreSelectionChangesTimer: unknown = null;
  let selectionCommitTimer: unknown = null;

  const suppressSelectionChanges = (): void => {
    if (ignoreSelectionChangesTimer !== null) window.clearTimeout(ignoreSelectionChangesTimer);
    ignoreSelectionChangesTimer = window.setTimeout(() => {
      ignoreSelectionChangesTimer = null;
    }, SELECTION_CHANGE_SUPPRESSION_MS);
  };

  const showToast = (message: string, isError = false): void => {
    toast.textContent = message;
    toast.style.color = isError ? DESTRUCTIVE : FOREGROUND;
    toast.style.display = "block";
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.style.display = "none";
      toastTimer = null;
    }, 2600);
  };

  const drawEditHighlight = (): void => {
    highlightLayer.textContent = "";
    const range = editingCitation?.range;
    if (!range || !elementIsConnected(elementForNode(range.commonAncestorContainer))) return;
    for (const rect of Array.from(range.getClientRects())) {
      const box = addChild(highlightLayer, document.createElement("div"));
      setStyles(box, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.right - rect.left}px`,
        height: `${rect.bottom - rect.top}px`,
        background: "var(--colors-accent-muted, rgb(32 116 74 / 25%))",
        borderRadius: "2px",
      });
    }
  };

  const panelAnchorRect = (): DomRect | null => {
    if (activeSelection) return currentSelectionRect(activeSelection);
    if (!editingCitation) return null;
    const range = editingCitation.range;
    if (range && elementIsConnected(elementForNode(range.commonAncestorContainer))) {
      const rect = range.getBoundingClientRect();
      if (!rectIsEmpty(rect)) return rect;
    }
    return editingCitation.pill.getBoundingClientRect();
  };

  const closePanel = (): void => {
    panel.style.display = "none";
    citeButton.style.display = "none";
    activeSelection = null;
    editingCitation = null;
    highlightLayer.textContent = "";

    const elementToRestore = previousFocusedElement;
    previousFocusedElement = null;
    if (elementIsConnected(elementToRestore)) elementToRestore?.focus();
  };

  const openPanel = (comment: string, quote: string | null): void => {
    const rect = panelAnchorRect();
    if (!rect) return;
    previousFocusedElement = document.activeElement;
    citeButton.style.display = "none";
    panel.setAttribute(
      "aria-label",
      quote === null ? "Add a citation comment" : "Edit the citation comment",
    );
    quoteText.textContent = quote ?? "";
    quoteText.style.display = quote === null ? "none" : "block";
    submitButton.textContent = quote === null ? "Comment" : "Save";
    commentInput.value = comment;
    updateSubmitButton();
    panel.style.display = "block";
    positionPanel(panel, rect);
    commentInput.focus();
    commentInput.setSelectionRange(comment.length, comment.length);
  };

  const showPanel = (): void => {
    if (activeSelection) openPanel("", null);
  };

  const focusablePanelElements = (): DomNodeList<DomElement> =>
    panel.querySelectorAll("button, textarea, [tabindex]");

  const updateSubmitButton = (): void => {
    if (commentInput.value.trim()) {
      submitButton.removeAttribute("disabled");
      submitButton.style.opacity = "1";
      submitButton.style.cursor = "pointer";
      return;
    }

    submitButton.setAttribute("disabled", "");
    submitButton.style.opacity = "0.48";
    submitButton.style.cursor = "default";
  };

  const handleSelectionChange = (): void => {
    if (ignoreSelectionChangesTimer !== null || panel.style.display === "block") return;
    const nextSelection = readSelection();
    activeSelection = nextSelection;
    if (!nextSelection) {
      citeButton.style.display = "none";
      return;
    }
    positionElement(citeButton, currentSelectionRect(nextSelection), 30);
    citeButton.style.display = "block";
  };

  // selectionchange does not always fire after a pointer or key selection ends.
  const scheduleSelectionChange: DomListener = (event) => {
    const target = event.target ?? null;
    if (target && root.contains(target)) return;

    if (selectionCommitTimer !== null) window.clearTimeout(selectionCommitTimer);
    selectionCommitTimer = window.setTimeout(() => {
      selectionCommitTimer = null;
      handleSelectionChange();
    }, 0);
  };

  const handleCiteButtonMouseDown: DomListener = (event) => {
    event.preventDefault();
  };
  const handleCiteButtonClick: DomListener = (event) => {
    event.preventDefault();
    event.stopPropagation();
    showPanel();
  };
  const handleCancel: DomListener = (event) => {
    event.preventDefault();
    closePanel();
  };
  const saveEditedCitation = (editing: EditingCitation): void => {
    const entry = createCitationEntry(editing.entry.quote, commentInput.value);
    if (!entry) {
      showToast("This comment is too large to save.", true);
      return;
    }
    if (entry.comment === editing.entry.comment) {
      closePanel();
      return;
    }

    const bridge = findComposerAttachmentBridge(editing.bridgeInput);
    const result = bridge
      ? replaceCitationInAttachments(bridge.attachments, editing.entry, entry)
      : "missing";
    if (result === "duplicate") {
      showToast("This citation is already in the composer.");
      return;
    }
    closePanel();
    if (result === "missing" || !bridge) {
      showToast("This citation is no longer in the composer.", true);
      return;
    }
    bridge.setAttachments(result);
  };

  const handleSubmit: DomListener = (event) => {
    event.preventDefault();
    if (!commentInput.value.trim()) return;
    if (editingCitation) {
      saveEditedCitation(editingCitation);
      return;
    }
    if (!activeSelection) return;

    const submittedSelection = activeSelection;
    const entry = createCitationEntry(submittedSelection.text, commentInput.value);
    if (!entry) {
      showToast("This citation is too large to add.", true);
      return;
    }
    const result = appendCitationToComposer(entry, submittedSelection.composerInput);
    if (result === "attached" || result === "inserted") {
      citedSelections = citedSelections.filter(
        (cited) =>
          elementIsConnected(cited.anchorElement) &&
          !(cited.text === entry.quote && cited.composerInput === submittedSelection.composerInput),
      );
      citedSelections.push({
        text: entry.quote,
        range: submittedSelection.range,
        anchorElement: submittedSelection.anchorElement,
        composerInput: submittedSelection.composerInput,
      });
      closePanel();
      return;
    }

    if (result === "duplicate") {
      closePanel();
      showToast("This citation is already in the composer.");
      return;
    }

    if (result === "too-large") {
      showToast("This citation is too large to add.", true);
      return;
    }

    void options
      .copyFallback(formatCitationEntry(entry))
      .then(() => {
        closePanel();
        showToast(
          result === "not-web"
            ? "Citation copied. Paste it into your message."
            : "Composer not found. Citation copied for paste.",
        );
      })
      .catch(() => showToast("Could not add or copy the citation.", true));
  };
  const handleCommentInput: DomListener = () => {
    updateSubmitButton();
  };
  const handlePanelEscape: DomListener = (event) => {
    if (event.key === "Tab") {
      const focusable = focusablePanelElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key !== "Escape") return;

    event.preventDefault();
    event.stopPropagation();
    closePanel();
  };
  const handleCommentInputKeyDown: DomListener = (event) => {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;

    event.stopPropagation();
    if (event.shiftKey || event.altKey) return;

    event.preventDefault();
    handleSubmit(event);
  };
  const handleCommentInputFocus: DomListener = () => {
    commentInput.style.borderColor = ACCENT;
    commentInput.style.boxShadow = "0 0 0 3px var(--colors-accent-muted, rgb(32 116 74 / 25%))";
  };
  const handleCommentInputBlur: DomListener = () => {
    commentInput.style.borderColor = ACCENT;
    commentInput.style.boxShadow = "none";
  };
  const handleOutsidePointerDown: DomListener = (event) => {
    const target = event.target ?? null;
    if (
      panel.style.display === "block" &&
      !panel.contains(target) &&
      !citeButton.contains(target)
    ) {
      closePanel();
    }
  };
  const handleCitationAttachmentClick: DomListener = (event) => {
    const pill = event.target?.closest(CITATION_PILL_SELECTOR) ?? null;
    const attachment = pill ? citationAttachmentForPill(pill) : null;
    if (!pill || !attachment) return;

    event.preventDefault();
    event.stopPropagation();

    closePanel();
    const input = findComposerInputNearElement(pill.parentElement ?? pill, pill.getBoundingClientRect());
    const bridge = input ? findComposerAttachmentBridge(input) : null;
    if (bridge) migrateBridgeCitationAttachments(bridge);

    // A combined attachment from an earlier version goes to its latest citation.
    const entry = attachmentCitations(attachment).at(-1);
    const cited = citedSelections.find(
      (selection) => selection.composerInput === input && selection.text === entry?.quote,
    );
    suppressSelectionChanges();

    if (!entry) return;
    const found = highlightCitationText(
      entry.quote,
      cited?.range ?? null,
      cited?.anchorElement ?? null,
    );
    const selection = window.getSelection();
    const range =
      found && selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (!found) showToast("Could not find the cited text in this conversation.", true);
    if (!input || !bridge) return;

    editingCitation = { entry, bridgeInput: input, pill, range };
    drawEditHighlight();
    openPanel(entry.comment, entry.quote);
  };
  const handleWindowChange = (): void => {
    const rect = panelAnchorRect();
    if (!rect) return;
    if (panel.style.display === "block") {
      positionPanel(panel, rect);
      drawEditHighlight();
    } else {
      positionElement(citeButton, rect, 30);
    }
  };

  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("pointerup", scheduleSelectionChange, true);
  document.addEventListener("keyup", scheduleSelectionChange, true);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);
  citeButton.addEventListener("mousedown", handleCiteButtonMouseDown);
  citeButton.addEventListener("click", handleCiteButtonClick);
  cancelButton.addEventListener("click", handleCancel);
  panel.addEventListener("submit", handleSubmit);
  panel.addEventListener("keydown", handlePanelEscape);
  commentInput.addEventListener("input", handleCommentInput);
  commentInput.addEventListener("keydown", handleCommentInputKeyDown);
  commentInput.addEventListener("focus", handleCommentInputFocus);
  commentInput.addEventListener("blur", handleCommentInputBlur);
  document.addEventListener("mousedown", handleOutsidePointerDown, true);
  document.addEventListener("click", handleCitationAttachmentClick, true);

  const cleanup = (): void => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("pointerup", scheduleSelectionChange, true);
    document.removeEventListener("keyup", scheduleSelectionChange, true);
    window.removeEventListener("resize", handleWindowChange);
    window.removeEventListener("scroll", handleWindowChange, true);
    citeButton.removeEventListener("mousedown", handleCiteButtonMouseDown);
    citeButton.removeEventListener("click", handleCiteButtonClick);
    cancelButton.removeEventListener("click", handleCancel);
    panel.removeEventListener("submit", handleSubmit);
    panel.removeEventListener("keydown", handlePanelEscape);
    commentInput.removeEventListener("input", handleCommentInput);
    commentInput.removeEventListener("keydown", handleCommentInputKeyDown);
    commentInput.removeEventListener("focus", handleCommentInputFocus);
    commentInput.removeEventListener("blur", handleCommentInputBlur);
    document.removeEventListener("mousedown", handleOutsidePointerDown, true);
    document.removeEventListener("click", handleCitationAttachmentClick, true);
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    if (ignoreSelectionChangesTimer !== null) window.clearTimeout(ignoreSelectionChangesTimer);
    if (selectionCommitTimer !== null) window.clearTimeout(selectionCommitTimer);
    if (activeOverlayCleanup === cleanup) activeOverlayCleanup = null;
    root.remove();
  };

  activeOverlayCleanup = cleanup;
  return cleanup;
}

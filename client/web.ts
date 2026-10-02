import { Platform } from "react-native";

import type { CitationEntry } from "./citation-format";
import { findCommittedFiber, findReactFiber } from "./react-fiber";
import type { ReactFiberNode } from "./react-fiber";

import {
  MAX_CITATION_TEXT_LENGTH,
  formatCitation,
  normalizeCitationEntry,
  normalizeCitationText,
  parseCitationEntries,
  serializeCitationEntries,
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
  querySelectorAll(selector: string): DomElement[];
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
  getBoundingClientRect(): DomRect;
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
  querySelectorAll(selector: string): DomElement[];
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
const CITATION_PLUGIN_ID = "paseo-cite";
const CITATION_SOURCE_ID = "citations";
const CITATION_URL = "paseo-cite://citation";
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

interface CitationComposerAttachment {
  kind: "plugin_resource";
  pluginId: string;
  sourceId: string;
  sourceTitle: string;
  sourceIcon: string;
  citations?: CitationEntry[];
  item: {
    id: string;
    identifier: string;
    title: string;
    subtitle: string;
    url: string;
    text: string;
    resourceType: string;
  };
}

interface ComposerAttachmentBridge {
  attachments: unknown[];
  setAttachments(nextAttachments: unknown[]): void;
}

interface LatestCitation {
  text: string;
  range: DomRange;
  anchorElement: DomElement | null;
  composerInput: DomTextInput | null;
}

class CitationTooLargeError extends Error {}

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

function nearestComposerInput(
  candidates: DomTextInput[],
  referenceRect: DomRect | null,
): DomTextInput | null {
  return candidates.reduce<DomTextInput | null>((closest, candidate) => {
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
    const inputs = current.querySelectorAll(COMPOSER_INPUT_SELECTOR) as DomTextInput[];
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

  const candidates = document.querySelectorAll(COMPOSER_INPUT_SELECTOR) as DomTextInput[];
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

function positionPanel(element: DomElement, rect: DomRect): void {
  const width = 560;
  const height = 214;
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
  const cachedFiber = findReactFiber(input);
  let fiber: ReactFiberNode | null = cachedFiber ? findCommittedFiber(cachedFiber) : null;
  while (fiber) {
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
    fiber = fiber.return ?? null;
  }
  return null;
}

function isCitationComposerAttachment(value: unknown): value is CitationComposerAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<CitationComposerAttachment>;
  return (
    attachment.kind === "plugin_resource" &&
    attachment.pluginId === CITATION_PLUGIN_ID &&
    attachment.sourceId === CITATION_SOURCE_ID &&
    Boolean(attachment.item && typeof attachment.item.text === "string")
  );
}

function isPluginResourceAttachment(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" && (value as { kind?: unknown }).kind === "plugin_resource",
  );
}

function attachmentForPill(
  pill: DomElement | null,
  bridge: ComposerAttachmentBridge,
): unknown | null {
  if (!pill?.parentElement) return null;
  const pills = pill.parentElement.querySelectorAll(CITATION_PILL_SELECTOR);
  let pillIndex = -1;
  for (let index = 0; index < pills.length; index += 1) {
    if (pills[index] === pill) {
      pillIndex = index;
      break;
    }
  }
  if (pillIndex < 0) return null;

  const pluginAttachments = bridge.attachments.filter(isPluginResourceAttachment);
  return pluginAttachments[pillIndex] ?? null;
}

function attachmentCitations(attachment: CitationComposerAttachment): CitationEntry[] {
  const structuredCitations = attachment.citations?.map(normalizeCitationEntry) ?? [];
  return structuredCitations.length > 0
    ? structuredCitations
    : parseCitationEntries(attachment.item.text);
}

function sameCitationEntries(left: CitationEntry[], right: CitationEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.quote === right[index]?.quote && entry.comment === right[index]?.comment,
    )
  );
}

function normalizeCitationComposerAttachment(
  attachment: CitationComposerAttachment,
): CitationComposerAttachment {
  const citations = attachmentCitations(attachment);
  return {
    ...attachment,
    sourceTitle: "Citation",
    citations,
    item: {
      ...attachment.item,
      identifier: `${citations.length} comment${citations.length === 1 ? "" : "s"}`,
      title: "Citation",
      subtitle: String(citations.length),
      url: CITATION_URL,
      text: citations.length ? serializeCitationEntries(citations) : attachment.item.text,
    },
  };
}

function migrateCitationAttachments(bridge: ComposerAttachmentBridge): void {
  let changed = false;
  const nextAttachments = bridge.attachments.map((attachment) => {
    if (!isCitationComposerAttachment(attachment)) return attachment;

    const normalized = normalizeCitationComposerAttachment(attachment);
    const citations = attachmentCitations(attachment);
    changed =
      changed ||
      attachment.sourceTitle !== normalized.sourceTitle ||
      attachment.item.identifier !== normalized.item.identifier ||
      attachment.item.title !== normalized.item.title ||
      attachment.item.subtitle !== normalized.item.subtitle ||
      attachment.item.url !== normalized.item.url ||
      attachment.item.text !== normalized.item.text ||
      !sameCitationEntries(attachment.citations ?? [], citations);
    return normalized;
  });

  if (changed) bridge.setAttachments(nextAttachments);
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

function isCitationPillTarget(target: DomElement | null): boolean {
  const pill = target?.closest(CITATION_PILL_SELECTOR);
  return Boolean(pill?.textContent?.toLowerCase().includes("citation"));
}

function isCitationRemoveTarget(target: DomElement | null): boolean {
  const labelledElement = target?.closest("[aria-label],[data-testid],[title]");
  const label = [
    labelledElement?.getAttribute("aria-label"),
    labelledElement?.getAttribute("data-testid"),
    labelledElement?.getAttribute("title"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /remove|delete|discard|clear/.test(label);
}

function buildCitationComposerAttachment(
  attachments: unknown[],
  citation: string,
): CitationComposerAttachment | "duplicate" {
  const previous = attachments.find(isCitationComposerAttachment);
  const previousCitations = previous ? attachmentCitations(previous) : [];
  const newCitation = parseCitationEntries(citation).at(-1);
  if (!newCitation) throw new Error("Citation text is invalid");
  if (
    previousCitations.some(
      (entry) => entry.quote === newCitation.quote && entry.comment === newCitation.comment,
    )
  ) {
    return "duplicate";
  }

  const citations = [...previousCitations, newCitation];
  const text = serializeCitationEntries(citations);
  if (text.length > MAX_CITATION_TEXT_LENGTH) {
    throw new CitationTooLargeError("Citation attachment is too large");
  }

  return {
    kind: "plugin_resource",
    pluginId: CITATION_PLUGIN_ID,
    sourceId: CITATION_SOURCE_ID,
    sourceTitle: "Citation",
    sourceIcon: "MessageSquareCode",
    citations,
    item: {
      id: "conversation-citations",
      identifier: `${citations.length} comment${citations.length === 1 ? "" : "s"}`,
      title: "Citation",
      subtitle: String(citations.length),
      url: CITATION_URL,
      text,
      resourceType: "conversation-citation",
    },
  };
}

function tryAttachCitationToComposer(
  input: DomTextInput,
  citation: string,
): "attached" | "duplicate" | "too-large" | false {
  const attachmentBridge = findComposerAttachmentBridge(input);
  if (!attachmentBridge) return false;

  try {
    const citationAttachment = buildCitationComposerAttachment(
      attachmentBridge.attachments,
      citation,
    );
    if (citationAttachment === "duplicate") return "duplicate";
    const otherAttachments = attachmentBridge.attachments.filter(
      (attachment) => !isCitationComposerAttachment(attachment),
    );
    attachmentBridge.setAttachments([...otherAttachments, citationAttachment]);
    return "attached";
  } catch (error) {
    if (error instanceof CitationTooLargeError) return "too-large";
    return false;
  }
}

export function appendCitationToComposer(
  formattedCitation: string,
  preferredInput: DomTextInput | null = null,
): CitationInsertResult {
  if (Platform.OS !== "web") {
    return "not-web";
  }

  const input =
    (preferredInput && elementIsConnected(preferredInput) ? preferredInput : null) ??
    (document.querySelector(COMPOSER_INPUT_SELECTOR) as DomTextInput | null);
  if (!input) {
    return "composer-not-found";
  }

  const attachmentResult = tryAttachCitationToComposer(input, formattedCitation);
  if (attachmentResult === "attached") {
    input.focus();
    return "attached";
  }
  if (attachmentResult === "duplicate" || attachmentResult === "too-large") {
    return attachmentResult;
  }

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
  if (Platform.OS !== "web") {
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

  document.body.appendChild(root);

  const migrateExistingCitationAttachments = (): void => {
    for (const input of document.querySelectorAll(COMPOSER_INPUT_SELECTOR)) {
      const bridge = findComposerAttachmentBridge(input);
      if (bridge) migrateCitationAttachments(bridge);
    }
  };
  migrateExistingCitationAttachments();

  let activeSelection: SelectionSnapshot | null = null;
  let latestCitation: LatestCitation | null = null;
  let previousFocusedElement: DomElement | null = null;
  let toastTimer: unknown = null;
  let ignoreSelectionChangesTimer: unknown = null;

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

  const clearStaleLatestCitation = (): void => {
    if (!latestCitation) return;
    if (!elementIsConnected(latestCitation.anchorElement)) {
      latestCitation = null;
      return;
    }

    const input = latestCitation.composerInput;
    const bridge = input ? findComposerAttachmentBridge(input) : null;
    if (!bridge?.attachments.some(isCitationComposerAttachment)) {
      latestCitation = null;
    }
  };

  const closePanel = (): void => {
    panel.style.display = "none";
    citeButton.style.display = "none";
    activeSelection = null;

    const elementToRestore = previousFocusedElement;
    previousFocusedElement = null;
    if (elementIsConnected(elementToRestore)) elementToRestore?.focus();
  };

  const showPanel = (): void => {
    if (!activeSelection) return;
    previousFocusedElement = document.activeElement;
    positionPanel(panel, currentSelectionRect(activeSelection));
    citeButton.style.display = "none";
    panel.style.display = "block";
    commentInput.value = "";
    submitButton.setAttribute("disabled", "");
    submitButton.style.opacity = "0.48";
    submitButton.style.cursor = "default";
    commentInput.focus();
  };

  const focusablePanelElements = (): DomElement[] =>
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
    clearStaleLatestCitation();
    const nextSelection = readSelection();
    activeSelection = nextSelection;
    if (!nextSelection) {
      citeButton.style.display = "none";
      return;
    }
    positionElement(citeButton, currentSelectionRect(nextSelection), 30);
    citeButton.style.display = "block";
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
  const handleSubmit: DomListener = (event) => {
    event.preventDefault();
    if (!activeSelection || !commentInput.value.trim()) return;

    const submittedSelection = activeSelection;
    const citation = formatCitation(submittedSelection.text, commentInput.value);
    const result = appendCitationToComposer(citation, submittedSelection.composerInput);
    if (result === "attached" || result === "inserted") {
      const entry = parseCitationEntries(citation).at(-1);
      latestCitation = {
        text: entry?.quote ?? normalizeCitationText(submittedSelection.text),
        range: submittedSelection.range,
        anchorElement: submittedSelection.anchorElement,
        composerInput: submittedSelection.composerInput,
      };
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
      .copyFallback(citation)
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
    const target = event.target ?? null;
    if (isCitationRemoveTarget(target)) {
      if (findComposerInputNearElement(target?.parentElement ?? null)) {
        window.setTimeout(clearStaleLatestCitation, 0);
      }
      return;
    }
    if (!isCitationPillTarget(target)) return;

    const pill = target ? target.closest(CITATION_PILL_SELECTOR) : null;
    const input = findComposerInputNearElement(
      pill?.parentElement ?? pill,
      pill?.getBoundingClientRect() ?? null,
    );
    const bridge = input ? findComposerAttachmentBridge(input) : null;
    const mappedAttachment = bridge && attachmentForPill(pill, bridge);
    const attachment = isCitationComposerAttachment(mappedAttachment)
      ? mappedAttachment
      : isCitationPillTarget(target)
        ? bridge?.attachments.find(isCitationComposerAttachment)
        : null;

    if (!attachment || !input) return;

    event.preventDefault();
    event.stopPropagation();

    if (bridge) migrateCitationAttachments(bridge);

    const normalizedAttachment = normalizeCitationComposerAttachment(attachment);
    const entry = attachmentCitations(normalizedAttachment).at(-1);
    const canRestoreSelection =
      latestCitation?.composerInput === input && latestCitation.text === entry?.quote;
    suppressSelectionChanges();

    if (
      !entry ||
      !highlightCitationText(
        entry.quote,
        canRestoreSelection ? latestCitation?.range ?? null : null,
        canRestoreSelection ? latestCitation?.anchorElement ?? null : null,
      )
    ) {
      showToast("Could not find the cited text in this conversation.", true);
    }
  };
  const handleWindowChange = (): void => {
    if (!activeSelection) return;
    const rect = currentSelectionRect(activeSelection);
    if (panel.style.display === "block") {
      positionPanel(panel, rect);
    } else {
      positionElement(citeButton, rect, 30);
    }
  };

  document.addEventListener("selectionchange", handleSelectionChange);
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
    if (activeOverlayCleanup === cleanup) activeOverlayCleanup = null;
    root.remove();
  };

  activeOverlayCleanup = cleanup;
  return cleanup;
}

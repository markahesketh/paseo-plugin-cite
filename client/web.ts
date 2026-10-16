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

declare global {
  interface Window {
    // Non-standard, so lib.dom omits it.
    find(text: string, caseSensitive?: boolean, backwards?: boolean, wrapAround?: boolean): boolean;
  }
}

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
  return typeof document !== "undefined" && typeof window !== "undefined";
}

interface CitationOverlayOptions {
  copyFallback(text: string): Promise<void>;
}

interface SelectionSnapshot {
  text: string;
  rect: DOMRect;
  range: Range;
  anchorElement: Element | null;
  composerInput: HTMLTextAreaElement | null;
}

interface ComposerAttachmentBridge {
  attachments: unknown[];
  setAttachments(update: (attachments: unknown[]) => unknown[]): void;
}

interface EditingCitation {
  entry: CitationEntry;
  bridgeInput: HTMLTextAreaElement;
  pill: Element;
  range: Range | null;
}

interface CitedSelection {
  text: string;
  range: Range;
  anchorElement: Element | null;
  composerInput: HTMLTextAreaElement | null;
}

let activeOverlayCleanup: (() => void) | null = null;

function setStyles(element: HTMLElement, styles: Record<string, string>): void {
  Object.assign(element.style, styles);
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof window.Element ? node : node.parentElement;
}

function targetElement(event: Event): Element | null {
  return event.target instanceof window.Element ? event.target : null;
}

function elementIsConnected(element: Element | null): boolean {
  return Boolean(element && element.isConnected !== false);
}

// Hidden panes can stay mounted. Their composers have an empty rect.
function elementIsVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.right > rect.left && rect.bottom > rect.top;
}

function nearestComposerInput(
  candidates: NodeListOf<HTMLTextAreaElement>,
  referenceRect: DOMRect | null,
): HTMLTextAreaElement | null {
  const visibleCandidates = Array.from(candidates).filter(elementIsVisible);
  return visibleCandidates.reduce<HTMLTextAreaElement | null>((closest, candidate) => {
    if (!closest || !referenceRect) return closest ?? candidate;
    return rectDistance(referenceRect, candidate.getBoundingClientRect()) <
      rectDistance(referenceRect, closest.getBoundingClientRect())
      ? candidate
      : closest;
  }, null);
}

function findComposerInputNearElement(
  element: Element | null,
  referenceRect: DOMRect | null = null,
): HTMLTextAreaElement | null {
  let current = element;
  while (current) {
    const inputs = current.querySelectorAll<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR);
    const input = nearestComposerInput(inputs, referenceRect);
    if (input) return input;
    current = current.parentElement;
  }
  return null;
}

function rectDistance(left: DOMRect, right: DOMRect): number {
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
  anchorElement: Element | null,
  selectionRect: DOMRect,
): HTMLTextAreaElement | null {
  const nearbyInput = findComposerInputNearElement(anchorElement, selectionRect);
  if (nearbyInput) return nearbyInput;

  const candidates = document.querySelectorAll<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR);
  return nearestComposerInput(candidates, selectionRect);
}

function currentSelectionRect(selection: SelectionSnapshot): DOMRect {
  if (elementIsConnected(selection.anchorElement)) {
    const rect = selection.range.getBoundingClientRect();
    if (rect.top !== 0 || rect.left !== 0 || rect.right !== 0 || rect.bottom !== 0) {
      return rect;
    }
  }
  return selection.rect;
}

function selectionInsideExcludedElement(selection: Selection): boolean {
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

function positionElement(element: HTMLElement, rect: DOMRect, height: number): void {
  const width = 78;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
  const top = rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8;
  element.style.left = `${left}px`;
  element.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`;
}

function rectIsEmpty(rect: DOMRect): boolean {
  return rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0;
}

function positionPanel(element: HTMLElement, rect: DOMRect): void {
  const width = 560;
  const measured = element.getBoundingClientRect();
  const height = measured.bottom - measured.top || 214;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
  const top = rect.bottom + 8 + height <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8;
  element.style.left = `${left}px`;
  element.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`;
}

function dispatchInputEvent(input: HTMLTextAreaElement): void {
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function replaceNativeInputValue(input: HTMLTextAreaElement, value: string): void {
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

function findComposerAttachmentBridge(input: Element): ComposerAttachmentBridge | null {
  for (const fiber of findCommittedFiberPath(input) ?? []) {
    const props = fiber.memoizedProps;
    if (
      props &&
      Array.isArray(props.attachments) &&
      typeof props.onChangeAttachments === "function"
    ) {
      const updateAttachments = props.onChangeAttachments as (
        update: (attachments: unknown[]) => unknown[],
      ) => void;
      return {
        attachments: props.attachments,
        setAttachments: updateAttachments,
      };
    }
  }
  return null;
}

function migrateBridgeCitationAttachments(bridge: ComposerAttachmentBridge): void {
  const nextAttachments = normalizeCitationAttachments(bridge.attachments);
  if (nextAttachments) bridge.setAttachments(() => nextAttachments);
}

// Paseo renders each plugin pill with its own attachment as the "attachment" prop.
function citationAttachmentForPill(pill: Element): CitationComposerAttachment | null {
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
  range: Range | null,
  anchorElement: Element | null,
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
  input: HTMLTextAreaElement,
  entry: CitationEntry,
): "attached" | "duplicate" | false {
  const attachmentBridge = findComposerAttachmentBridge(input);
  if (!attachmentBridge) return false;

  const nextAttachments = addCitationToAttachments(attachmentBridge.attachments, entry);
  if (nextAttachments === "duplicate") return nextAttachments;
  try {
    attachmentBridge.setAttachments(() => nextAttachments);
    return "attached";
  } catch {
    return false;
  }
}

export function appendCitationToComposer(
  entry: CitationEntry,
  preferredInput: HTMLTextAreaElement | null = null,
): CitationInsertResult {
  if (!isBrowserRuntime()) {
    return "not-web";
  }

  const input =
    (preferredInput && elementIsConnected(preferredInput) && elementIsVisible(preferredInput)
      ? preferredInput
      : null) ??
    nearestComposerInput(document.querySelectorAll<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR), null);
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

function setStylesForOverlayRoot(root: HTMLElement): void {
  setStyles(root, {
    fontFamily: FONT_STACK,
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
}

function styleButton(button: HTMLElement): void {
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

function stylePanel(panel: HTMLElement): void {
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

function styleTextArea(textarea: HTMLElement): void {
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

function styleActionButton(button: HTMLElement, primary: boolean): void {
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

  const citeButton = createTextElement("button", "Cite");
  root.append(citeButton);
  citeButton.id = CITE_BUTTON_ID;
  citeButton.setAttribute("type", "button");
  citeButton.setAttribute("aria-label", "Cite selected answer text");
  styleButton(citeButton);
  citeButton.style.display = "none";

  const panel = document.createElement("form");
  root.append(panel);
  panel.id = CITE_PANEL_ID;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Add a citation comment");
  panel.setAttribute("tabindex", "-1");
  stylePanel(panel);
  panel.style.display = "none";

  // Shows the full quote when you edit a citation, because the pill shows only part of it.
  const quoteText = document.createElement("div");
  panel.append(quoteText);
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

  const commentInput = document.createElement("textarea");
  panel.append(commentInput);
  commentInput.setAttribute("aria-label", "Citation comment");
  commentInput.setAttribute("placeholder", "Leave a comment");
  styleTextArea(commentInput);

  const actions = document.createElement("div");
  panel.append(actions);
  setStyles(actions, { display: "flex", justifyContent: "flex-end", gap: "20px" });

  const cancelButton = createTextElement("button", "Cancel");
  actions.append(cancelButton);
  cancelButton.setAttribute("type", "button");
  styleActionButton(cancelButton, false);

  const submitButton = createTextElement("button", "Comment");
  actions.append(submitButton);
  submitButton.setAttribute("type", "submit");
  submitButton.setAttribute("disabled", "");
  styleActionButton(submitButton, true);
  submitButton.style.opacity = "0.48";
  submitButton.style.cursor = "default";

  const toast = createTextElement("div", "");
  root.append(toast);
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
  const highlightLayer = document.createElement("div");
  root.append(highlightLayer);

  document.body.appendChild(root);

  const migrateExistingCitationAttachments = (): void => {
    for (const input of document.querySelectorAll<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR)) {
      const bridge = findComposerAttachmentBridge(input);
      if (bridge) migrateBridgeCitationAttachments(bridge);
    }
  };
  migrateExistingCitationAttachments();

  let activeSelection: SelectionSnapshot | null = null;
  let editingCitation: EditingCitation | null = null;
  let citedSelections: CitedSelection[] = [];
  let previousFocusedElement: HTMLElement | null = null;
  let toastTimer: number | null = null;
  let ignoreSelectionChangesTimer: number | null = null;
  let selectionCommitTimer: number | null = null;

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
      const box = document.createElement("div");
      highlightLayer.append(box);
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

  const panelAnchorRect = (): DOMRect | null => {
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
    previousFocusedElement =
      document.activeElement instanceof window.HTMLElement ? document.activeElement : null;
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

  const focusablePanelElements = (): NodeListOf<HTMLElement> =>
    panel.querySelectorAll<HTMLElement>("button, textarea, [tabindex]");

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
  const scheduleSelectionChange = (event: Event): void => {
    const target = targetElement(event);
    if (target && root.contains(target)) return;

    if (selectionCommitTimer !== null) window.clearTimeout(selectionCommitTimer);
    selectionCommitTimer = window.setTimeout(() => {
      selectionCommitTimer = null;
      handleSelectionChange();
    }, 0);
  };

  const handleCiteButtonMouseDown = (event: Event): void => {
    event.preventDefault();
  };
  const handleCiteButtonClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    showPanel();
  };
  const handleCancel = (event: Event): void => {
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
    bridge.setAttachments(() => result);
  };

  const handleSubmit = (event: Event): void => {
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
  const handleCommentInput = (): void => {
    updateSubmitButton();
  };
  const handlePanelEscape = (event: KeyboardEvent): void => {
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
  const handleCommentInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;

    event.stopPropagation();
    if (event.shiftKey || event.altKey) return;

    event.preventDefault();
    handleSubmit(event);
  };
  const handleCommentInputFocus = (): void => {
    commentInput.style.borderColor = ACCENT;
    commentInput.style.boxShadow = "0 0 0 3px var(--colors-accent-muted, rgb(32 116 74 / 25%))";
  };
  const handleCommentInputBlur = (): void => {
    commentInput.style.borderColor = ACCENT;
    commentInput.style.boxShadow = "none";
  };
  const handleOutsidePointerDown = (event: Event): void => {
    const target = targetElement(event);
    if (
      panel.style.display === "block" &&
      !panel.contains(target) &&
      !citeButton.contains(target)
    ) {
      closePanel();
    }
  };
  const handleCitationAttachmentClick = (event: MouseEvent): void => {
    const pill = targetElement(event)?.closest(CITATION_PILL_SELECTOR) ?? null;
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

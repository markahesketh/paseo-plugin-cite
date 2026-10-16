import type { CitationEntry } from "../citation-format";
import type { CitationFailure } from "./composer-bridge";
import type { SelectionSnapshot } from "./text-range";

import { createCitationEntry, formatCitationEntry } from "../citation-format";
import { addCitation, citationForPill, findComposerInput, replaceCitation } from "./composer-bridge";
import {
  elementForNode,
  findQuoteNearComposer,
  liveRect,
  rangeShowsQuote,
  readSelection,
} from "./text-range";

const OVERLAY_ID = "paseo-cite-overlay";
const CITE_BUTTON_ID = "paseo-cite-button";
const CITE_PANEL_ID = "paseo-cite-panel";
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

function isBrowserRuntime(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

interface CitationOverlayOptions {
  copyFallback(text: string): Promise<void>;
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
  composerInput: HTMLTextAreaElement | null;
}

type Notice = CitationFailure | "too-large" | "copied" | "copy-failed" | "quote-not-found";

const MESSAGES: Record<Notice, { text: string; isError: boolean }> = {
  duplicate: { text: "This citation is already in the composer.", isError: false },
  missing: { text: "This citation is no longer in the composer.", isError: true },
  unavailable: { text: "Could not update the composer.", isError: true },
  "too-large": { text: "This citation is too large.", isError: true },
  copied: { text: "Could not add to the composer. Citation copied for paste.", isError: false },
  "copy-failed": { text: "Could not add or copy the citation.", isError: true },
  "quote-not-found": { text: "Could not find the cited text in this conversation.", isError: true },
};

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

function targetElement(event: Event): Element | null {
  return event.target instanceof window.Element ? event.target : null;
}

function elementIsConnected(element: Element | null): boolean {
  return Boolean(element && element.isConnected !== false);
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

function positionPanel(element: HTMLElement, rect: DOMRect): void {
  const width = 560;
  const measured = element.getBoundingClientRect();
  const height = measured.bottom - measured.top || 214;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
  const top = rect.bottom + 8 + height <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8;
  element.style.left = `${left}px`;
  element.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - height - 8))}px`;
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

  let activeSelection: SelectionSnapshot | null = null;
  let selectionComposerInput: HTMLTextAreaElement | null = null;
  let editingCitation: EditingCitation | null = null;
  let citedSelections: CitedSelection[] = [];
  let previousFocusedElement: HTMLElement | null = null;
  let toastTimer: number | null = null;
  let selectionCommitTimer: number | null = null;

  const showToast = (notice: Notice): void => {
    const message = MESSAGES[notice];
    toast.textContent = message.text;
    toast.style.color = message.isError ? DESTRUCTIVE : FOREGROUND;
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
    if (activeSelection) return liveRect(activeSelection.range, activeSelection.rect);
    if (!editingCitation) return null;
    return liveRect(editingCitation.range, editingCitation.pill.getBoundingClientRect());
  };

  const closePanel = (): void => {
    panel.style.display = "none";
    citeButton.style.display = "none";
    activeSelection = null;
    selectionComposerInput = null;
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
    if (!activeSelection) return;
    const anchor = elementForNode(activeSelection.range.commonAncestorContainer);
    selectionComposerInput = anchor ? findComposerInput(anchor, activeSelection.rect) : null;
    openPanel("", null);
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
    if (panel.style.display === "block") return;
    const nextSelection = readSelection();
    activeSelection = nextSelection;
    if (!nextSelection) {
      citeButton.style.display = "none";
      return;
    }
    positionElement(citeButton, nextSelection.rect, 30);
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
      showToast("too-large");
      return;
    }
    if (entry.comment === editing.entry.comment) {
      closePanel();
      return;
    }

    const result = replaceCitation(editing.bridgeInput, editing.entry, entry);
    if (!result.ok && result.reason === "duplicate") {
      showToast(result.reason);
      return;
    }
    closePanel();
    if (!result.ok) showToast(result.reason);
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
    const composerInput = selectionComposerInput;
    const entry = createCitationEntry(submittedSelection.text, commentInput.value);
    if (!entry) {
      showToast("too-large");
      return;
    }
    const result = addCitation(composerInput, entry);
    if (result.ok) {
      citedSelections = citedSelections.filter(
        (cited) =>
          rangeShowsQuote(cited.range, cited.text) &&
          !(cited.text === entry.quote && cited.composerInput === composerInput),
      );
      citedSelections.push({ text: entry.quote, range: submittedSelection.range, composerInput });
      closePanel();
      return;
    }

    if (result.reason !== "unavailable") {
      closePanel();
      showToast(result.reason);
      return;
    }

    void options
      .copyFallback(formatCitationEntry(entry))
      .then(() => {
        closePanel();
        showToast("copied");
      })
      .catch(() => showToast("copy-failed"));
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
    const target = targetElement(event);
    const citation = target ? citationForPill(target) : null;
    if (!citation) return;
    const { pill, entry, input } = citation;

    event.preventDefault();
    event.stopPropagation();

    closePanel();
    const cached = citedSelections.find(
      (selection) => selection.composerInput === input && selection.text === entry.quote,
    )?.range;
    const range =
      cached && rangeShowsQuote(cached, entry.quote)
        ? cached
        : findQuoteNearComposer(input, entry.quote);
    if (range) {
      elementForNode(range.startContainer)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      showToast("quote-not-found");
    }
    if (!input) return;

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

  const listeners = new window.AbortController();
  const { signal } = listeners;
  document.addEventListener("selectionchange", handleSelectionChange, { signal });
  document.addEventListener("pointerup", scheduleSelectionChange, { signal, capture: true });
  document.addEventListener("keyup", scheduleSelectionChange, { signal, capture: true });
  window.addEventListener("resize", handleWindowChange, { signal });
  window.addEventListener("scroll", handleWindowChange, { signal, capture: true });
  citeButton.addEventListener("mousedown", handleCiteButtonMouseDown, { signal });
  citeButton.addEventListener("click", handleCiteButtonClick, { signal });
  cancelButton.addEventListener("click", handleCancel, { signal });
  panel.addEventListener("submit", handleSubmit, { signal });
  panel.addEventListener("keydown", handlePanelEscape, { signal });
  commentInput.addEventListener("input", handleCommentInput, { signal });
  commentInput.addEventListener("keydown", handleCommentInputKeyDown, { signal });
  commentInput.addEventListener("focus", handleCommentInputFocus, { signal });
  commentInput.addEventListener("blur", handleCommentInputBlur, { signal });
  document.addEventListener("mousedown", handleOutsidePointerDown, { signal, capture: true });
  document.addEventListener("click", handleCitationAttachmentClick, { signal, capture: true });

  const cleanup = (): void => {
    listeners.abort();
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    if (selectionCommitTimer !== null) window.clearTimeout(selectionCommitTimer);
    if (activeOverlayCleanup === cleanup) activeOverlayCleanup = null;
    root.remove();
  };

  activeOverlayCleanup = cleanup;
  return cleanup;
}

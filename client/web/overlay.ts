import type { CitationEntry } from "../citation-format";
import type { CitationPill } from "./composer-bridge";
import type { SelectionSnapshot } from "./text-range";

import { createCitationEntry, formatCitationEntry } from "../citation-format";
import { addCitation, citationForPill, findComposerInput, replaceCitation } from "./composer-bridge";
import { createOverlayView } from "./overlay-view";
import {
  OVERLAY_ID,
  elementForNode,
  findQuoteNearComposer,
  rangeShowsQuote,
  readSelection,
} from "./text-range";

export type OverlayState =
  | { kind: "idle" }
  | { kind: "offer"; selection: SelectionSnapshot }
  | {
      kind: "compose";
      selection: SelectionSnapshot;
      input: HTMLTextAreaElement | null;
      returnFocus: HTMLElement | null;
    }
  | {
      kind: "edit";
      pill: Element;
      entry: CitationEntry;
      input: HTMLTextAreaElement;
      range: Range | null;
      returnFocus: HTMLElement | null;
    };

type Compose = Extract<OverlayState, { kind: "compose" }>;
type Edit = Extract<OverlayState, { kind: "edit" }>;

interface CitationOverlayOptions {
  copyFallback(text: string): Promise<void>;
}

// Where each cited quote was selected, so that editing it highlights the same text.
interface CitedRange {
  quote: string;
  range: Range;
  input: HTMLTextAreaElement | null;
}

let activeOverlayCleanup: (() => void) | null = null;

function isBrowserRuntime(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

function targetElement(event: Event): Element | null {
  return event.target instanceof window.Element ? event.target : null;
}

function createOverlay(options: CitationOverlayOptions): () => void {
  const view = createOverlayView();
  const { root, citeButton, panel, commentInput, cancelButton } = view;
  document.body.appendChild(root);

  let state: OverlayState = { kind: "idle" };
  let citedRanges: CitedRange[] = [];
  let selectionTimer: number | null = null;

  const setState = (next: OverlayState): void => {
    state = next;
    view.render(next);
  };
  const panelOpen = (): boolean => state.kind === "compose" || state.kind === "edit";

  const returnFocus = (): HTMLElement | null =>
    state.kind === "compose" || state.kind === "edit" ? state.returnFocus : null;
  const focusToReturn = (): HTMLElement | null => {
    const active = document.activeElement;
    return (
      returnFocus() ??
      (active instanceof window.HTMLElement && !root.contains(active) ? active : null)
    );
  };
  const dismiss = (): void => {
    const focus = returnFocus();
    setState({ kind: "idle" });
    if (focus?.isConnected) focus.focus();
  };

  const handleSelectionChange = (): void => {
    if (panelOpen()) return;
    const selection = readSelection();
    setState(selection ? { kind: "offer", selection } : { kind: "idle" });
  };
  // selectionchange does not always fire after a pointer or key selection ends.
  const scheduleSelectionChange = (event: Event): void => {
    const target = targetElement(event);
    if (target && root.contains(target)) return;
    if (selectionTimer !== null) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      selectionTimer = null;
      handleSelectionChange();
    }, 0);
  };

  const openCompose = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (state.kind !== "offer") return;
    const { selection } = state;
    const anchor = elementForNode(selection.range.commonAncestorContainer);
    const input = anchor ? findComposerInput(anchor, selection.rect) : null;
    setState({ kind: "compose", selection, input, returnFocus: focusToReturn() });
  };

  const openEdit = ({ pill, entry, input }: CitationPill, event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const cached = citedRanges.find(
      (cited) => cited.input === input && cited.quote === entry.quote,
    )?.range;
    const range =
      cached && rangeShowsQuote(cached, entry.quote)
        ? cached
        : findQuoteNearComposer(input, entry.quote);
    if (range) {
      elementForNode(range.startContainer)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      view.toast("quote-not-found");
    }
    if (!input) {
      dismiss();
      return;
    }
    setState({ kind: "edit", pill, entry, input, range, returnFocus: focusToReturn() });
  };

  const rememberCited = (compose: Compose, quote: string): void => {
    citedRanges = citedRanges.filter(
      (cited) =>
        rangeShowsQuote(cited.range, cited.quote) &&
        !(cited.quote === quote && cited.input === compose.input),
    );
    citedRanges.push({ quote, range: compose.selection.range, input: compose.input });
  };

  const addFromSelection = (compose: Compose, comment: string): void => {
    const entry = createCitationEntry(compose.selection.text, comment);
    if (!entry) {
      view.toast("too-large");
      return;
    }
    const result = addCitation(compose.input, entry);
    if (result.ok) {
      rememberCited(compose, entry.quote);
      dismiss();
      return;
    }
    if (result.reason !== "unavailable") {
      dismiss();
      view.toast(result.reason);
      return;
    }
    void options.copyFallback(formatCitationEntry(entry)).then(
      () => {
        dismiss();
        view.toast("copied");
      },
      () => view.toast("copy-failed"),
    );
  };

  const saveEdit = (edit: Edit, comment: string): void => {
    const entry = createCitationEntry(edit.entry.quote, comment);
    if (!entry) {
      view.toast("too-large");
      return;
    }
    if (entry.comment === edit.entry.comment) {
      dismiss();
      return;
    }
    const result = replaceCitation(edit.input, edit.entry, entry);
    if (!result.ok && result.reason === "duplicate") {
      view.toast(result.reason);
      return;
    }
    dismiss();
    if (!result.ok) view.toast(result.reason);
  };

  const submit = (event: Event): void => {
    event.preventDefault();
    const comment = commentInput.value;
    if (!comment.trim()) return;
    if (state.kind === "compose") addFromSelection(state, comment);
    else if (state.kind === "edit") saveEdit(state, comment);
  };

  const handlePanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      const focusable = panel.querySelectorAll<HTMLElement>("button, textarea, [tabindex]");
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
    dismiss();
  };
  const handleCommentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    if (event.isComposing || event.keyCode === 229) return;
    event.stopPropagation();
    if (event.shiftKey || event.altKey) return;
    submit(event);
  };
  const handleOutsidePointerDown = (event: Event): void => {
    if (panelOpen() && !root.contains(targetElement(event))) dismiss();
  };
  const handlePillClick = (event: MouseEvent): void => {
    const target = targetElement(event);
    const citation = target ? citationForPill(target) : null;
    if (citation) openEdit(citation, event);
  };
  const handleCancel = (event: Event): void => {
    event.preventDefault();
    dismiss();
  };
  const keepSelection = (event: Event): void => event.preventDefault();
  const handleWindowChange = (): void => view.reposition(state);

  const listeners = new window.AbortController();
  const { signal } = listeners;
  document.addEventListener("selectionchange", handleSelectionChange, { signal });
  document.addEventListener("pointerup", scheduleSelectionChange, { signal, capture: true });
  document.addEventListener("keyup", scheduleSelectionChange, { signal, capture: true });
  window.addEventListener("resize", handleWindowChange, { signal });
  window.addEventListener("scroll", handleWindowChange, { signal, capture: true });
  citeButton.addEventListener("mousedown", keepSelection, { signal });
  citeButton.addEventListener("click", openCompose, { signal });
  cancelButton.addEventListener("click", handleCancel, { signal });
  panel.addEventListener("submit", submit, { signal });
  panel.addEventListener("keydown", handlePanelKeyDown, { signal });
  commentInput.addEventListener("input", view.commentChanged, { signal });
  commentInput.addEventListener("keydown", handleCommentKeyDown, { signal });
  document.addEventListener("mousedown", handleOutsidePointerDown, { signal, capture: true });
  document.addEventListener("click", handlePillClick, { signal, capture: true });

  return () => {
    listeners.abort();
    if (selectionTimer !== null) window.clearTimeout(selectionTimer);
    view.dispose();
  };
}

export function startCitationOverlay(options: CitationOverlayOptions): () => void {
  if (!isBrowserRuntime()) {
    return () => {};
  }

  activeOverlayCleanup?.();
  document.getElementById(OVERLAY_ID)?.remove();

  const dispose = createOverlay(options);
  const cleanup = (): void => {
    dispose();
    if (activeOverlayCleanup === cleanup) activeOverlayCleanup = null;
  };
  activeOverlayCleanup = cleanup;
  return cleanup;
}

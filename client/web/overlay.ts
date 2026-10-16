import type { CitationEntry } from "../citation-format";
import type { CitationPill } from "./composer-bridge";
import type { SelectionSnapshot } from "./text-range";

import { createCitationEntry, formatCitationEntry } from "../citation-format";
import { addCitation, citationForPill, findComposerInput, replaceCitation } from "./composer-bridge";
import { createOverlayView } from "./overlay-view";
import {
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

interface CitedRange {
  quote: string;
  range: Range;
  input: HTMLTextAreaElement | null;
}

// Paseo evaluates the plugin bundle once per host, each with its own module scope, so
// the running overlay is shared through globalThis rather than module state.
const SHARED_OVERLAY = Symbol.for("paseo-cite.overlay");

interface SharedOverlay {
  holders: number;
  dispose(): void;
}

const registry = globalThis as { [SHARED_OVERLAY]?: SharedOverlay };

export type CommentKeyAction = "submit" | "newline" | "none";

// keyCode 229 is a key pressed during IME composition on browsers that leave isComposing unset.
export function commentKeyAction(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "isComposing" | "keyCode">,
): CommentKeyAction {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return "none";
  return event.shiftKey || event.altKey ? "newline" : "submit";
}

function isBrowserRuntime(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

function targetElement(event: Event): Element | null {
  return event.target instanceof window.Element ? event.target : null;
}

function createOverlay(options: CitationOverlayOptions): () => void {
  const view = createOverlayView();
  const { root, citeButton, panel, commentInput, cancelButton, submitButton } = view;
  document.body.appendChild(root);

  let state: OverlayState = { kind: "idle" };
  let citedRanges: CitedRange[] = [];
  let selectionTimer: number | null = null;
  const listeners = new window.AbortController();
  const { signal } = listeners;

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
    const stillOpen = (): boolean => state === compose && !signal.aborted;
    void options.copyFallback(formatCitationEntry(entry)).then(
      () => {
        if (!stillOpen()) return;
        dismiss();
        view.toast("copied");
      },
      () => {
        if (stillOpen()) view.toast("copy-failed");
      },
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

  // Focus stays in the comment box while the panel is open. Paseo's window-level key
  // handling treats a focused textarea as editable, so Escape here does not interrupt
  // the agent, while Escape on a focused button would.
  const handleCommentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    const action = commentKeyAction(event);
    if (action === "none") return;
    event.stopPropagation();
    if (action === "submit") submit(event);
  };
  const handleOutsidePointerDown = (event: Event): void => {
    if (panelOpen() && !root.contains(targetElement(event))) dismiss();
  };
  const openEditFromPill = (event: Event): void => {
    const target = targetElement(event);
    const citation = target ? citationForPill(target) : null;
    if (citation) openEdit(citation, event);
  };
  // Paseo's pills press on Enter and Space from keyup, not click, so the keydown is
  // taken first to open the edit instead of the pill's own action.
  const handlePillKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") openEditFromPill(event);
  };
  const handleCancel = (event: Event): void => {
    event.preventDefault();
    dismiss();
  };
  const keepFocus = (event: Event): void => event.preventDefault();
  const handleWindowChange = (): void => view.reposition(state);

  document.addEventListener("selectionchange", handleSelectionChange, { signal });
  document.addEventListener("pointerup", scheduleSelectionChange, { signal, capture: true });
  document.addEventListener("keyup", scheduleSelectionChange, { signal, capture: true });
  window.addEventListener("resize", handleWindowChange, { signal });
  window.addEventListener("scroll", handleWindowChange, { signal, capture: true });
  citeButton.addEventListener("mousedown", keepFocus, { signal });
  cancelButton.addEventListener("mousedown", keepFocus, { signal });
  submitButton.addEventListener("mousedown", keepFocus, { signal });
  citeButton.addEventListener("click", openCompose, { signal });
  cancelButton.addEventListener("click", handleCancel, { signal });
  panel.addEventListener("submit", submit, { signal });
  commentInput.addEventListener("input", view.commentChanged, { signal });
  commentInput.addEventListener("keydown", handleCommentKeyDown, { signal });
  document.addEventListener("mousedown", handleOutsidePointerDown, { signal, capture: true });
  document.addEventListener("click", openEditFromPill, { signal, capture: true });
  document.addEventListener("keydown", handlePillKeyDown, { signal, capture: true });

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

  const shared = (registry[SHARED_OVERLAY] ??= { holders: 0, dispose: createOverlay(options) });
  shared.holders += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    shared.holders -= 1;
    if (shared.holders > 0) return;
    shared.dispose();
    if (registry[SHARED_OVERLAY] === shared) delete registry[SHARED_OVERLAY];
  };
}

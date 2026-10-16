import type { CitationFailure } from "./composer-bridge";
import type { OverlayState } from "./overlay";

import { OVERLAY_ID, liveRect, rangeShowsQuote } from "./text-range";

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
const ACCENT_MUTED = "var(--colors-accent-muted, rgb(32 116 74 / 25%))";
const ACCENT_FOREGROUND = "var(--colors-accent-foreground, #ffffff)";
const DESTRUCTIVE = "var(--colors-destructive, #dc2626)";

const STYLESHEET = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: ${FONT_STACK};
}
#${OVERLAY_ID} [hidden] {
  display: none;
}
#${OVERLAY_ID} .cite {
  position: fixed;
  pointer-events: auto;
  padding: 7px 11px;
  border: 1px solid ${BORDER};
  border-radius: 10px;
  background: ${ACCENT};
  color: ${ACCENT_FOREGROUND};
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 12px rgb(0 0 0 / 16%), 0 1px 3px rgb(0 0 0 / 10%);
  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
}
#${OVERLAY_ID} .panel {
  position: fixed;
  width: 560px;
  max-width: calc(100vw - 24px);
  margin: 0;
  padding: 12px 14px 14px;
  pointer-events: auto;
  border: 1px solid ${BORDER};
  border-radius: 12px;
  background: ${RAISED_SURFACE};
  color: ${FOREGROUND};
  box-shadow: 0 12px 30px rgb(0 0 0 / 18%), 0 3px 8px rgb(0 0 0 / 10%);
  box-sizing: border-box;
  font-size: 14px;
  line-height: 1.4;
  color-scheme: light dark;
  backdrop-filter: blur(16px);
}
#${OVERLAY_ID} .quote {
  margin: 0 0 10px;
  padding: 2px 0 2px 10px;
  max-height: 72px;
  overflow: auto;
  border-left: 3px solid ${BORDER};
  color: ${MUTED_FOREGROUND};
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
}
#${OVERLAY_ID} .comment {
  display: block;
  width: 100%;
  min-height: 130px;
  margin: 0 0 16px;
  padding: 12px 14px;
  box-sizing: border-box;
  resize: vertical;
  border: 2px solid ${ACCENT};
  border-radius: 10px;
  background: ${SURFACE};
  color: ${FOREGROUND};
  font-family: inherit;
  font-size: 14px;
  line-height: 1.45;
  outline: none;
}
#${OVERLAY_ID} .comment:focus-visible {
  box-shadow: 0 0 0 3px ${ACCENT_MUTED};
}
#${OVERLAY_ID} .actions {
  display: flex;
  justify-content: flex-end;
  gap: 20px;
}
#${OVERLAY_ID} .action {
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: ${MUTED_FOREGROUND};
  font-family: inherit;
  font-size: 15px;
  line-height: 18px;
  font-weight: 400;
  cursor: pointer;
  transition: background 120ms ease, opacity 120ms ease;
}
#${OVERLAY_ID} .action.primary {
  padding: 8px 16px;
  border-radius: 10px;
  background: ${ACCENT};
  color: ${ACCENT_FOREGROUND};
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}
#${OVERLAY_ID} .action:disabled {
  opacity: 0.48;
  cursor: default;
}
#${OVERLAY_ID} .toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: min(420px, calc(100vw - 24px));
  padding: 9px 13px;
  border-radius: 10px;
  box-sizing: border-box;
  background: ${RAISED_SURFACE};
  color: ${FOREGROUND};
  border: 1px solid ${BORDER};
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  font-size: 13px;
  line-height: 18px;
}
#${OVERLAY_ID} .toast.error {
  color: ${DESTRUCTIVE};
}
#${OVERLAY_ID} .highlight {
  position: fixed;
  background: ${ACCENT_MUTED};
  border-radius: 2px;
}
`;

export type Notice = CitationFailure | "too-large" | "copied" | "copy-failed" | "quote-not-found";

const MESSAGES: Record<Notice, { text: string; isError: boolean }> = {
  duplicate: { text: "This citation is already in the composer.", isError: false },
  missing: { text: "This citation is no longer in the composer.", isError: true },
  unavailable: { text: "Could not update the composer.", isError: true },
  "too-large": { text: "This citation is too large.", isError: true },
  copied: { text: "Could not add to the composer. Citation copied for paste.", isError: false },
  "copy-failed": { text: "Could not add or copy the citation.", isError: true },
  "quote-not-found": { text: "Could not find the cited text in this conversation.", isError: true },
};

export interface OverlayView {
  root: HTMLElement;
  citeButton: HTMLButtonElement;
  panel: HTMLFormElement;
  commentInput: HTMLTextAreaElement;
  cancelButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
  // Entering compose or edit resets the comment box and focuses it, so a layout
  // change calls reposition instead.
  render(state: OverlayState): void;
  reposition(state: OverlayState): void;
  commentChanged(): void;
  toast(notice: Notice): void;
  dispose(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tagName);
  created.className = className;
  created.textContent = text;
  return created;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The element must be visible so that it can measure itself.
function placeNear(element: HTMLElement, anchor: DOMRect, prefer: "above" | "below"): void {
  const margin = 8;
  const { width, height } = element.getBoundingClientRect();
  const top = { above: anchor.top - height - margin, below: anchor.bottom + margin };
  const fits = { above: top.above >= margin, below: top.below + height <= window.innerHeight };
  const side = fits[prefer] ? prefer : prefer === "above" ? "below" : "above";
  element.style.left = `${clamp(anchor.left, margin, Math.max(margin, window.innerWidth - width - margin))}px`;
  element.style.top = `${clamp(top[side], margin, Math.max(margin, window.innerHeight - height - margin))}px`;
}

function anchorRect(state: Exclude<OverlayState, { kind: "idle" }>): DOMRect {
  return state.kind === "edit"
    ? liveRect(state.range, state.pill.getBoundingClientRect())
    : liveRect(state.selection.range, state.selection.rect);
}

export function createOverlayView(): OverlayView {
  const root = element("div", "");
  root.id = OVERLAY_ID;
  root.append(element("style", "", STYLESHEET));

  const citeButton = element("button", "cite", "Cite");
  root.append(citeButton);
  citeButton.id = CITE_BUTTON_ID;
  citeButton.type = "button";
  citeButton.setAttribute("aria-label", "Cite selected answer text");

  const panel = element("form", "panel");
  root.append(panel);
  panel.id = CITE_PANEL_ID;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.tabIndex = -1;

  // Shows the full quote when you edit a citation, because the pill shows only part of it.
  const quote = element("div", "quote");
  panel.append(quote);

  const commentInput = element("textarea", "comment");
  panel.append(commentInput);
  commentInput.setAttribute("aria-label", "Citation comment");
  commentInput.placeholder = "Leave a comment";

  const actions = element("div", "actions");
  panel.append(actions);
  const cancelButton = element("button", "action", "Cancel");
  actions.append(cancelButton);
  cancelButton.type = "button";
  const submitButton = element("button", "action primary", "Comment");
  actions.append(submitButton);
  submitButton.type = "submit";

  const toast = element("div", "toast");
  root.append(toast);
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  // The page selection moves into the comment box when it gets focus, so the
  // highlight for an edited citation is drawn separately.
  const highlight = element("div", "");
  root.append(highlight);

  let toastTimer: number | null = null;

  const drawHighlight = (range: Range): void => {
    for (const rect of Array.from(range.getClientRects())) {
      const box = element("div", "highlight");
      highlight.append(box);
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.right - rect.left}px`;
      box.style.height = `${rect.bottom - rect.top}px`;
    }
  };

  const reposition = (state: OverlayState): void => {
    highlight.textContent = "";
    if (state.kind === "idle") return;
    if (state.kind === "offer") {
      placeNear(citeButton, anchorRect(state), "above");
      return;
    }
    placeNear(panel, anchorRect(state), "below");
    if (state.kind === "edit" && state.range && rangeShowsQuote(state.range, state.entry.quote)) {
      drawHighlight(state.range);
    }
  };

  const commentChanged = (): void => {
    submitButton.disabled = !commentInput.value.trim();
  };

  const render = (state: OverlayState): void => {
    citeButton.hidden = state.kind !== "offer";
    panel.hidden = state.kind !== "compose" && state.kind !== "edit";
    if (!panel.hidden) {
      const entry = state.kind === "edit" ? state.entry : null;
      panel.setAttribute("aria-label", entry ? "Edit the citation comment" : "Add a citation comment");
      quote.hidden = !entry;
      quote.textContent = entry?.quote ?? "";
      submitButton.textContent = entry ? "Save" : "Comment";
      commentInput.value = entry?.comment ?? "";
      commentChanged();
    }
    reposition(state);
    if (!panel.hidden) {
      commentInput.focus();
      commentInput.setSelectionRange(commentInput.value.length, commentInput.value.length);
    }
  };

  const showToast = (notice: Notice): void => {
    const message = MESSAGES[notice];
    toast.textContent = message.text;
    toast.classList.toggle("error", message.isError);
    toast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toastTimer = null;
    }, 2600);
  };

  const dispose = (): void => {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    root.remove();
  };

  render({ kind: "idle" });
  return {
    root,
    citeButton,
    panel,
    commentInput,
    cancelButton,
    submitButton,
    render,
    reposition,
    commentChanged,
    toast: showToast,
    dispose,
  };
}

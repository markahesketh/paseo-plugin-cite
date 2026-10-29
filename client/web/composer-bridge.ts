import type { CitationEntry } from "../citation-format";

import {
  addCitationToAttachments,
  citationEntryForAttachment,
  isCitationComposerAttachment,
  MAX_COMMENT_PREVIEW_LENGTH,
  previewText,
  replaceCitationInAttachments,
} from "../citation-attachment";
import { formatCitationEntry } from "../citation-format";
import { findFiberProps } from "../react-fiber";

export const COMPOSER_ROOT_SELECTOR = '[data-testid="message-input-root"]';
export const CITATION_PILL_SELECTOR = '[data-testid="composer-plugin-resource-attachment-pill"]';
export const MESSAGE_SELECTOR = '[data-testid="assistant-message"], [data-testid="user-message"]';
const COMPOSER_INPUT_SELECTOR = `${COMPOSER_ROOT_SELECTOR} textarea, textarea[aria-label^="Message "]`;

export type CitationFailure = "duplicate" | "missing" | "unavailable";
export type CitationResult = { ok: true } | { ok: false; reason: CitationFailure };

export interface CitationPill {
  pill: Element;
  entry: CitationEntry;
  input: HTMLTextAreaElement | null;
}

type AttachmentsUpdate = (attachments: unknown[]) => unknown[];

interface ComposerAttachmentProps extends Record<string, unknown> {
  attachments: unknown[];
  onChangeAttachments(update: AttachmentsUpdate): void;
}

interface PillProps extends Record<string, unknown> {
  attachment: object;
}

function isComposerAttachmentProps(props: Record<string, unknown>): props is ComposerAttachmentProps {
  return Array.isArray(props.attachments) && typeof props.onChangeAttachments === "function";
}

// Paseo renders each plugin pill with its own attachment as the "attachment" prop.
function isPillProps(props: Record<string, unknown>): props is PillProps {
  return Boolean(props.attachment) && typeof props.attachment === "object";
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.right > rect.left && rect.bottom > rect.top;
}

function rectDistance(left: DOMRect, right: DOMRect): number {
  const horizontal = Math.max(0, right.left - left.right, left.left - right.right);
  const vertical = Math.max(0, right.top - left.bottom, left.top - right.bottom);
  return horizontal ** 2 + vertical ** 2;
}

export function findComposerInput(
  near: Element,
  referenceRect: DOMRect,
): HTMLTextAreaElement | null {
  for (let scope: Element | null = near; scope; scope = scope.parentElement) {
    const visible = Array.from(
      scope.querySelectorAll<HTMLTextAreaElement>(COMPOSER_INPUT_SELECTOR),
    ).filter(isVisible);
    if (visible.length === 0) continue;
    return visible.reduce((closest, candidate) =>
      rectDistance(referenceRect, candidate.getBoundingClientRect()) <
      rectDistance(referenceRect, closest.getBoundingClientRect())
        ? candidate
        : closest,
    );
  }
  return null;
}

function updateAttachments(
  input: HTMLTextAreaElement | null,
  update: (attachments: unknown[]) => unknown[] | CitationFailure,
): CitationResult {
  const props = input ? findFiberProps(input, isComposerAttachmentProps) : null;
  if (!props) return { ok: false, reason: "unavailable" };

  // React may run the updater after this returns, so the result is judged on the
  // rendered attachments and the change is applied to the current ones.
  const preview = update(props.attachments);
  if (typeof preview === "string") return { ok: false, reason: preview };
  try {
    props.onChangeAttachments((current) => {
      const next = update(current);
      return typeof next === "string" ? current : next;
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

// Composers that keep attachments private, like the Bots plugin's, still accept dropped files.
function dropCitationFile(input: HTMLTextAreaElement, entry: CitationEntry): CitationResult {
  const preview = previewText(entry.comment, MAX_COMMENT_PREVIEW_LENGTH);
  const file = new window.File(
    [formatCitationEntry(entry)],
    preview ? `Citation – ${preview}.md` : "Citation.md",
    { type: "text/markdown" },
  );
  const dataTransfer = new window.DataTransfer();
  dataTransfer.items.add(file);
  const drop = new window.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer });
  return input.dispatchEvent(drop) ? { ok: false, reason: "unavailable" } : { ok: true };
}

export function addCitation(input: HTMLTextAreaElement | null, entry: CitationEntry): CitationResult {
  let result = updateAttachments(input, (attachments) =>
    addCitationToAttachments(attachments, entry),
  );
  if (input && !result.ok && result.reason === "unavailable") result = dropCitationFile(input, entry);
  if (result.ok) input?.focus();
  return result;
}

export function replaceCitation(
  input: HTMLTextAreaElement | null,
  previous: CitationEntry,
  next: CitationEntry,
): CitationResult {
  return updateAttachments(input, (attachments) =>
    replaceCitationInAttachments(attachments, previous, next),
  );
}

export function citationForPill(target: Element): CitationPill | null {
  const pill = target.closest(CITATION_PILL_SELECTOR);
  const attachment = pill ? findFiberProps(pill, isPillProps)?.attachment : null;
  if (!pill || !isCitationComposerAttachment(attachment)) return null;
  const entry = citationEntryForAttachment(attachment);
  if (!entry) return null;
  return { pill, entry, input: findComposerInput(pill, pill.getBoundingClientRect()) };
}

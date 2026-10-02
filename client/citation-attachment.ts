import type { CitationEntry } from "./citation-format";

import {
  normalizeCitationEntry,
  parseCitationEntries,
  serializeCitationEntries,
} from "./citation-format";

const CITATION_PLUGIN_ID = "paseo-cite";
const CITATION_SOURCE_ID = "citations";
const CITATION_SOURCE_TITLE = "Citation";
const CITATION_SOURCE_ICON = "MessageSquareCode";
const CITATION_URL = "paseo-cite://citation";
const MAX_COMMENT_PREVIEW_LENGTH = 48;
const MAX_QUOTE_PREVIEW_LENGTH = 40;

export interface CitationComposerAttachment {
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

export function isCitationComposerAttachment(value: unknown): value is CitationComposerAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<CitationComposerAttachment>;
  return (
    attachment.kind === "plugin_resource" &&
    attachment.pluginId === CITATION_PLUGIN_ID &&
    attachment.sourceId === CITATION_SOURCE_ID &&
    Boolean(attachment.item && typeof attachment.item.text === "string")
  );
}

export function attachmentCitations(attachment: CitationComposerAttachment): CitationEntry[] {
  const structuredCitations = attachment.citations?.map(normalizeCitationEntry) ?? [];
  return structuredCitations.length > 0
    ? structuredCitations
    : parseCitationEntries(attachment.item.text);
}

function sameCitationEntry(left: CitationEntry, right: CitationEntry): boolean {
  return left.quote === right.quote && left.comment === right.comment;
}

export function containsCitationEntry(entries: CitationEntry[], entry: CitationEntry): boolean {
  return entries.some((existing) => sameCitationEntry(existing, entry));
}

export function previewText(text: string, maxLength: number): string {
  const preview = text.replace(/\s+/g, " ").trim();
  return preview.length <= maxLength ? preview : `${preview.slice(0, maxLength - 1).trimEnd()}…`;
}

// A stable ID for each entry, so that the same citation keeps the same pill.
function citationAttachmentId(entry: CitationEntry): string {
  let hash = 2166136261;
  for (const character of `${entry.quote}\u0000${entry.comment}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `conversation-citation-${(hash >>> 0).toString(16)}`;
}

// Paseo shows item.title as the pill title and "sourceTitle item.identifier" below it.
export function citationAttachmentForEntry(entry: CitationEntry): CitationComposerAttachment {
  const quotePreview = `“${previewText(entry.quote, MAX_QUOTE_PREVIEW_LENGTH)}”`;
  return {
    kind: "plugin_resource",
    pluginId: CITATION_PLUGIN_ID,
    sourceId: CITATION_SOURCE_ID,
    sourceTitle: CITATION_SOURCE_TITLE,
    sourceIcon: CITATION_SOURCE_ICON,
    citations: [entry],
    item: {
      id: citationAttachmentId(entry),
      identifier: quotePreview,
      title: previewText(entry.comment, MAX_COMMENT_PREVIEW_LENGTH) || CITATION_SOURCE_TITLE,
      subtitle: quotePreview,
      url: CITATION_URL,
      text: serializeCitationEntries([entry]),
      resourceType: "conversation-citation",
    },
  };
}

function sameAttachmentShape(
  attachment: CitationComposerAttachment,
  expected: CitationComposerAttachment,
): boolean {
  return (
    attachment.sourceTitle === expected.sourceTitle &&
    attachment.sourceIcon === expected.sourceIcon &&
    attachment.item.id === expected.item.id &&
    attachment.item.identifier === expected.item.identifier &&
    attachment.item.title === expected.item.title &&
    attachment.item.subtitle === expected.item.subtitle &&
    attachment.item.url === expected.item.url &&
    attachment.item.text === expected.item.text &&
    attachment.item.resourceType === expected.item.resourceType &&
    attachment.citations?.length === 1 &&
    sameCitationEntry(attachment.citations[0], expected.citations?.[0] as CitationEntry)
  );
}

// Splits combined citation attachments from earlier versions into one attachment per
// entry and removes duplicate entries. Returns null when nothing changes.
export function normalizeCitationAttachments(attachments: unknown[]): unknown[] | null {
  let changed = false;
  const seen: CitationEntry[] = [];
  const nextAttachments = attachments.flatMap((attachment) => {
    if (!isCitationComposerAttachment(attachment)) return [attachment];
    const citations = attachmentCitations(attachment);
    if (citations.length === 0) return [attachment];

    const entries = citations.filter((entry) => {
      if (containsCitationEntry(seen, entry)) return false;
      seen.push(entry);
      return true;
    });
    const normalized = entries.map(citationAttachmentForEntry);
    if (normalized.length === 1 && sameAttachmentShape(attachment, normalized[0])) {
      return [attachment];
    }
    changed = true;
    return normalized;
  });
  return changed ? nextAttachments : null;
}

export function addCitationToAttachments(
  attachments: unknown[],
  entry: CitationEntry,
): unknown[] | "duplicate" {
  const normalized = normalizeCitationAttachments(attachments) ?? attachments;
  const existing = normalized.filter(isCitationComposerAttachment).flatMap(attachmentCitations);
  if (containsCitationEntry(existing, entry)) return "duplicate";
  return [...normalized, citationAttachmentForEntry(entry)];
}

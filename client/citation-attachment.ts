import type { PluginAttachmentItem } from "@getpaseo/plugin";

import type { CitationEntry } from "./citation-format";

import { formatCitationEntry, parseCitationEntry } from "./citation-format";

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
  item: PluginAttachmentItem;
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

export function citationEntryForAttachment(
  attachment: CitationComposerAttachment,
): CitationEntry | null {
  return parseCitationEntry(attachment.item.text);
}

function citationEntries(attachments: unknown[]): CitationEntry[] {
  return attachments
    .filter(isCitationComposerAttachment)
    .flatMap((attachment) => citationEntryForAttachment(attachment) ?? []);
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
    item: {
      id: citationAttachmentId(entry),
      identifier: quotePreview,
      title: previewText(entry.comment, MAX_COMMENT_PREVIEW_LENGTH) || CITATION_SOURCE_TITLE,
      subtitle: quotePreview,
      url: CITATION_URL,
      text: formatCitationEntry(entry),
      resourceType: "conversation-citation",
    },
  };
}

export function addCitationToAttachments(
  attachments: unknown[],
  entry: CitationEntry,
): unknown[] | "duplicate" {
  if (containsCitationEntry(citationEntries(attachments), entry)) return "duplicate";
  return [...attachments, citationAttachmentForEntry(entry)];
}

export function replaceCitationInAttachments(
  attachments: unknown[],
  previous: CitationEntry,
  next: CitationEntry,
): unknown[] | "duplicate" | "missing" {
  const index = attachments.findIndex(
    (attachment) =>
      isCitationComposerAttachment(attachment) &&
      containsCitationEntry(citationEntries([attachment]), previous),
  );
  if (index < 0) return "missing";

  const others = attachments.filter((_, otherIndex) => otherIndex !== index);
  if (containsCitationEntry(citationEntries(others), next)) return "duplicate";
  return attachments.map((attachment, otherIndex) =>
    otherIndex === index ? citationAttachmentForEntry(next) : attachment,
  );
}

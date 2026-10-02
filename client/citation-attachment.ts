import type { CitationEntry } from "./citation-format";

import {
  MAX_CITATION_TEXT_LENGTH,
  normalizeCitationEntry,
  parseCitationEntries,
  serializeCitationEntries,
} from "./citation-format";

const CITATION_PLUGIN_ID = "paseo-cite";
const CITATION_SOURCE_ID = "citations";
const CITATION_URL = "paseo-cite://citation";

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

function sameCitationEntries(left: CitationEntry[], right: CitationEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => right[index] !== undefined && sameCitationEntry(entry, right[index]))
  );
}

export function containsCitationEntry(entries: CitationEntry[], entry: CitationEntry): boolean {
  return entries.some((existing) => sameCitationEntry(existing, entry));
}

function citationItemFields(citations: CitationEntry[]) {
  return {
    identifier: `${citations.length} comment${citations.length === 1 ? "" : "s"}`,
    title: "Citation",
    subtitle: String(citations.length),
    url: CITATION_URL,
  };
}

export function normalizeCitationComposerAttachment(
  attachment: CitationComposerAttachment,
): CitationComposerAttachment {
  const citations = attachmentCitations(attachment);
  return {
    ...attachment,
    sourceTitle: "Citation",
    citations,
    item: {
      ...attachment.item,
      ...citationItemFields(citations),
      text: citations.length ? serializeCitationEntries(citations) : attachment.item.text,
    },
  };
}

// Returns null when every citation attachment already has the current shape.
export function migrateCitationAttachments(attachments: unknown[]): unknown[] | null {
  let changed = false;
  const nextAttachments = attachments.map((attachment) => {
    if (!isCitationComposerAttachment(attachment)) return attachment;

    const normalized = normalizeCitationComposerAttachment(attachment);
    changed =
      changed ||
      attachment.sourceTitle !== normalized.sourceTitle ||
      attachment.item.identifier !== normalized.item.identifier ||
      attachment.item.title !== normalized.item.title ||
      attachment.item.subtitle !== normalized.item.subtitle ||
      attachment.item.url !== normalized.item.url ||
      attachment.item.text !== normalized.item.text ||
      !sameCitationEntries(attachment.citations ?? [], normalized.citations ?? []);
    return normalized;
  });

  return changed ? nextAttachments : null;
}

// Combines the new entry with the entries of every citation attachment, so that no
// earlier citation is lost when more than one citation attachment exists.
export function addCitationToAttachments(
  attachments: unknown[],
  entry: CitationEntry,
): unknown[] | "duplicate" | "too-large" {
  const previousCitations: CitationEntry[] = [];
  for (const attachment of attachments) {
    if (!isCitationComposerAttachment(attachment)) continue;
    for (const citation of attachmentCitations(attachment)) {
      if (!containsCitationEntry(previousCitations, citation)) previousCitations.push(citation);
    }
  }
  if (containsCitationEntry(previousCitations, entry)) return "duplicate";

  const citations = [...previousCitations, entry];
  const text = serializeCitationEntries(citations);
  if (text.length > MAX_CITATION_TEXT_LENGTH) return "too-large";

  const citationAttachment: CitationComposerAttachment = {
    kind: "plugin_resource",
    pluginId: CITATION_PLUGIN_ID,
    sourceId: CITATION_SOURCE_ID,
    sourceTitle: "Citation",
    sourceIcon: "MessageSquareCode",
    citations,
    item: {
      id: "conversation-citations",
      ...citationItemFields(citations),
      text,
      resourceType: "conversation-citation",
    },
  };
  return [...attachments.filter((attachment) => !isCitationComposerAttachment(attachment)), citationAttachment];
}

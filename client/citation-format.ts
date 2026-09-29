export const CITATION_HEADER = "[Citation from your previous answer]";
export const CITATION_COMMENT_MARKER = "\n\nComment:\n";
export const MAX_COMMENT_LENGTH = 20_000;
export const MAX_QUOTE_LENGTH = 50_000;
export const MAX_CITATION_TEXT_LENGTH = 100_000;

export interface CitationEntry {
  quote: string;
  comment: string;
}

export function normalizeCitationText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function limitText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function escapeComment(text: string): string {
  return text
    .replaceAll(CITATION_HEADER, `\\${CITATION_HEADER}`)
    .replaceAll(CITATION_COMMENT_MARKER, "\n\nComment\\:\n");
}

function unescapeComment(text: string): string {
  return text
    .replaceAll(`\\${CITATION_HEADER}`, CITATION_HEADER)
    .replaceAll("\n\nComment\\:\n", CITATION_COMMENT_MARKER);
}

export function normalizeCitationEntry(entry: CitationEntry): CitationEntry {
  return {
    quote: limitText(normalizeCitationText(entry.quote), MAX_QUOTE_LENGTH),
    comment: limitText(normalizeCitationText(entry.comment), MAX_COMMENT_LENGTH),
  };
}

export function formatCitationEntry(entry: CitationEntry): string {
  const normalized = normalizeCitationEntry(entry);
  const quotedText = normalized.quote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return `${CITATION_HEADER}\n${quotedText}${CITATION_COMMENT_MARKER}${escapeComment(normalized.comment)}`;
}

export function formatCitation(quote: string, comment: string): string {
  return formatCitationEntry({ quote, comment });
}

export function parseCitationEntries(text: string): CitationEntry[] {
  const prefix = `${CITATION_HEADER}\n`;
  return normalizeCitationText(text)
    .split(prefix)
    .slice(1)
    .map((section) => {
      const markerIndex = section.indexOf(CITATION_COMMENT_MARKER);
      const quoteText = markerIndex < 0 ? section : section.slice(0, markerIndex);
      const commentText = markerIndex < 0 ? "" : section.slice(markerIndex + CITATION_COMMENT_MARKER.length);
      const quote = quoteText
        .split("\n")
        .map((line) => (line.startsWith("> ") ? line.slice(2) : line))
        .join("\n");

      return normalizeCitationEntry({
        quote,
        comment: unescapeComment(commentText),
      });
    })
    .filter((entry) => entry.quote.length > 0);
}

export function serializeCitationEntries(entries: CitationEntry[]): string {
  return entries.map(formatCitationEntry).join("\n\n");
}

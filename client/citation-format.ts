export const CITATION_HEADER = "[Citation from this conversation]";
export const CITATION_COMMENT_MARKER = "\n\nComment:\n";
export const MAX_COMMENT_LENGTH = 20_000;
export const MAX_QUOTE_LENGTH = 50_000;

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

export function normalizeCitationEntry(entry: CitationEntry): CitationEntry {
  return {
    quote: limitText(normalizeCitationText(entry.quote), MAX_QUOTE_LENGTH),
    comment: limitText(normalizeCitationText(entry.comment), MAX_COMMENT_LENGTH),
  };
}

export function createCitationEntry(quote: string, comment: string): CitationEntry | null {
  const entry = { quote: normalizeCitationText(quote), comment: normalizeCitationText(comment) };
  return entry.quote.length > MAX_QUOTE_LENGTH || entry.comment.length > MAX_COMMENT_LENGTH
    ? null
    : entry;
}

export function formatCitationEntry(entry: CitationEntry): string {
  const normalized = normalizeCitationEntry(entry);
  const quotedText = normalized.quote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return `${CITATION_HEADER}\n${quotedText}${CITATION_COMMENT_MARKER}${normalized.comment}`;
}

export function parseCitationEntry(text: string): CitationEntry | null {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith(`${CITATION_HEADER}\n`)) return null;

  const body = normalized.slice(CITATION_HEADER.length + 1);
  const markerIndex = body.indexOf(CITATION_COMMENT_MARKER);
  const quoteText = markerIndex < 0 ? body : body.slice(0, markerIndex);
  const comment = markerIndex < 0 ? "" : body.slice(markerIndex + CITATION_COMMENT_MARKER.length);
  const quote = quoteText
    .split("\n")
    .map((line) => (line.startsWith("> ") ? line.slice(2) : line.startsWith(">") ? line.slice(1) : line))
    .join("\n");

  const entry = normalizeCitationEntry({ quote, comment });
  return entry.quote.length > 0 ? entry : null;
}

export const CITATION_HEADER = "[Citation from this conversation]";
// Earlier versions wrote this header. Parse it so existing drafts keep working.
const LEGACY_CITATION_HEADER = "[Citation from your previous answer]";
const CITATION_HEADERS = [CITATION_HEADER, LEGACY_CITATION_HEADER];
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

// Every header in a comment gets one backslash, and parsing removes one. A comment
// line therefore never starts with a header. Quote lines start with "> ", so the
// only line-start headers are the entry delimiters.
function escapeComment(text: string): string {
  return CITATION_HEADERS.reduce((escaped, header) => escaped.replaceAll(header, `\\${header}`), text);
}

function unescapeComment(text: string): string {
  return CITATION_HEADERS.reduce(
    (unescaped, header) => unescaped.replaceAll(`\\${header}`, header),
    text,
  );
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

  return `${CITATION_HEADER}\n${quotedText}${CITATION_COMMENT_MARKER}${escapeComment(normalized.comment)}`;
}

function splitAtLineStartHeaders(text: string): string[] {
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    if (CITATION_HEADERS.includes(line)) {
      if (current) sections.push(current.join("\n"));
      current = [];
    } else {
      current?.push(line);
    }
  }
  if (current) sections.push(current.join("\n"));
  return sections;
}

export function parseCitationEntries(text: string): CitationEntry[] {
  return splitAtLineStartHeaders(normalizeCitationText(text))
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUOTE_LENGTH,
  formatCitation,
  parseCitationEntries,
  serializeCitationEntries,
} from "./citation-format.ts";

test("citation text round-trips delimiter-like comment content", () => {
  const comment = "first\n\nComment:\nsecond\n[Citation from your previous answer]";
  const text = formatCitation("first line\r\nsecond line", comment);

  assert.deepEqual(parseCitationEntries(text), [
    {
      quote: "first line\nsecond line",
      comment,
    },
  ]);
});

test("multiple citations round-trip as separate entries", () => {
  const text = serializeCitationEntries([
    { quote: "one", comment: "first" },
    { quote: "two", comment: "second" },
  ]);

  assert.deepEqual(parseCitationEntries(text), [
    { quote: "one", comment: "first" },
    { quote: "two", comment: "second" },
  ]);
});

test("quote text is normalised and bounded", () => {
  const text = formatCitation(`  ${"x".repeat(MAX_QUOTE_LENGTH + 1)}  `, "comment");
  const [entry] = parseCitationEntries(text);

  assert.equal(entry.quote.length, MAX_QUOTE_LENGTH);
  assert.equal(entry.comment, "comment");
});

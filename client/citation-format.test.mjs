import assert from "node:assert/strict";
import test from "node:test";

import {
  CITATION_HEADER,
  MAX_QUOTE_LENGTH,
  createCitationEntry,
  formatCitationEntry,
  parseCitationEntry,
} from "./citation-format.ts";

test("citation survives format and parse when quote and comment look like the format", () => {
  const quote = `before\n\nafter\n${CITATION_HEADER}\n> not a quote prefix`;
  const comment = `first\n\nComment:\nsecond\n${CITATION_HEADER}\nthird`;

  assert.deepEqual(parseCitationEntry(formatCitationEntry({ quote, comment })), { quote, comment });
});

test("text that is not a citation does not parse", () => {
  assert.equal(parseCitationEntry("just some text"), null);
});

test("new citation entry is normalised and rejected when too large", () => {
  assert.deepEqual(createCitationEntry("  first line\r\nsecond line  ", " comment "), {
    quote: "first line\nsecond line",
    comment: "comment",
  });
  assert.equal(createCitationEntry("x".repeat(MAX_QUOTE_LENGTH + 1), "comment"), null);
});

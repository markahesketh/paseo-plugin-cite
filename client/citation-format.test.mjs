import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUOTE_LENGTH,
  createCitationEntry,
  parseCitationEntries,
  serializeCitationEntries,
} from "./citation-format.ts";

test("citation text round-trips delimiter-like content", () => {
  const header = "[Citation from this conversation]";
  const legacyHeader = "[Citation from your previous answer]";
  const quote = `before\n${header}\n${legacyHeader}\nafter`;
  const comment = `first\n\nComment:\nsecond\n${header}\nthird\n\\${legacyHeader}\nfourth`;
  const text = serializeCitationEntries([{ quote, comment }]);

  assert.deepEqual(parseCitationEntries(text), [{ quote, comment }]);
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

test("text with the earlier header still parses", () => {
  const text = "[Citation from your previous answer]\n> one\n\nComment:\nfirst";

  assert.deepEqual(parseCitationEntries(text), [{ quote: "one", comment: "first" }]);
});

test("new citation entry is normalised and rejected when too large", () => {
  assert.deepEqual(createCitationEntry("  first line\r\nsecond line  ", " comment "), {
    quote: "first line\nsecond line",
    comment: "comment",
  });
  assert.equal(createCitationEntry("x".repeat(MAX_QUOTE_LENGTH + 1), "comment"), null);
});

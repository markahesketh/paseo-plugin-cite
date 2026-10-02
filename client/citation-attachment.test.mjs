import assert from "node:assert/strict";
import test from "node:test";

import { addCitationToAttachments, attachmentCitations } from "./citation-attachment.ts";

function citationAttachment(citations) {
  return {
    kind: "plugin_resource",
    pluginId: "paseo-cite",
    sourceId: "citations",
    citations,
    item: { text: "" },
  };
}

test("new citation keeps citations from every citation attachment and other attachments", () => {
  const other = { kind: "plugin_resource", pluginId: "other", sourceId: "issues", item: { text: "" } };
  const attachments = [
    citationAttachment([{ quote: "one", comment: "first" }]),
    other,
    citationAttachment([{ quote: "two", comment: "second" }]),
  ];

  const next = addCitationToAttachments(attachments, { quote: "three", comment: "third" });

  assert.equal(next.length, 2);
  assert.equal(next[0], other);
  assert.deepEqual(attachmentCitations(next[1]), [
    { quote: "one", comment: "first" },
    { quote: "two", comment: "second" },
    { quote: "three", comment: "third" },
  ]);
});

test("citation already in an attachment is a duplicate", () => {
  const attachments = [citationAttachment([{ quote: "one", comment: "first" }])];

  assert.equal(addCitationToAttachments(attachments, { quote: "one", comment: "first" }), "duplicate");
});

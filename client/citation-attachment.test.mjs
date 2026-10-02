import assert from "node:assert/strict";
import test from "node:test";

import {
  addCitationToAttachments,
  attachmentCitations,
  citationAttachmentForEntry,
  normalizeCitationAttachments,
} from "./citation-attachment.ts";

function combinedCitationAttachment(citations) {
  return {
    kind: "plugin_resource",
    pluginId: "paseo-cite",
    sourceId: "citations",
    citations,
    item: { text: "" },
  };
}

const citations = (attachments) =>
  attachments.map((attachment) => attachmentCitations(attachment));

test("each new citation gets its own attachment after the other attachments", () => {
  const other = { kind: "plugin_resource", pluginId: "other", sourceId: "issues", item: { text: "" } };
  const first = citationAttachmentForEntry({ quote: "one", comment: "first" });

  const next = addCitationToAttachments([first, other], { quote: "two", comment: "second" });

  assert.equal(next[0], first);
  assert.equal(next[1], other);
  assert.deepEqual(attachmentCitations(next[2]), [{ quote: "two", comment: "second" }]);
});

test("citation already in an attachment is a duplicate", () => {
  const attachments = [citationAttachmentForEntry({ quote: "one", comment: "first" })];

  assert.equal(addCitationToAttachments(attachments, { quote: "one", comment: "first" }), "duplicate");
});

test("combined attachments split into one attachment per unique citation", () => {
  const attachments = [
    combinedCitationAttachment([
      { quote: "one", comment: "first" },
      { quote: "two", comment: "second" },
    ]),
    combinedCitationAttachment([{ quote: "one", comment: "first" }]),
  ];

  const next = normalizeCitationAttachments(attachments);

  assert.deepEqual(citations(next), [
    [{ quote: "one", comment: "first" }],
    [{ quote: "two", comment: "second" }],
  ]);
  assert.equal(normalizeCitationAttachments(next), null);
});

test("citation pill shows the comment and quote cut to a short length", () => {
  const attachment = citationAttachmentForEntry({
    quote: "a quote that is much longer than the pill has room to show",
    comment: "a comment that is also much longer than the pill has room for",
  });

  assert.equal(attachment.item.title, "a comment that is also much longer than the pil…");
  assert.equal(attachment.item.identifier, "“a quote that is much longer than the pi…”");
});

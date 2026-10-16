import assert from "node:assert/strict";
import test from "node:test";

import {
  addCitationToAttachments,
  citationAttachmentForEntry,
  citationEntryForAttachment,
  replaceCitationInAttachments,
} from "./citation-attachment.ts";
import { formatCitationEntry } from "./citation-format.ts";

const entries = (attachments) => attachments.map(citationEntryForAttachment);

test("each new citation gets its own attachment after the other attachments", () => {
  const other = { kind: "plugin_resource", pluginId: "other", sourceId: "issues", item: { text: "" } };
  const first = citationAttachmentForEntry({ quote: "one", comment: "first" });

  const next = addCitationToAttachments([first, other], { quote: "two", comment: "second" });

  assert.equal(next[0], first);
  assert.equal(next[1], other);
  assert.deepEqual(citationEntryForAttachment(next[2]), { quote: "two", comment: "second" });
});

test("restored attachment without a citations key is recognised and deduplicated", () => {
  const restored = {
    kind: "plugin_resource",
    pluginId: "paseo-cite",
    sourceId: "citations",
    sourceTitle: "Citation",
    sourceIcon: "MessageSquareCode",
    item: {
      id: "conversation-citation-1",
      identifier: "“one”",
      title: "first",
      url: "paseo-cite://citation",
      text: formatCitationEntry({ quote: "one", comment: "first" }),
      resourceType: "conversation-citation",
    },
  };

  assert.equal(addCitationToAttachments([restored], { quote: "one", comment: "first" }), "duplicate");
});

test("citation pill shows the comment and quote cut to a short length", () => {
  const attachment = citationAttachmentForEntry({
    quote: "a quote that is much longer than the pill has room to show",
    comment: "a comment that is also much longer than the pill has room for",
  });

  assert.equal(attachment.item.title, "a comment that is also much longer than the pil…");
  assert.equal(attachment.item.identifier, "“a quote that is much longer than the pi…”");
});

test("edited citation replaces its attachment in the same position", () => {
  const first = citationAttachmentForEntry({ quote: "one", comment: "first" });
  const second = citationAttachmentForEntry({ quote: "two", comment: "second" });

  const next = replaceCitationInAttachments(
    [first, second],
    { quote: "one", comment: "first" },
    { quote: "one", comment: "changed" },
  );

  assert.deepEqual(entries(next), [
    { quote: "one", comment: "changed" },
    { quote: "two", comment: "second" },
  ]);
});

test("edit that matches another citation is a duplicate", () => {
  const attachments = [
    citationAttachmentForEntry({ quote: "one", comment: "first" }),
    citationAttachmentForEntry({ quote: "one", comment: "second" }),
  ];

  const next = replaceCitationInAttachments(
    attachments,
    { quote: "one", comment: "first" },
    { quote: "one", comment: "second" },
  );

  assert.equal(next, "duplicate");
});

import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<p id="answer">The answer is forty two.</p><div data-testid="message-input-root"><textarea></textarea></div><div id="app"></div>',
);
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so give every element a visible rect.
const rect = () => ({ top: 10, left: 10, right: 100, bottom: 30 });
window.Element.prototype.getBoundingClientRect = rect;
window.Range.prototype.getBoundingClientRect = rect;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { citationAttachmentForEntry, citationEntryForAttachment } = await import("../citation-attachment.ts");
const { formatCitationEntry } = await import("../citation-format.ts");
const { startCitationOverlay } = await import("./overlay.ts");

test("adding a citation uses the functional attachment updater", async () => {
  let currentAttachments;
  function Composer({ attachments, onChangeAttachments }) {
    return h(
      "div",
      { "data-testid": "message-input-root" },
      attachments.map((attachment) =>
        h("div", {
          key: attachment.item.id,
          "data-testid": "composer-plugin-resource-attachment-pill",
        }),
      ),
      h("textarea"),
    );
  }
  function App() {
    const [attachments, setAttachments] = useState([]);
    currentAttachments = attachments;
    return h(Composer, {
      attachments,
      onChangeAttachments: (update) => setAttachments((current) => update(current)),
    });
  }
  document.querySelector('[data-testid="message-input-root"]').remove();
  const root = createRoot(document.getElementById("app"));
  await act(() => root.render(h(App)));
  const stop = startCitationOverlay({ async copyFallback() {} });
  try {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("answer"));
    window.getSelection().addRange(range);

    document.dispatchEvent(new window.Event("selectionchange"));

    assert.equal(document.getElementById("paseo-cite-button").style.display, "block");
    await act(() =>
      document
        .getElementById("paseo-cite-button")
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    );
    const panel = document.getElementById("paseo-cite-panel");
    assert.equal(panel.style.display, "block");
    panel.querySelector("textarea").value = "Check this claim.";
    await act(() => panel.dispatchEvent(new window.Event("submit", { cancelable: true })));

    assert.equal(currentAttachments.length, 1);
    assert.deepEqual(citationEntryForAttachment(currentAttachments[0]), {
      quote: "The answer is forty two.",
      comment: "Check this claim.",
    });
  } finally {
    window.getSelection().removeAllRanges();
    stop();
    await act(() => root.unmount());
  }
});

test("editing a citation pill changes only that citation", async () => {
  let currentAttachments;
  // Paseo passes each pill its attachment and accepts functional composer updates.
  const Pill = ({ attachment }) =>
    h("div", { "data-testid": "composer-plugin-resource-attachment-pill" }, attachment.item.title);
  function Composer({ attachments, onChangeAttachments }) {
    return h(
      "div",
      { "data-testid": "message-input-root" },
      attachments.map((attachment) => h(Pill, { key: attachment.item.id, attachment })),
      h("textarea"),
    );
  }
  function App() {
    const [attachments, setAttachments] = useState([
      citationAttachmentForEntry({ quote: "one", comment: "first" }),
      citationAttachmentForEntry({ quote: "two", comment: "second" }),
    ]);
    currentAttachments = attachments;
    return h(Composer, {
      attachments,
      onChangeAttachments: (update) => setAttachments((current) => update(current)),
    });
  }
  const root = createRoot(document.getElementById("app"));
  await act(() => root.render(h(App)));
  const stop = startCitationOverlay({ async copyFallback() {} });

  const pill = document.querySelectorAll("#app [data-testid=composer-plugin-resource-attachment-pill]")[0];
  await act(() => pill.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  const panel = document.getElementById("paseo-cite-panel");
  const comment = panel.querySelector("textarea");
  assert.equal(panel.style.display, "block");
  assert.equal(comment.value, "first");

  comment.value = "changed";
  await act(() => panel.dispatchEvent(new window.Event("submit", { cancelable: true })));

  assert.equal(panel.style.display, "none");
  assert.deepEqual(
    currentAttachments.map(citationEntryForAttachment),
    [
      { quote: "one", comment: "changed" },
      { quote: "two", comment: "second" },
    ],
  );
  stop();
  await act(() => root.unmount());
});

test("citation is copied when the composer has no attachment bridge", async () => {
  const composer = document.createElement("div");
  composer.innerHTML = '<div data-testid="message-input-root"><textarea></textarea></div>';
  document.body.append(composer);
  const copied = [];
  const stop = startCitationOverlay({
    async copyFallback(text) {
      copied.push(text);
    },
  });
  try {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("answer"));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event("selectionchange"));
    document.getElementById("paseo-cite-button").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const panel = document.getElementById("paseo-cite-panel");
    panel.querySelector("textarea").value = "Check this claim.";
    panel.dispatchEvent(new window.Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve));

    assert.deepEqual(copied, [
      formatCitationEntry({ quote: "The answer is forty two.", comment: "Check this claim." }),
    ]);
    assert.equal(panel.style.display, "none");
  } finally {
    window.getSelection().removeAllRanges();
    stop();
    composer.remove();
  }
});

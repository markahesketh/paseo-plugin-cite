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
// jsdom has no layout or text search, so give every element a visible rect.
const rect = () => ({ top: 10, left: 10, right: 100, bottom: 30 });
window.Element.prototype.getBoundingClientRect = rect;
window.Range.prototype.getBoundingClientRect = rect;
window.find = () => false;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { citationAttachmentForEntry } = await import("./citation-attachment.ts");
const { startCitationOverlay } = await import("./web.ts");

test("selecting conversation text shows the cite button", () => {
  const stop = startCitationOverlay({ async copyFallback() {} });
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("answer"));
  window.getSelection().addRange(range);

  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(document.getElementById("paseo-cite-button").style.display, "block");
  window.getSelection().removeAllRanges();
  stop();
});

test("editing a citation pill changes only that citation", async () => {
  let currentAttachments;
  // Paseo passes each pill its attachment, and the composer root its attachment setter.
  const Pill = ({ attachment }) =>
    h("div", { "data-testid": "composer-plugin-resource-attachment-pill" }, attachment.item.title);
  function Composer({ attachments }) {
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
    return h(Composer, { attachments, onChangeAttachments: setAttachments });
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
    currentAttachments.map((attachment) => attachment.citations),
    [[{ quote: "one", comment: "changed" }], [{ quote: "two", comment: "second" }]],
  );
  stop();
  await act(() => root.unmount());
});

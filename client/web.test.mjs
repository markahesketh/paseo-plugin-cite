import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<p id="answer">The answer is forty two.</p><div data-testid="message-input-root"><textarea></textarea></div>',
);
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
// jsdom has no layout, so give every element a visible rect.
const rect = () => ({ top: 10, left: 10, right: 100, bottom: 30 });
window.Element.prototype.getBoundingClientRect = rect;
window.Range.prototype.getBoundingClientRect = rect;

const { startCitationOverlay } = await import("./web.ts");

test("selecting conversation text shows the cite button", () => {
  const stop = startCitationOverlay({ async copyFallback() {} });
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("answer"));
  window.getSelection().addRange(range);

  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(document.getElementById("paseo-cite-button").style.display, "block");
  stop();
});

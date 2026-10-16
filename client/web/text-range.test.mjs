import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const { window } = new JSDOM();
globalThis.window = window;
globalThis.document = window.document;

const { findQuoteNearComposer, findQuoteRange } = await import("./text-range.ts");

function render(html) {
  document.body.innerHTML = html;
  return document.body;
}

const COMPOSER = '<div data-testid="message-input-root"><textarea></textarea></div>';

test("a quote spans paragraphs that the selection joined with line breaks", () => {
  const scope = render("<p>First line.</p><p>Second line.</p>");

  assert.equal(findQuoteRange(scope, "First line.\n\nSecond line.")?.toString(), "First line.Second line.");
});

test("a quote matches text whose spacing differs", () => {
  const scope = render("<p>The  answer\n is <b>forty</b>   two.</p>");

  assert.equal(findQuoteRange(scope, "answer is forty two")?.toString(), "answer\n is forty   two");
});

test("repeated text matches its first occurrence in the scope", () => {
  const scope = render('<p id="first">same words</p><p id="second">same words</p>');

  assert.equal(findQuoteRange(scope, "same words")?.startContainer.parentElement.id, "first");
});

test("text in the composer or a citation pill is not a quote match", () => {
  const scope = render(
    '<div data-testid="message-input-root">composer text</div>' +
      '<div data-testid="composer-plugin-resource-attachment-pill">pill text</div>',
  );

  assert.equal(findQuoteRange(scope, "composer text"), null);
  assert.equal(findQuoteRange(scope, "pill text"), null);
});

test("a quote that is not in the scope has no range", () => {
  const scope = render("<p>The answer is forty two.</p>");

  assert.equal(findQuoteRange(scope, "forty three"), null);
});

test("a quote is found in the composer's own pane before the rest of the page", () => {
  render(`<nav id="sidebar">shared text</nav><main><div><p id="message">shared text</p></div>${COMPOSER}</main>`);

  const range = findQuoteNearComposer(document.querySelector("textarea"), "shared text");

  assert.equal(range?.startContainer.parentElement.id, "message");
});

test("a quote in another pane is not found from this composer", () => {
  render(
    `<section id="this"><p>this pane</p>${COMPOSER}</section>` +
      `<section id="other"><p>other pane</p>${COMPOSER}</section>`,
  );

  assert.equal(findQuoteNearComposer(document.querySelector("#this textarea"), "other pane"), null);
});

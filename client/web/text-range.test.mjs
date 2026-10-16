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

test("repeated text matches its last occurrence, the one nearest the composer", () => {
  const scope = render('<p id="first">same words</p><p id="second">same words</p>');

  assert.equal(findQuoteRange(scope, "same words")?.startContainer.parentElement.id, "second");
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

test("a quote is found in a message of the composer's own pane", () => {
  render(`<main><div data-testid="assistant-message"><p id="message">shared text</p></div>${COMPOSER}</main>`);

  const range = findQuoteNearComposer(document.querySelector("textarea"), "shared text");

  assert.equal(range?.startContainer.parentElement.id, "message");
});

test("a quote is found in conversation content outside the messages", () => {
  render(
    `<main><div data-testid="assistant-message"><p>an answer</p></div>` +
      `<div id="tool">tool output</div>${COMPOSER}</main>`,
  );

  const range = findQuoteNearComposer(document.querySelector("textarea"), "tool output");

  assert.equal(range?.startContainer.parentElement.id, "tool");
});

test("text outside the conversation is not a quote match", () => {
  render(
    `<nav>sidebar only</nav>` +
      `<main><div data-testid="assistant-message"><p>an answer</p></div>${COMPOSER}</main>`,
  );

  assert.equal(findQuoteNearComposer(document.querySelector("textarea"), "sidebar only"), null);
});

test("a quote in another pane is not found from this composer", () => {
  const pane = (id) =>
    `<section id="${id}"><div data-testid="assistant-message"><p>${id} pane</p></div>${COMPOSER}</section>`;
  render(pane("this") + pane("other"));

  assert.equal(findQuoteNearComposer(document.querySelector("#this textarea"), "other pane"), null);
});

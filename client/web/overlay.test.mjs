import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { installDragAndDrop } from "../../test/drag-and-drop.mjs";

const { window } = new JSDOM('<p id="answer">The answer is forty two.</p>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDragAndDrop(window);
const rect = () => ({ top: 10, left: 10, right: 100, bottom: 30 });
window.Element.prototype.getBoundingClientRect = rect;
window.Element.prototype.scrollIntoView = () => {};
window.Range.prototype.getBoundingClientRect = rect;
window.Range.prototype.getClientRects = () => [rect()];

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { citationAttachmentForEntry, citationEntryForAttachment } = await import("../citation-attachment.ts");
const { formatCitationEntry } = await import("../citation-format.ts");
const { commentKeyAction, startCitationOverlay } = await import("./overlay.ts");

const PILL_SELECTOR = '[data-testid="composer-plugin-resource-attachment-pill"]';
const ANSWER = { quote: "The answer is forty two.", comment: "Check this claim." };

async function renderComposer(initialAttachments = []) {
  const container = document.createElement("div");
  document.body.append(container);
  let current = initialAttachments;
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
    const [attachments, setAttachments] = useState(initialAttachments);
    current = attachments;
    return h(Composer, {
      attachments,
      onChangeAttachments: (update) => setAttachments((previous) => update(previous)),
    });
  }
  const root = createRoot(container);
  await act(() => root.render(h(App)));
  return {
    entries: () => current.map(citationEntryForAttachment),
    pill: (index) => container.querySelectorAll(PILL_SELECTOR)[index],
    async cleanup() {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

function startOverlay(options = {}) {
  const release = startCitationOverlay({ async copyFallback() {}, ...options });
  return () => {
    window.getSelection().removeAllRanges();
    release();
  };
}

const toolbar = () => document.getElementById("paseo-cite-actions");
const citeButton = () => document.getElementById("paseo-cite-button");
const panel = () => document.getElementById("paseo-cite-panel");
const comment = () => panel().querySelector("textarea");
const shown = (element) =>
  Boolean(element?.isConnected) && window.getComputedStyle(element).display !== "none";

function selectAnswer() {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("answer"));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
}

const mouse = (element, type) =>
  act(() => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  });
const click = (element) => mouse(element, "click");

const keydown = (element, key, init = {}) =>
  act(() => {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
    return event;
  });

async function submitComment(text) {
  comment().value = text;
  await act(() => panel().dispatchEvent(new window.Event("submit", { cancelable: true })));
}

test("a comment on selected text becomes a citation attachment", async () => {
  const composer = await renderComposer();
  const stop = startOverlay();
  try {
    selectAnswer();
    assert.equal(shown(toolbar()), true);

    await click(citeButton());
    assert.equal(shown(panel()), true);

    await submitComment(ANSWER.comment);

    assert.equal(shown(panel()), false);
    assert.deepEqual(composer.entries(), [ANSWER]);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("a quick reply cites the selected text with its reply as the comment", async () => {
  const composer = await renderComposer();
  const stop = startOverlay();
  try {
    selectAnswer();
    const yes = [...toolbar().querySelectorAll("button")].find((button) => button.textContent === "Yes");

    await click(yes);

    assert.deepEqual(composer.entries(), [{ quote: ANSWER.quote, comment: "Yes" }]);
    assert.equal(shown(toolbar()), false);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("a citation pill opens its comment for editing", async () => {
  const composer = await renderComposer([
    citationAttachmentForEntry({ quote: "one", comment: "first" }),
    citationAttachmentForEntry({ quote: "two", comment: "second" }),
  ]);
  const stop = startOverlay();
  try {
    await click(composer.pill(0));
    assert.equal(shown(panel()), true);
    assert.equal(comment().value, "first");

    await submitComment("changed");

    assert.equal(shown(panel()), false);
    assert.deepEqual(composer.entries(), [
      { quote: "one", comment: "changed" },
      { quote: "two", comment: "second" },
    ]);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("the citation is copied when the composer has no attachment bridge", async () => {
  const composer = document.createElement("div");
  composer.innerHTML = '<div data-testid="message-input-root"><textarea></textarea></div>';
  document.body.append(composer);
  const copied = [];
  const stop = startOverlay({
    async copyFallback(text) {
      copied.push(text);
    },
  });
  try {
    selectAnswer();
    await click(citeButton());
    await submitComment(ANSWER.comment);
    await new Promise((resolve) => setTimeout(resolve));

    assert.deepEqual(copied, [formatCitationEntry(ANSWER)]);
    assert.equal(shown(panel()), false);
  } finally {
    stop();
    composer.remove();
  }
});

test("bundle copies share one overlay until the last copy releases it", async () => {
  const secondCopy = await import("./overlay.ts?copy=2");
  const composer = await renderComposer([citationAttachmentForEntry({ quote: "one", comment: "first" })]);
  const releaseFirst = startOverlay();
  const releaseSecond = secondCopy.startCitationOverlay({ async copyFallback() {} });
  try {
    assert.equal(document.querySelectorAll("#paseo-cite-overlay").length, 1);

    releaseSecond();
    releaseSecond();
    await click(composer.pill(0));
    assert.equal(shown(panel()), true);

    releaseFirst();
    assert.equal(document.getElementById("paseo-cite-overlay"), null);
    const pillClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(() => composer.pill(0).dispatchEvent(pillClick));
    assert.equal(pillClick.defaultPrevented, false);
  } finally {
    releaseFirst();
    await composer.cleanup();
  }
});

test("focus stays in the comment box and Escape there closes the panel", async () => {
  const composer = await renderComposer();
  const stop = startOverlay();
  try {
    selectAnswer();
    await click(citeButton());
    assert.equal(document.activeElement, comment());

    const tab = await keydown(comment(), "Tab");
    assert.equal(tab.defaultPrevented, true);
    for (const target of [panel().querySelector("button[type=submit]"), panel()]) {
      const press = await mouse(target, "mousedown");
      assert.equal(press.defaultPrevented, true);
    }
    assert.equal(document.activeElement, comment());

    await keydown(comment(), "Escape");
    assert.equal(shown(panel()), false);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("Alt+Enter inserts a newline in the comment", async () => {
  const composer = await renderComposer();
  const stop = startOverlay();
  try {
    selectAnswer();
    await click(citeButton());
    comment().value = "first";
    comment().setSelectionRange(5, 5);

    await keydown(comment(), "Enter", { altKey: true });

    assert.equal(comment().value, "first\n");
    assert.equal(shown(panel()), true);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("Cancel and a click outside the panel close it without changes", async () => {
  const composer = await renderComposer([citationAttachmentForEntry({ quote: "one", comment: "first" })]);
  const stop = startOverlay();
  try {
    await click(composer.pill(0));
    comment().value = "unsaved";
    await click(panel().querySelector("button[type=button]"));
    assert.equal(shown(panel()), false);

    await click(composer.pill(0));
    await mouse(document.getElementById("answer"), "mousedown");
    assert.equal(shown(panel()), false);
    assert.deepEqual(composer.entries(), [{ quote: "one", comment: "first" }]);
  } finally {
    stop();
    await composer.cleanup();
  }
});

test("Enter on a citation pill opens it for editing", async () => {
  const composer = await renderComposer([citationAttachmentForEntry({ quote: "one", comment: "first" })]);
  const stop = startOverlay();
  try {
    const enter = await keydown(composer.pill(0), "Enter");
    assert.equal(shown(panel()), true);
    assert.equal(comment().value, "first");
    assert.equal(enter.defaultPrevented, true);

  } finally {
    stop();
    await composer.cleanup();
  }
});

test("a copy that finishes late leaves a reopened panel alone", async () => {
  const composer = document.createElement("div");
  composer.innerHTML = '<div data-testid="message-input-root"><textarea></textarea></div>';
  document.body.append(composer);
  let finishCopy;
  const stop = startOverlay({
    copyFallback: () => new Promise((resolve) => (finishCopy = resolve)),
  });
  try {
    selectAnswer();
    await click(citeButton());
    await submitComment(ANSWER.comment);
    await keydown(comment(), "Escape");
    selectAnswer();
    await click(citeButton());
    assert.equal(shown(panel()), true);

    finishCopy();
    await new Promise((resolve) => setTimeout(resolve));

    assert.equal(shown(panel()), true);
    assert.equal(shown(document.querySelector("#paseo-cite-overlay [role=status]")), false);
  } finally {
    stop();
    composer.remove();
  }
});

test("Enter submits the comment unless it inserts a newline or belongs to the IME", () => {
  const enter = { key: "Enter", shiftKey: false, altKey: false, isComposing: false, keyCode: 13 };

  assert.equal(commentKeyAction(enter), "submit");
  assert.equal(commentKeyAction({ ...enter, shiftKey: true }), "newline");
  assert.equal(commentKeyAction({ ...enter, altKey: true }), "newline");
  assert.equal(commentKeyAction({ ...enter, isComposing: true }), "none");
  assert.equal(commentKeyAction({ ...enter, keyCode: 229 }), "none");
  assert.equal(commentKeyAction({ ...enter, key: "a" }), "none");
});

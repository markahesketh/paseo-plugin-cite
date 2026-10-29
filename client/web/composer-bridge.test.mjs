import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { installDragAndDrop } from "../../test/drag-and-drop.mjs";

const { window } = new JSDOM('<div id="app"></div>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDragAndDrop(window);

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { citationAttachmentForEntry } = await import("../citation-attachment.ts");
const { formatCitationEntry } = await import("../citation-format.ts");
const { addCitation, findComposerInput } = await import("./composer-bridge.ts");

function renderBotsComposer() {
  const zone = document.createElement("div");
  zone.innerHTML = '<div><textarea aria-label="Message Barry"></textarea></div>';
  document.body.append(zone);
  const input = zone.querySelector("textarea");
  input.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: 20 });
  return { zone, input };
}

function readFile(file) {
  const reader = new window.FileReader();
  reader.readAsText(file);
  return new Promise((resolve) => reader.addEventListener("load", () => resolve(reader.result)));
}

test("a citation joins attachments the composer has not rendered yet", async () => {
  let currentAttachments;
  let setAttachments;
  function Composer() {
    return h("div", { "data-testid": "message-input-root" }, h("textarea"));
  }
  function App() {
    const [attachments, setState] = useState([]);
    currentAttachments = attachments;
    setAttachments = setState;
    return h(Composer, {
      attachments,
      onChangeAttachments: (update) => setState((current) => update(current)),
    });
  }
  const root = createRoot(document.getElementById("app"));
  await act(() => root.render(h(App)));
  const pasted = { kind: "image", id: "pasted" };
  const entry = { quote: "forty two", comment: "Check." };

  await act(() => {
    setAttachments((current) => [...current, pasted]);
    addCitation(document.querySelector("textarea"), entry);
  });

  assert.deepEqual(currentAttachments, [pasted, citationAttachmentForEntry(entry)]);
  await act(() => root.unmount());
});

test("a composer without the attachment bridge receives the citation as a dropped Markdown file", async () => {
  const { zone, input } = renderBotsComposer();
  const dropped = [];
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropped.push(...event.dataTransfer.files);
  });
  const entry = { quote: "forty two", comment: "Check." };

  const result = addCitation(findComposerInput(zone, input.getBoundingClientRect()), entry);

  assert.deepEqual(result, { ok: true });
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].name, /^Citation.*\.md$/);
  assert.equal(await readFile(dropped[0]), formatCitationEntry(entry));
  assert.equal(document.activeElement, input);
  zone.remove();
});

test("a dropped citation nobody accepts is reported unavailable", () => {
  const { zone, input } = renderBotsComposer();

  const result = addCitation(input, { quote: "forty two", comment: "Check." });

  assert.deepEqual(result, { ok: false, reason: "unavailable" });
  zone.remove();
});

import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const { window } = new JSDOM('<div id="app"></div>');
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { citationAttachmentForEntry } = await import("../citation-attachment.ts");
const { addCitation } = await import("./composer-bridge.ts");

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

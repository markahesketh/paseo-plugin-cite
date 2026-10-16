import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { findFiberProps } = await import("./react-fiber.ts");

test("fiber props are the latest committed props after each render", async () => {
  let setAttachments;
  function Composer({ attachments }) {
    // A controlled textarea changes props on each render, so its fiber alternates.
    return h("div", null, h("textarea", { value: attachments.join(","), onChange() {} }));
  }
  function App() {
    const [attachments, setState] = useState(["1"]);
    setAttachments = setState;
    return h(Composer, { attachments });
  }
  const root = createRoot(document.getElementById("root"));
  await act(() => root.render(h(App)));
  const textarea = document.querySelector("textarea");

  for (const attachments of [["1", "2"], ["1", "2", "3"]]) {
    await act(() => setAttachments(attachments));
    const props = findFiberProps(textarea, (props) => Array.isArray(props.attachments));
    assert.deepEqual(props.attachments, attachments);
  }
  await act(() => root.unmount());
});

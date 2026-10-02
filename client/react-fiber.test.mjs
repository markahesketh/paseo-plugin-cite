import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { findCommittedFiberPath } = await import("./react-fiber.ts");

test("committed fiber path holds the latest props after each render", async () => {
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
    const composer = findCommittedFiberPath(textarea).find((fiber) =>
      Array.isArray(fiber.memoizedProps?.attachments),
    );
    assert.deepEqual(composer.memoizedProps.attachments, attachments);
  }
  await act(() => root.unmount());
});

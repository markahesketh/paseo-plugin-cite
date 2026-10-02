import assert from "node:assert/strict";
import test from "node:test";

import { findCommittedFiber } from "./react-fiber.ts";

function fiberTree(attachments) {
  const fiberRoot = {};
  const hostRoot = { tag: 3, stateNode: fiberRoot };
  const composer = { tag: 0, return: hostRoot, memoizedProps: { attachments } };
  const input = { tag: 5, return: composer, stateNode: "textarea" };
  hostRoot.child = composer;
  composer.child = input;
  return { fiberRoot, hostRoot, input };
}

test("committed fiber replaces the stale copy cached on the DOM node", () => {
  const stale = fiberTree(["first"]);
  const committed = fiberTree(["first", "second"]);
  stale.hostRoot.stateNode = committed.fiberRoot;
  committed.fiberRoot.current = committed.hostRoot;

  const fiber = findCommittedFiber(stale.input);

  assert.equal(fiber, committed.input);
  assert.deepEqual(fiber.return.memoizedProps.attachments, ["first", "second"]);
});

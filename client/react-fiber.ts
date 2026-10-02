export interface ReactFiberNode {
  tag?: number;
  return?: ReactFiberNode | null;
  child?: ReactFiberNode | null;
  sibling?: ReactFiberNode | null;
  stateNode?: unknown;
  memoizedProps?: Record<string, unknown>;
}

const HOST_ROOT_TAG = 3;

export function findReactFiber(element: object): ReactFiberNode | null {
  const properties = element as Record<string, unknown>;
  const fiberProperty = Object.getOwnPropertyNames(properties).find(
    (property) =>
      property.startsWith("__reactFiber$") || property.startsWith("__reactInternalInstance$"),
  );
  const fiber = fiberProperty ? properties[fiberProperty] : null;
  return fiber && typeof fiber === "object" ? (fiber as ReactFiberNode) : null;
}

// React caches a fiber on a DOM node only when it creates the node. Each render swaps
// between two fiber copies, so the cached copy can hold props from an older render.
// Find the copy for the same DOM node in the committed tree.
export function findCommittedFiber(fiber: ReactFiberNode): ReactFiberNode {
  let root = fiber;
  while (root.return) root = root.return;
  if (root.tag !== HOST_ROOT_TAG) return fiber;

  const committedRoot = (root.stateNode as { current?: ReactFiberNode } | null)?.current;
  if (!committedRoot) return fiber;

  const pending: ReactFiberNode[] = [committedRoot];
  while (pending.length > 0) {
    const node = pending.pop() as ReactFiberNode;
    if (node.stateNode === fiber.stateNode) return node;
    if (node.sibling) pending.push(node.sibling);
    if (node.child) pending.push(node.child);
  }
  return fiber;
}

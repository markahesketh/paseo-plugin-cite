export interface ReactFiberNode {
  tag?: number;
  return?: ReactFiberNode | null;
  child?: ReactFiberNode | null;
  sibling?: ReactFiberNode | null;
  alternate?: ReactFiberNode | null;
  stateNode?: unknown;
  memoizedProps?: Record<string, unknown>;
}

const HOST_ROOT_TAG = 3;

function findReactFiber(element: object): ReactFiberNode | null {
  const properties = element as Record<string, unknown>;
  const fiberProperty = Object.getOwnPropertyNames(properties).find(
    (property) =>
      property.startsWith("__reactFiber$") || property.startsWith("__reactInternalInstance$"),
  );
  const fiber = fiberProperty ? properties[fiberProperty] : null;
  return fiber && typeof fiber === "object" ? (fiber as ReactFiberNode) : null;
}

// React caches a fiber on a DOM node only when it creates the node. Each render swaps
// between two fiber copies, so the cached copy and its return pointers can hold props
// from an older render. Follow the path from the committed root instead. At each level,
// the committed fiber is the cached path fiber or its alternate.
//
// Returns the committed fibers from the element up to the root, or null if the
// element is not in the committed tree.
export function findCommittedFiberPath(element: object): ReactFiberNode[] | null {
  const cachedPath: ReactFiberNode[] = [];
  for (let fiber = findReactFiber(element); fiber; fiber = fiber.return ?? null) {
    cachedPath.push(fiber);
  }
  const root = cachedPath.at(-1);
  if (!root || root.tag !== HOST_ROOT_TAG) return null;

  const committedRoot = (root.stateNode as { current?: ReactFiberNode } | null)?.current;
  if (!committedRoot) return null;

  let committed: ReactFiberNode = committedRoot;
  const committedPath = [committed];
  for (let index = cachedPath.length - 2; index >= 0; index -= 1) {
    const cached = cachedPath[index];
    let child: ReactFiberNode | null = committed.child ?? null;
    while (child && child !== cached && child !== cached.alternate) child = child.sibling ?? null;
    if (!child) return null;
    committed = child;
    committedPath.push(committed);
  }
  return committedPath.reverse();
}

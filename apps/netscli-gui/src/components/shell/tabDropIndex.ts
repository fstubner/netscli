/**
 * Where a dragged tab should sit, given the pointer and the tabs' geometry.
 *
 * Split out because it is the part that goes wrong. Live reordering feeds its
 * own output back in: the moment a tab moves, the geometry under the pointer
 * changes, and a naive midpoint test then sends it straight back where it
 * came from and the tab flickers between two slots for as long as you hold
 * it. jsdom has no layout — every rect is zero — so this cannot be tested
 * through the component, only as a function over the numbers.
 *
 * The rule that avoids the feedback loop: ignore the dragged tab and count
 * how many of the *others* the pointer has passed. That count is the
 * insertion index. It does not depend on where the dragged tab currently is,
 * so re-running it after a move returns the same answer until the pointer
 * genuinely crosses another tab.
 */
export interface TabBox {
  /** Left edge, in the same coordinate space as `clientX`. */
  left: number;
  width: number;
}

export function tabDropIndex(boxes: TabBox[], draggedIndex: number, clientX: number): number {
  if (boxes.length === 0) return -1;
  if (draggedIndex < 0 || draggedIndex >= boxes.length) return -1;

  let passed = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    if (i === draggedIndex) continue;
    const box = boxes[i];
    if (clientX > box.left + box.width / 2) passed += 1;
  }
  return passed;
}

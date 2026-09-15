export function getBlockMenuAnchor(selection) {
  const $from = selection?.$from
  if (!$from || $from.depth < 1) return null
  return $from
}

// 飞书式判定：操作柄属于「当前正在操作的块」，而不是「编辑器是否聚焦」。
// 点击操作柄、打开菜单或拖动过程中编辑器会失焦，此时操作柄必须继续可用。
export function shouldShowBlockMenu({ isDestroyed, isEditable, isFocused, interacting, hasTarget }) {
  if (isDestroyed || !isEditable) return false
  if (!hasTarget) return false
  return Boolean(isFocused) || Boolean(interacting)
}

export function getBlockInsertionIndex(blockRects, clientY) {
  const index = blockRects.findIndex((rect) => clientY < rect.top + (rect.height / 2))
  return index === -1 ? blockRects.length : index
}

export function getBlockMoveTargetIndex(sourceIndex, insertionIndex, blockCount) {
  if (
    !Number.isInteger(sourceIndex)
    || !Number.isInteger(insertionIndex)
    || sourceIndex < 0
    || sourceIndex >= blockCount
    || insertionIndex < 0
    || insertionIndex > blockCount
  ) return null

  const targetIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex
  return targetIndex === sourceIndex ? null : targetIndex
}

function getTopLevelPosition(doc, index) {
  let position = 0
  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    position += doc.child(currentIndex).nodeSize
  }
  return position
}

export function moveTopLevelBlock(transaction, sourceIndex, targetIndex) {
  const blockCount = transaction.doc.childCount
  if (
    !Number.isInteger(sourceIndex)
    || !Number.isInteger(targetIndex)
    || sourceIndex < 0
    || sourceIndex >= blockCount
    || targetIndex < 0
    || targetIndex >= blockCount
    || sourceIndex === targetIndex
  ) return null

  const sourceNode = transaction.doc.child(sourceIndex)
  const sourcePosition = getTopLevelPosition(transaction.doc, sourceIndex)
  transaction.delete(sourcePosition, sourcePosition + sourceNode.nodeSize)
  const insertPosition = getTopLevelPosition(transaction.doc, targetIndex)
  transaction.insert(insertPosition, sourceNode)
  return { transaction, insertPosition, node: sourceNode }
}

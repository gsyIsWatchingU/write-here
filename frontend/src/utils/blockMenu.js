export function getBlockMenuAnchor(selection) {
  const $from = selection?.$from
  if (!$from || $from.depth < 1) return null
  return $from
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

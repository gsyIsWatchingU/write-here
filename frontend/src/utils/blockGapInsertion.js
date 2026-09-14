import { TextSelection } from '@tiptap/pm/state'

export function findBlockGapInsertionIndex(blockRects, clientY) {
  if (!Array.isArray(blockRects) || !Number.isFinite(clientY)) return -1

  for (let index = 1; index < blockRects.length; index += 1) {
    const previous = blockRects[index - 1]
    const next = blockRects[index]
    if (clientY > previous.bottom && clientY < next.top) return index
  }

  return -1
}

export function getTopLevelInsertionPosition(doc, childIndex) {
  if (!doc || childIndex < 0 || childIndex > doc.childCount) return null

  let position = 0
  for (let index = 0; index < childIndex; index += 1) {
    position += doc.child(index).nodeSize
  }
  return position
}

export function hasAdjacentEmptyTextBlock(doc, childIndex) {
  if (!doc || childIndex < 0 || childIndex > doc.childCount) return false

  return [childIndex - 1, childIndex].some((index) => {
    if (index < 0 || index >= doc.childCount) return false
    const node = doc.child(index)
    return node.isTextblock && node.content.size === 0
  })
}

export function insertParagraphInClickedGap(view, event) {
  if (
    !view?.editable
    || event?.button !== 0
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.shiftKey
  ) return false

  const blockElements = Array.from(view.dom?.children || [])
  if (blockElements.length !== view.state.doc.childCount) return false

  const blockRects = blockElements.map(element => element.getBoundingClientRect())
  const childIndex = findBlockGapInsertionIndex(blockRects, event.clientY)
  if (childIndex < 0) return false
  if (hasAdjacentEmptyTextBlock(view.state.doc, childIndex)) return false

  const position = getTopLevelInsertionPosition(view.state.doc, childIndex)
  const paragraphType = view.state.schema.nodes.paragraph
  if (position === null || !paragraphType) return false

  const transaction = view.state.tr.insert(position, paragraphType.create())
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1))
  view.dispatch(transaction.scrollIntoView())
  view.focus()
  event.preventDefault()
  return true
}

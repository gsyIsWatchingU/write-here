import { TextSelection } from '@tiptap/pm/state'

/**
 * 在行尾按回车就能直接得到普通段落的顶层块类型。
 * 这些块自己带有可用的出口，不需要点击空白辅助补行。
 */
const TRAILING_ESCAPE_TYPES = new Set(['paragraph', 'heading'])

export function findBlockGapInsertionIndex(blockRects, clientY) {
  if (!Array.isArray(blockRects) || !Number.isFinite(clientY)) return -1

  for (let index = 1; index < blockRects.length; index += 1) {
    const previous = blockRects[index - 1]
    const next = blockRects[index]
    if (clientY > previous.bottom && clientY < next.top) return index
  }

  return -1
}

/**
 * 点击最后一块下方的空白时返回末尾插入索引（等于块数量），否则返回 -1。
 * 与 findBlockGapInsertionIndex 分开：块间空隙与文档末尾是两种语义。
 */
export function findTrailingInsertionIndex(blockRects, clientY) {
  if (!Array.isArray(blockRects) || blockRects.length === 0 || !Number.isFinite(clientY)) return -1

  const lastRect = blockRects[blockRects.length - 1]
  if (!lastRect || !Number.isFinite(lastRect.bottom)) return -1

  return clientY > lastRect.bottom ? blockRects.length : -1
}

/**
 * 末尾块是否缺少「直接回车新建普通行」的出口。
 * 段落和标题按回车就会新增普通段落；代码块、列表、引用、表格等需要额外操作，
 * 这时才允许点击末尾空白补一行。
 * 判据只取块类型，不看内容是否为空：空的代码块同样困在块内，仍有补行需求。
 */
export function shouldInsertTrailingParagraph(node) {
  if (!node) return false
  return !TRAILING_ESCAPE_TYPES.has(node.type.name)
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
  const gapIndex = findBlockGapInsertionIndex(blockRects, event.clientY)
  const trailingIndex = gapIndex < 0 ? findTrailingInsertionIndex(blockRects, event.clientY) : -1
  const childIndex = gapIndex >= 0 ? gapIndex : trailingIndex
  if (childIndex < 0) return false

  if (trailingIndex >= 0) {
    const lastChild = view.state.doc.child(view.state.doc.childCount - 1)
    if (!shouldInsertTrailingParagraph(lastChild)) return false
  } else if (hasAdjacentEmptyTextBlock(view.state.doc, childIndex)) {
    return false
  }

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

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

/**
 * 在文档末尾补一个空段落并聚焦。供两类点击复用：
 * - .ProseMirror 盒内末尾空白（insertParagraphInClickedGap）；
 * - .editor-content 容器底部大空白（insertParagraphInLeadingBlank，见下）。
 * 仅当最后一个顶层块缺少回车出口时补行，返回是否已处理。
 */
function insertTrailingParagraph(view, event) {
  const doc = view.state.doc
  const lastChild = doc.child(doc.childCount - 1)
  if (!shouldInsertTrailingParagraph(lastChild)) return false

  const paragraphType = view.state.schema.nodes.paragraph
  if (!paragraphType) return false

  const position = getTopLevelInsertionPosition(doc, doc.childCount)
  if (position === null) return false

  const transaction = view.state.tr.insert(position, paragraphType.create())
  transaction.setSelection(TextSelection.create(transaction.doc, position + 1))
  view.dispatch(transaction.scrollIntoView())
  view.focus()
  event.preventDefault()
  return true
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

/**
 * 返回空隙相邻的空文本块在顶层子节点中的索引，没有则返回 -1。
 */
function findAdjacentEmptyTextBlockIndex(doc, childIndex) {
  for (const index of [childIndex, childIndex - 1]) {
    if (index < 0 || index >= doc.childCount) continue
    const node = doc.child(index)
    if (node.isTextblock && node.content.size === 0) return index
  }
  return -1
}

/**
 * 点击编辑器容器顶部 padding 空白（第一个块上方）时，在文档开头插入空段落并聚焦。
 *
 * 为什么需要单独处理：handleDOMEvents 注册在 .ProseMirror（view.dom）上，
 * 而 .editor-content 有 40px 顶部 padding，点击 padding 时事件 target 是 .editor-content 本身，
 * 不经过 .ProseMirror，所以 insertParagraphInClickedGap 收不到这个事件。
 * 本函数在 .editor-content 的 mousedown 上调用；第一个参数是 ProseMirror EditorView
 * （由调用方从 editor.view 传入，与 handleDOMEvents 回调拿到的是同一对象形态）。
 *
 * 与末尾补行共用同一判据（shouldInsertTrailingParagraph）：只有第一个块缺少
 * 「回车在块前新建一行」的出口时才补行。段落、标题在行首按回车就能在块前新建一行，
 * 保持默认光标行为即可；代码块、图片、列表、引用等块内回车不产生新块，才需要点击顶部空白补一行。
 *
 * 同理处理底部：.editor-content 还有 min-height 形成的底部大空白（超出 .ProseMirror
 * 400px 最小高度的那一段）。点击这段空白时 target 同样是 .editor-content，会走到本函数；
 * 当点击位置在最后一个块下方时，复用 insertTrailingParagraph 补一行——否则用户在
 * 代码块/图片下方点空白永远得不到新行。
 */
export function insertParagraphInLeadingBlank(view, event) {
  if (
    !view?.editable
    || event?.button !== 0
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.shiftKey
  ) return false

  // view.dom 是 .ProseMirror，它的父元素才是 .editor-content
  const containerEl = view.dom?.parentElement
  if (!containerEl) return false

  // 只有点击 .editor-content 本身（padding/min-height 空白）才处理；
  // 点击块内部的事件 target 是块 DOM，不命中。
  if (event.target !== containerEl) return false

  const blockElements = Array.from(view.dom.children || [])
  if (blockElements.length === 0) return false

  const firstRect = blockElements[0].getBoundingClientRect()
  if (event.clientY >= firstRect.top) {
    // 不在第一个块上方：检查是否落在最后一个块下方的容器空白里
    if (blockElements.length !== view.state.doc.childCount) return false
    const lastRect = blockElements[blockElements.length - 1].getBoundingClientRect()
    if (!lastRect || event.clientY <= lastRect.bottom) return false
    return insertTrailingParagraph(view, event)
  }

  const doc = view.state.doc
  const firstNode = doc.child(0)

  // 第一个块是段落、标题（能直接回车在块前新建一行）时不补行；
  // 代码块、图片、列表、引用等才需要这个出口。
  if (!shouldInsertTrailingParagraph(firstNode)) return false

  const paragraphType = view.state.schema.nodes.paragraph
  if (!paragraphType) return false

  // 在文档最开头插入一个空段落并把光标放进去
  const transaction = view.state.tr.insert(0, paragraphType.create())
  transaction.setSelection(TextSelection.create(transaction.doc, 1))
  view.dispatch(transaction.scrollIntoView())
  view.focus()
  event.preventDefault()
  return true
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
    return insertTrailingParagraph(view, event)
  } else if (hasAdjacentEmptyTextBlock(view.state.doc, childIndex)) {
    // 旁边已有空文本块。普通文本块之间，ProseMirror 默认 mousedown 会把光标放进去；
    // 但空隙另一侧是 atom 节点（如块级图片）时，posAtCoords 会命中 atom 本身，
    // 导致点击空白反而选中图片——这时主动把光标移到空文本块里。
    const doc = view.state.doc
    const emptyIndex = findAdjacentEmptyTextBlockIndex(doc, childIndex)
    if (emptyIndex < 0) return false

    const otherIndex = emptyIndex === childIndex ? childIndex - 1 : childIndex
    const otherNode = otherIndex >= 0 && otherIndex < doc.childCount ? doc.child(otherIndex) : null
    if (!otherNode || !otherNode.isAtom) return false

    const position = getTopLevelInsertionPosition(doc, emptyIndex)
    if (position === null) return false

    const transaction = view.state.tr
    transaction.setSelection(TextSelection.create(doc, position + 1))
    view.dispatch(transaction.scrollIntoView())
    view.focus()
    event.preventDefault()
    return true
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

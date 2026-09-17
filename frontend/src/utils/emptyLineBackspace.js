import { TextSelection } from '@tiptap/pm/state'

// 空行可能包裹在列表容器中，删除时需要一并处理的最小容器类型。
const CONTAINER_TYPES = new Set([
  'listItem',
  'taskItem',
  'orderedList',
  'bulletList',
  'taskList',
])

/**
 * 处理文档最前端空行的退格删除。
 *
 * ProseMirror 默认的 Backspace 在「光标位于空文本块开头、且前方没有可合并
 * 的块」时不做任何事（无法 join 前块，也无法选中前节点）。典型场景是文档
 * 第一行是空段落，或文档以空的有序/无序列表项开头。此时用户按 Backspace
 * 应直接删除这行空行。
 *
 * 仅在以下条件同时满足时干预，其余情况一律返回 false 交给默认行为：
 * - 按下 Backspace（无组合键）、编辑器可编辑、选区为空；
 * - 光标位于空文本块的最前端；
 * - 该空文本块在每一层祖先中都是第一个子节点（即文档最前端没有前序内容）。
 */
export function handleBackspaceDeleteEmptyLine(view, event) {
  if (event.key !== 'Backspace' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false
  }
  if (!view.editable) return false

  const { state } = view
  const { selection } = state
  if (!selection.empty) return false

  const $from = selection.$from
  if ($from.depth < 1 || $from.parentOffset !== 0) return false

  const block = $from.parent
  if (!block.isTextblock || block.content.size !== 0) return false

  // 空文本块必须在每一层都是第一个子节点，否则默认退格可以合并前块。
  for (let level = 0; level <= $from.depth - 1; level += 1) {
    if ($from.index(level) !== 0) return false
  }

  // 向上合并仅含空内容的列表容器，确定最小可删除节点。
  let depth = $from.depth
  while (depth > 1) {
    const parent = $from.node(depth - 1)
    if (!CONTAINER_TYPES.has(parent.type.name) || parent.childCount !== 1) break
    depth -= 1
  }

  // 删除目标不是文档直接子节点、且父节点不是列表容器时（如表格单元格、
  // 引用块内的空段落），保持默认行为，避免产生非法文档结构。
  if (depth > 1 && !CONTAINER_TYPES.has($from.node(depth - 1).type.name)) return false

  const doc = state.doc
  const start = $from.before(depth)
  const end = start + $from.node(depth).nodeSize
  const tr = state.tr
  const isWholeDoc = start === 0 && end === doc.content.size

  // 文档只剩一个空段落：删除没有意义，交给默认行为（保持至少一个块）。
  if (isWholeDoc && depth === 1 && $from.node(1) === block) return false

  if (isWholeDoc) {
    const paragraphType = state.schema.nodes.paragraph
    if (!paragraphType) return false
    tr.replaceWith(0, doc.content.size, paragraphType.create())
  } else {
    tr.delete(start, end)
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(start), 1))
  view.dispatch(tr.scrollIntoView())
  return true
}

import { Fragment, Slice } from '@tiptap/pm/model'

// 只拆显式换行；自动折行没有 hardBreak，不会受影响。
export function splitParagraphLines(node) {
  if (node?.type.name !== 'paragraph') return null
  const lines = [[]]
  node.forEach(child => {
    if (child.type.name === 'hardBreak') lines.push([])
    else lines[lines.length - 1].push(child)
  })
  if (lines.length === 1) return null
  return lines.map(content => node.type.create(node.attrs, content, node.marks))
}

export function splitPastedParagraphs(slice) {
  const nodes = []
  let changed = false
  slice.content.forEach(node => {
    let lines = splitBlockLines(node)
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) {
      const items = []
      let split = false
      node.forEach(item => {
        const parts = splitBlockLines(item)
        split ||= Boolean(parts)
        items.push(...(parts || [item]))
      })
      if (split) lines = [node.copy(Fragment.fromArray(items))]
    }
    changed ||= Boolean(lines)
    nodes.push(...(lines || [node]))
  })
  return changed ? new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd) : slice
}

export function splitBlockLines(node) {
  if (node?.type.name === 'paragraph') return splitParagraphLines(node)
  if (!['listItem', 'taskItem'].includes(node?.type.name)) return null
  // 后续段落和嵌套列表归于原项末尾，保留它们的层级与顺序。
  const lines = splitParagraphLines(node.firstChild)
  if (!lines) return null
  const tail = []
  node.forEach((child, offset, index) => { if (index > 0) tail.push(child) })
  return lines.map((line, index) => node.type.create(
    node.attrs, index === lines.length - 1 ? [line, ...tail] : [line], node.marks,
  ))
}

export function handleExternalLineBreakPaste(view, event, slice) {
  const html = event.clipboardData?.getData('text/html') || ''
  // 编辑器内部复制保留 Shift+Enter；代码、表格等容器沿用原粘贴规则。
  if (!view.editable || !html || /\bdata-pm-slice\s*=/i.test(html)) return false
  const { $from, $to } = view.state.selection
  const canPaste = position => position.depth >= 1 && ['paragraph', 'heading'].includes(position.parent.type.name)
    && Array.from({ length: position.depth - 1 }, (_, index) => position.node(index + 1))
      .every(node => ['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'].includes(node.type.name))
  if (!canPaste($from) || !canPaste($to)) return false
  const converted = splitPastedParagraphs(slice)
  if (converted === slice) return false
  view.dispatch(view.state.tr.replaceSelection(converted).scrollIntoView())
  return true
}

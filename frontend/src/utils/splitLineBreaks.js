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
    const lines = splitParagraphLines(node)
    changed ||= Boolean(lines)
    nodes.push(...(lines || [node]))
  })
  return changed ? new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd) : slice
}

export function handleExternalLineBreakPaste(view, event, slice) {
  const html = event.clipboardData?.getData('text/html') || ''
  // 编辑器内部复制保留 Shift+Enter；代码、表格、列表等容器沿用原粘贴规则。
  if (!view.editable || !html || /\bdata-pm-slice\s*=/i.test(html)) return false
  const { $from, $to } = view.state.selection
  if ($from.depth !== 1 || $to.depth !== 1 || $from.parent.type.spec.code) return false
  const converted = splitPastedParagraphs(slice)
  if (converted === slice) return false
  view.dispatch(view.state.tr.replaceSelection(converted).scrollIntoView())
  return true
}

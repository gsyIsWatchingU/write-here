export const BLOCK_OPTIONS = [
  { type: 'paragraph', label: '正文', icon: '¶' },
  { type: 'heading-1', label: '标题 1', icon: 'H1' },
  { type: 'heading-2', label: '标题 2', icon: 'H2' },
  { type: 'heading-3', label: '标题 3', icon: 'H3' },
  { type: 'heading-4', label: '标题 4', icon: 'H4' },
  { type: 'bullet-list', label: '项目符号列表', icon: '•' },
  { type: 'ordered-list', label: '编号列表', icon: '1.' },
  { type: 'task-list', label: '待办事项', icon: '☑' },
  { type: 'blockquote', label: '引用', icon: '❞' },
  { type: 'code-block', label: '代码块', icon: '</>' },
]

export function getCurrentBlockType(editor) {
  for (let level = 1; level <= 4; level += 1) {
    if (editor.isActive('heading', { level })) return `heading-${level}`
  }
  if (editor.isActive('taskList')) return 'task-list'
  if (editor.isActive('bulletList')) return 'bullet-list'
  if (editor.isActive('orderedList')) return 'ordered-list'
  if (editor.isActive('blockquote')) return 'blockquote'
  if (editor.isActive('codeBlock')) return 'code-block'
  return 'paragraph'
}

function getSelectedTextblocks(editor) {
  const selection = editor?.state?.selection
  if (!selection || selection.empty) return []

  const blocks = []
  editor.state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (!node.isTextblock) return
    const from = position + 1
    const to = from + node.content.size
    if (Math.max(selection.from, from) >= Math.min(selection.to, to)) return

    if (node.type.name === 'heading') {
      blocks.push({ from, to, type: `heading-${node.attrs.level}` })
      return
    }
    if (node.type.name === 'codeBlock') {
      blocks.push({ from, to, type: 'code-block' })
      return
    }

    const resolved = editor.state.doc.resolve(Math.min(from, editor.state.doc.content.size))
    const ancestors = []
    for (let depth = 0; depth <= resolved.depth; depth += 1) {
      ancestors.push(resolved.node(depth).type.name)
    }
    if (ancestors.includes('taskList')) blocks.push({ from, to, type: 'task-list' })
    else if (ancestors.includes('bulletList')) blocks.push({ from, to, type: 'bullet-list' })
    else if (ancestors.includes('orderedList')) blocks.push({ from, to, type: 'ordered-list' })
    else if (ancestors.includes('blockquote')) blocks.push({ from, to, type: 'blockquote' })
    else blocks.push({ from, to, type: 'paragraph' })
  })
  return blocks
}

export function getSelectionBlockType(editor) {
  const blocks = getSelectedTextblocks(editor)
  if (blocks.length) {
    const types = new Set(blocks.map(block => block.type))
    return types.size === 1 ? [...types][0] : 'mixed'
  }
  return getCurrentBlockType(editor)
}

function unwrapCurrentList(editor, chain) {
  if (editor.isActive('taskList')) chain.toggleTaskList()
  else if (editor.isActive('bulletList')) chain.toggleBulletList()
  else if (editor.isActive('orderedList')) chain.toggleOrderedList()
  return chain
}

export function convertBlock(editor, type) {
  if (!editor?.isEditable || editor.isDestroyed) return false

  const currentType = getSelectionBlockType(editor)
  let chain = editor.chain().focus()
  const selectedBlocks = getSelectedTextblocks(editor)
  if (selectedBlocks.length) {
    chain = chain.setTextSelection({
      from: selectedBlocks[0].from,
      to: selectedBlocks[selectedBlocks.length - 1].to,
    })
  }

  if (type === 'paragraph') {
    chain = unwrapCurrentList(editor, chain)
    return chain.setParagraph().run()
  }
  if (type.startsWith('heading-')) {
    chain = unwrapCurrentList(editor, chain)
    return chain.setHeading({ level: Number(type.split('-')[1]) }).run()
  }
  if (type === 'bullet-list') {
    return currentType === 'bullet-list' || chain.toggleBulletList().run()
  }
  if (type === 'ordered-list') {
    return currentType === 'ordered-list' || chain.toggleOrderedList().run()
  }
  if (type === 'task-list') {
    return currentType === 'task-list' || chain.toggleTaskList().run()
  }
  if (type === 'blockquote') {
    chain = unwrapCurrentList(editor, chain)
    return currentType === 'blockquote' || chain.toggleBlockquote().run()
  }
  if (type === 'code-block') {
    chain = unwrapCurrentList(editor, chain)
    return chain.setCodeBlock().run()
  }

  return false
}

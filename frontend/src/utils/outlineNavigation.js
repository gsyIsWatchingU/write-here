const HEADING_TAG_NAMES = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

export function scrollToOutlineHeading(editor, position) {
  const documentSize = editor?.state?.doc?.content?.size
  if (!editor?.view || !Number.isInteger(position) || !Number.isInteger(documentSize)) return false
  if (position < 0 || position >= documentSize) return false

  const domNode = editor.view.nodeDOM(position)
  const headingElement = domNode?.nodeType === 1 ? domNode : domNode?.parentElement
  if (!HEADING_TAG_NAMES.has(headingElement?.tagName) || typeof headingElement.scrollIntoView !== 'function') {
    return false
  }

  editor.commands?.focus?.(position + 1, { scrollIntoView: false })
  headingElement.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest',
  })

  return true
}

const MARKDOWN_HEADING = /^( {0,3})(?:\\)?(#{1,6})(?=[ \t]|$)[ \t]*/

export function parseMarkdownHeading(text) {
  const opening = text.match(MARKDOWN_HEADING)
  if (!opening) return null

  const contentStart = opening[0].length
  let contentEnd = text.length

  const trailingWhitespace = text.slice(contentStart, contentEnd).match(/[ \t]+$/)
  if (trailingWhitespace) contentEnd -= trailingWhitespace[0].length

  const closingMarker = text.slice(contentStart, contentEnd).match(/[ \t]+#+$/)
  if (closingMarker) contentEnd -= closingMarker[0].length

  return {
    level: opening[2].length,
    contentStart,
    contentEnd,
  }
}

export function convertMarkdownHeadings(editor) {
  const headingType = editor?.state?.schema?.nodes?.heading
  if (!headingType || !editor.view) return 0

  const targets = []
  editor.state.doc.forEach((node, pos) => {
    const containsOnlyText = node.content.content.every(child => child.isText)
    if (node.type.name !== 'paragraph' || !containsOnlyText) return

    const heading = parseMarkdownHeading(node.textContent)
    if (heading) targets.push({ node, pos, ...heading })
  })

  if (targets.length === 0) return 0

  let transaction = editor.state.tr
  for (const target of targets.reverse()) {
    const contentStart = target.pos + 1
    transaction = transaction.setNodeMarkup(target.pos, headingType, {
      ...target.node.attrs,
      level: target.level,
    })

    if (target.contentEnd < target.node.textContent.length) {
      transaction = transaction.delete(
        contentStart + target.contentEnd,
        contentStart + target.node.textContent.length,
      )
    }
    if (target.contentStart > 0) {
      transaction = transaction.delete(contentStart, contentStart + target.contentStart)
    }
  }

  editor.view.dispatch(transaction.scrollIntoView())
  editor.view.focus()
  return targets.length
}

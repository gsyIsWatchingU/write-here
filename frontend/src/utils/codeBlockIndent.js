import { TextSelection } from '@tiptap/pm/state'

const INDENT = '  '

function getCodeBlockSelection(state) {
  const { selection } = state
  const { $from, $to } = selection

  if ($from.parent !== $to.parent || $from.parent.type.name !== 'codeBlock') {
    return null
  }

  return {
    selection,
    text: $from.parent.textContent,
    contentStart: $from.start(),
    fromOffset: $from.parentOffset,
    toOffset: $to.parentOffset,
  }
}

function getSelectedLineStarts(text, fromOffset, toOffset) {
  const firstLineStart = text.lastIndexOf('\n', fromOffset - 1) + 1
  const lastSelectedOffset = toOffset > fromOffset ? toOffset - 1 : fromOffset
  const lastLineStart = text.lastIndexOf('\n', lastSelectedOffset - 1) + 1
  const lineStarts = [firstLineStart]

  let newlineOffset = text.indexOf('\n', firstLineStart)
  while (newlineOffset !== -1 && newlineOffset + 1 <= lastLineStart) {
    lineStarts.push(newlineOffset + 1)
    newlineOffset = text.indexOf('\n', newlineOffset + 1)
  }

  return lineStarts
}

function leadingIndentLength(text, lineStart) {
  if (text[lineStart] === '\t') return 1

  let spaces = 0
  while (spaces < INDENT.length && text[lineStart + spaces] === ' ') {
    spaces += 1
  }
  return spaces
}

function keepSelection(transaction, selection) {
  const anchor = transaction.mapping.map(selection.anchor, 1)
  const head = transaction.mapping.map(selection.head, 1)
  transaction.setSelection(TextSelection.create(transaction.doc, anchor, head))
}

export function handleCodeBlockTab(view, event) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || !view.editable) {
    return false
  }

  const context = getCodeBlockSelection(view.state)
  if (!context) return false

  const {
    selection,
    text,
    contentStart,
    fromOffset,
    toOffset,
  } = context
  const transaction = view.state.tr

  if (selection.empty && !event.shiftKey) {
    transaction.insertText(INDENT, selection.from)
    view.dispatch(transaction)
    return true
  }

  const lineStarts = getSelectedLineStarts(text, fromOffset, toOffset)

  if (event.shiftKey) {
    for (const lineStart of [...lineStarts].reverse()) {
      const removeLength = leadingIndentLength(text, lineStart)
      if (removeLength > 0) {
        transaction.delete(
          contentStart + lineStart,
          contentStart + lineStart + removeLength,
        )
      }
    }

    if (transaction.docChanged) {
      keepSelection(transaction, selection)
      view.dispatch(transaction)
    }
    return true
  }

  for (const lineStart of [...lineStarts].reverse()) {
    transaction.insertText(INDENT, contentStart + lineStart)
  }
  keepSelection(transaction, selection)
  view.dispatch(transaction)
  return true
}

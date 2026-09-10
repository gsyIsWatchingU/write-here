import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const commentAnchorPluginKey = new PluginKey('commentAnchors')

function numericPosition(value) {
  const position = Number(value)
  return Number.isInteger(position) ? position : null
}

export function isAnchoredComment(comment) {
  return !comment.parentId && comment.anchorStatus !== 'none' && Boolean(comment.quoteText)
}

export function readAnchorText(doc, from, to) {
  const max = doc.content.size
  const safeFrom = Math.max(0, Math.min(numericPosition(from) ?? 0, max))
  const safeTo = Math.max(safeFrom, Math.min(numericPosition(to) ?? safeFrom, max))
  return doc.textBetween(safeFrom, safeTo, '\n', '\n').trim()
}

export function contextForRange(doc, from, to, length = 40) {
  return {
    quotePrefix: doc.textBetween(Math.max(0, from - length), from, '\n', '\n').slice(-length),
    quoteSuffix: doc.textBetween(to, Math.min(doc.content.size, to + length), '\n', '\n').slice(0, length),
  }
}

function buildTextIndex(doc) {
  let text = ''
  const positions = []
  let hasTextBlock = false

  doc.descendants((node, position) => {
    if (node.isTextblock) {
      if (hasTextBlock && text) {
        text += '\n'
        positions.push(position + 1)
      }
      hasTextBlock = true
    }
    if (!node.isText || !node.text) return
    for (let index = 0; index < node.text.length; index += 1) {
      text += node.text[index]
      positions.push(position + index)
    }
  })

  return { text, positions }
}

function contextScore(text, index, quoteLength, prefix, suffix) {
  let score = 0
  if (prefix && text.slice(Math.max(0, index - prefix.length), index) === prefix) score += 2
  if (suffix && text.slice(index + quoteLength, index + quoteLength + suffix.length) === suffix) score += 2
  return score
}

export function resolveCommentAnchor(doc, comment) {
  if (!isAnchoredComment(comment)) return comment
  const from = numericPosition(comment.anchorFrom)
  const to = numericPosition(comment.anchorTo)
  const quoteText = String(comment.quoteText || '').trim()

  if (from !== null && to !== null && from < to && readAnchorText(doc, from, to) === quoteText) {
    return { ...comment, anchorFrom: from, anchorTo: to, anchorStatus: 'active' }
  }

  const index = buildTextIndex(doc)
  const matches = []
  let cursor = index.text.indexOf(quoteText)
  while (cursor !== -1) {
    matches.push(cursor)
    cursor = index.text.indexOf(quoteText, cursor + 1)
  }
  if (!matches.length) return { ...comment, anchorStatus: 'orphaned' }

  const bestMatch = matches
    .map(match => ({
      match,
      score: contextScore(index.text, match, quoteText.length, comment.quotePrefix, comment.quoteSuffix),
    }))
    .sort((a, b) => b.score - a.score || a.match - b.match)[0].match
  const endIndex = bestMatch + quoteText.length - 1
  const relocatedFrom = index.positions[bestMatch]
  const relocatedTo = index.positions[endIndex] + 1
  if (!Number.isInteger(relocatedFrom) || !Number.isInteger(relocatedTo) || relocatedFrom >= relocatedTo) {
    return { ...comment, anchorStatus: 'orphaned' }
  }

  const context = contextForRange(doc, relocatedFrom, relocatedTo)
  return {
    ...comment,
    anchorFrom: relocatedFrom,
    anchorTo: relocatedTo,
    anchorStatus: 'active',
    ...context,
  }
}

export function mapCommentAnchor(comment, transaction) {
  if (!isAnchoredComment(comment) || comment.anchorStatus === 'orphaned') return comment
  const from = transaction.mapping.map(Number(comment.anchorFrom), 1)
  const to = transaction.mapping.map(Number(comment.anchorTo), -1)
  if (from >= to) return { ...comment, anchorFrom: from, anchorTo: from, anchorStatus: 'orphaned' }

  const quoteText = readAnchorText(transaction.doc, from, to)
  if (!quoteText) return { ...comment, anchorFrom: from, anchorTo: from, anchorStatus: 'orphaned' }
  return {
    ...comment,
    anchorFrom: from,
    anchorTo: to,
    quoteText: quoteText.slice(0, 500),
    anchorStatus: 'active',
    ...contextForRange(transaction.doc, from, to),
  }
}

function buildDecorations(doc, comments, activeCommentId, showResolved) {
  const decorations = []
  comments.forEach(comment => {
    if (!isAnchoredComment(comment) || comment.anchorStatus !== 'active') return
    if (comment.isResolved && !showResolved) return
    const from = numericPosition(comment.anchorFrom)
    const to = numericPosition(comment.anchorTo)
    if (from === null || to === null || from < 0 || to <= from || to > doc.content.size) return
    const classes = ['comment-anchor']
    if (Number(activeCommentId) === Number(comment.id)) classes.push('is-active')
    if (comment.isResolved) classes.push('is-resolved')
    decorations.push(Decoration.inline(from, to, {
      class: classes.join(' '),
      'data-comment-anchor-id': String(comment.id),
      role: 'button',
      tabindex: '0',
      'aria-label': '查看划词评论',
    }))
  })
  return DecorationSet.create(doc, decorations)
}

export function createCommentAnchorPlugin(onSelect) {
  return new Plugin({
    key: commentAnchorPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, current) {
        const next = transaction.getMeta(commentAnchorPluginKey)
        if (next) return buildDecorations(transaction.doc, next.comments, next.activeCommentId, next.showResolved)
        return current.map(transaction.mapping, transaction.doc)
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
      handleDOMEvents: {
        click(_view, event) {
          const anchor = event.target instanceof Element
            ? event.target.closest('[data-comment-anchor-id]')
            : null
          if (!anchor) return false
          onSelect?.(Number(anchor.dataset.commentAnchorId))
          return true
        },
        keydown(_view, event) {
          if (event.key !== 'Enter') return false
          const anchor = event.target instanceof Element
            ? event.target.closest('[data-comment-anchor-id]')
            : null
          if (!anchor) return false
          onSelect?.(Number(anchor.dataset.commentAnchorId))
          return true
        },
      },
    },
  })
}

export function refreshCommentDecorations(editor, comments, activeCommentId, showResolved) {
  if (!editor?.view || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(commentAnchorPluginKey, {
    comments,
    activeCommentId,
    showResolved,
  }))
}


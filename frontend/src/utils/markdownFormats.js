import { Fragment } from '@tiptap/pm/model'
import MarkdownIt from 'markdown-it'
import { parseMarkdownHeading } from './markdownHeadings.js'

// 把正文中未渲染的 Markdown 块级标记（标题、引用、分割线、列表、任务列表、
// 表格、代码围栏）识别并渲染为对应格式；内容中的行内标记（**粗体**、`行内代码`、
// ~~删除线~~、[链接](url)）也一并渲染。仅处理“纯文本段落”，已有格式的块不动。
//
// 与 Markdown 导入/AI 润色共用 markdown-it 语义：行首标记允许被「\」转义，
// 表格为 GitHub 风格管道表格，任务列表与 @tiptap/extension-task-list 的
// parseHTML 约定一致（li[data-type=taskItem][data-checked]）。

const MARKDOWN_IT_OPTIONS = { html: false, linkify: true }

const BLOCKQUOTE = /^( {0,3})(?:\\)?>([ \t]?)/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const BULLET = /^( {0,3})(?:\\)?([-*+])([ \t]+)/
const ORDERED = /^( {0,3})(?:\\)?(\d{1,9})([.)])([ \t]+)/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})/
const TASK = /^\[([ xX])\][ \t]*/
const SEPARATOR_CELL = /^:?-+:?$/
// 触发行内重渲染的标记：**、~~、`、[text](url)
const INLINE_MD = /(\*\*|~~|`|\[[^\]]*\]\()/

function containsOnlyText(node) {
  return node.content.content.every((child) => child.isText)
}

function createParser() {
  return new MarkdownIt(MARKDOWN_IT_OPTIONS)
}

// 把 Fragment 的 [from, to) 字符区间切出来，保留原有行内 marks。
function sliceInlineFragment(fragment, from, to) {
  const nodes = []
  let offset = 0
  for (const child of fragment.content) {
    const childStart = offset
    const childEnd = offset + child.textContent.length
    offset = childEnd
    if (to <= childStart || from >= childEnd) continue

    const localFrom = Math.max(0, from - childStart)
    const localTo = Math.min(child.textContent.length, to - childStart)
    if (child.isText) {
      const sliced = child.cut(localFrom, localTo)
      if (sliced.text) nodes.push(sliced)
    }
  }
  return Fragment.fromArray(nodes)
}

// 用 markdown-it 的 inline token 流构造 ProseMirror inline content，
// 不依赖浏览器 DOM，Node 环境下同样可用。
function renderInlineContent(schema, md, text) {
  const tokens = md.parseInline(text, {})
  const inlineToken = tokens.find((token) => token.type === 'inline')
  const children = inlineToken ? inlineToken.children : []
  const nodes = []
  const marks = []

  const markByName = (names) => {
    for (const name of names) {
      if (schema.marks[name]) return schema.marks[name].create()
    }
    return null
  }
  const popMark = () => {
    if (marks.length) marks.pop()
  }

  for (const token of children) {
    switch (token.type) {
      case 'text':
        if (token.content) {
          nodes.push(schema.text(token.content, marks.length ? marks.slice() : null))
        }
        break
      case 'code_inline': {
        const code = markByName(['code'])
        nodes.push(schema.text(token.content, code ? [code] : null))
        break
      }
      case 'strong_open': {
        // TipTap 的加粗 mark 名为 bold（测试 schema 兼容 strong）
        const mark = markByName(['bold', 'strong'])
        if (mark) marks.push(mark)
        break
      }
      case 'strong_close': popMark(); break
      case 'em_open': {
        // TipTap 的斜体 mark 名为 italic（测试 schema 兼容 em）
        const mark = markByName(['italic', 'em'])
        if (mark) marks.push(mark)
        break
      }
      case 'em_close': popMark(); break
      case 's_open': {
        const mark = markByName(['strike'])
        if (mark) marks.push(mark)
        break
      }
      case 's_close': popMark(); break
      case 'link_open': {
        const mark = schema.marks.link ? schema.marks.link.create({ href: token.attrGet('href') || '' }) : null
        if (mark) marks.push(mark)
        break
      }
      case 'link_close': popMark(); break
      case 'softbreak':
      case 'hardbreak':
        nodes.push(schema.text('\n'))
        break
      default:
        break
    }
  }

  return Fragment.fromArray(nodes)
}

// 取段落 [from, to) 内容：含行内标记时用 markdown-it 重新渲染，
// 否则保留原内容（marks 不丢失）。
function contentFor(schema, md, node, from, to) {
  if (from < 0 || to < from) return Fragment.empty
  const text = node.textContent.slice(from, to)
  if (!text) return Fragment.empty
  if (INLINE_MD.test(text)) return renderInlineContent(schema, md, text)
  return sliceInlineFragment(node.content, from, to)
}

// 解析 GitHub 风格表格行，返回带字符偏移的单元格列表；不是表格行返回 null。
// 单元格偏移已映射到段落的 textContent。
function parseTableRow(text) {
  const trimmed = text.trim()
  if (!trimmed.includes('|')) return null
  const textLeading = text.length - text.trimStart().length

  let start = 0
  let end = trimmed.length
  if (trimmed.startsWith('|')) start = 1
  if (trimmed.endsWith('|')) end = trimmed.length - 1
  if (start >= end) return null

  const parts = trimmed.slice(start, end).split('|')
  if (parts.length < 2) return null

  const cells = []
  let offset = start
  for (const part of parts) {
    const from = offset + textLeading
    const to = offset + part.length + textLeading
    const leading = part.length - part.trimStart().length
    const trailing = part.length - part.trimEnd().length
    cells.push({
      text: part.trim(),
      from: from + leading,
      to: to - trailing,
    })
    offset += part.length + 1
  }
  return cells
}

function isSeparatorRow(cells) {
  return cells.every((cell) => SEPARATOR_CELL.test(cell.text))
}

// 分隔行允许省略首尾「|」，如 `---`，因此先用 parseTableRow 判断（需要含 |），
// 再单独处理无竖线的纯分隔行。
function isSeparatorText(text) {
  const trimmed = text.trim()
  if (!trimmed.includes('-')) return false
  if (trimmed.includes('|')) return isSeparatorRow(parseTableRow(text))
  return SEPARATOR_CELL.test(trimmed)
}

function normalizeCells(cells, count) {
  if (cells.length === count) return cells
  if (cells.length > count) return cells.slice(0, count)
  const padded = cells.slice()
  while (padded.length < count) {
    padded.push({ text: '', from: -1, to: -1 })
  }
  return padded
}

// ---------- 构造替换节点 ----------

function buildHeading(schema, md, group) {
  const node = group.node
  return schema.nodes.heading.create(
    { ...node.attrs, level: group.level },
    contentFor(schema, md, node, group.contentStart, group.contentEnd),
  )
}

function buildBlockquote(schema, md, group) {
  const paragraphs = group.entries.map((entry) => (
    schema.nodes.paragraph.create(
      null,
      contentFor(schema, md, entry.node, entry.contentStart, entry.node.textContent.length),
    )
  ))
  return schema.nodes.blockquote.create(null, paragraphs)
}

function buildList(schema, md, group) {
  const items = group.entries.map((entry) => {
    const content = [
      schema.nodes.paragraph.create(
        null,
        contentFor(schema, md, entry.node, entry.contentStart, entry.node.textContent.length),
      ),
    ]
    if (group.type === 'taskList') {
      return schema.nodes.taskItem.create({ checked: Boolean(entry.checked) }, content)
    }
    return schema.nodes.listItem.create(null, content)
  })

  if (group.type === 'taskList') return schema.nodes.taskList.create(null, items)
  return schema.nodes[group.type].create(null, items)
}

function buildTable(schema, md, group) {
  const rowType = schema.nodes.tableRow
  const headerType = schema.nodes.tableHeader
  const cellType = schema.nodes.tableCell
  const paragraph = (content) => schema.nodes.paragraph.create(null, content)

  const rows = group.rows.map((row, index) => {
    const type = index === 0 ? headerType : cellType
    const cells = row.cells.map((cell) => (
      type.create(null, [paragraph(contentFor(schema, md, row.node, cell.from, cell.to))])
    ))
    return rowType.create(null, cells)
  })
  return schema.nodes.table.create(null, rows)
}

function buildCodeBlock(schema, group) {
  const text = group.lines.join('\n')
  return schema.nodes.codeBlock.create(
    { language: group.language || null },
    text ? schema.text(text) : null,
  )
}

function buildNode(schema, md, group) {
  switch (group.type) {
    case 'heading': return buildHeading(schema, md, group)
    case 'blockquote': return buildBlockquote(schema, md, group)
    case 'bulletList':
    case 'orderedList':
    case 'taskList': return buildList(schema, md, group)
    case 'table': return buildTable(schema, md, group)
    case 'codeBlock': return buildCodeBlock(schema, group)
    case 'hr': return schema.nodes.horizontalRule.create()
    default: return null
  }
}

// ---------- 主入口 ----------

export function convertMarkdownFormats(editor, md) {
  const schema = editor?.state?.schema
  if (!schema || !editor?.view) return 0
  const parser = md || createParser()

  const blocks = []
  editor.state.doc.forEach((node, pos) => blocks.push({ node, pos }))

  const groups = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.node.type.name !== 'paragraph' || !containsOnlyText(block.node)) {
      i += 1
      continue
    }
    const text = block.node.textContent

    // 代码围栏：从起始行收集内容直到闭合围栏
    const fence = text.match(FENCE)
    if (fence) {
      const marker = fence[1]
      const language = (fence[2] || '').trim()
      const lines = []
      let end = i
      while (end + 1 < blocks.length) {
        const next = blocks[end + 1]
        if (next.node.type.name !== 'paragraph' || !containsOnlyText(next.node)) break
        const nextText = next.node.textContent
        const close = nextText.match(FENCE_CLOSE)
        if (
          close
          && close[1][0] === marker[0]
          && close[1].length >= marker.length
          && /^[ \t]*$/.test(nextText.slice(close[0].length))
        ) {
          end += 1
          break
        }
        lines.push(nextText)
        end += 1
      }
      groups.push({ type: 'codeBlock', start: i, end, language, lines })
      i = end + 1
      continue
    }

    // 表格：表头行 + 紧邻的分隔行
    if (i + 1 < blocks.length) {
      const headerCells = parseTableRow(text)
      const nextBlock = blocks[i + 1]
      if (
        headerCells
        && nextBlock.node.type.name === 'paragraph'
        && containsOnlyText(nextBlock.node)
        && isSeparatorText(nextBlock.node.textContent)
      ) {
        const rows = [{ node: block.node, cells: headerCells }]
        let end = i + 1
        while (end + 1 < blocks.length) {
          const next = blocks[end + 1]
          if (next.node.type.name !== 'paragraph' || !containsOnlyText(next.node)) break
          const cells = parseTableRow(next.node.textContent)
          if (!cells) break
          rows.push({ node: next.node, cells: normalizeCells(cells, headerCells.length) })
          end += 1
        }
        groups.push({ type: 'table', start: i, end, rows })
        i = end + 1
        continue
      }
    }

    // 分割线
    if (HR.test(text)) {
      groups.push({ type: 'hr', start: i, end: i })
      i += 1
      continue
    }

    // 标题
    const heading = parseMarkdownHeading(text)
    if (heading) {
      groups.push({ type: 'heading', start: i, end: i, node: block.node, ...heading })
      i += 1
      continue
    }

    // 引用
    const quote = text.match(BLOCKQUOTE)
    if (quote) {
      const entries = []
      let end = i
      while (end < blocks.length) {
        const cur = blocks[end]
        if (cur.node.type.name !== 'paragraph' || !containsOnlyText(cur.node)) break
        const match = cur.node.textContent.match(BLOCKQUOTE)
        if (!match) break
        entries.push({ node: cur.node, contentStart: match[0].length })
        end += 1
      }
      groups.push({ type: 'blockquote', start: i, end: end - 1, entries })
      i = end
      continue
    }

    // 列表（无序 / 有序 / 任务）
    const bullet = text.match(BULLET)
    const ordered = text.match(ORDERED)
    if (bullet || ordered) {
      const kind = bullet ? 'bullet' : 'ordered'
      const bulletMarker = bullet ? bullet[2] : null
      const entries = []
      let end = i
      while (end < blocks.length) {
        const cur = blocks[end]
        if (cur.node.type.name !== 'paragraph' || !containsOnlyText(cur.node)) break
        const curText = cur.node.textContent
        const curBullet = curText.match(BULLET)
        const curOrdered = curText.match(ORDERED)
        if (kind === 'bullet') {
          if (!curBullet || (bulletMarker !== null && curBullet[2] !== bulletMarker)) break
        } else if (!curOrdered) {
          break
        }

        const match = kind === 'bullet' ? curBullet : curOrdered
        let contentStart = match[0].length
        let checked
        if (kind === 'bullet') {
          const task = curText.slice(match[0].length).match(TASK)
          if (task) {
            checked = /[xX]/.test(task[1])
            contentStart += task[0].length
          }
        }
        entries.push({ node: cur.node, contentStart, checked })
        end += 1
      }

      const type = kind === 'bullet'
        ? (entries.some((entry) => entry.checked !== undefined) ? 'taskList' : 'bulletList')
        : 'orderedList'
      groups.push({ type, start: i, end: end - 1, entries })
      i = end
      continue
    }

    i += 1
  }

  if (groups.length === 0) return 0

  let transaction = editor.state.tr
  for (const group of groups.reverse()) {
    const startPos = blocks[group.start].pos
    const endBlock = blocks[group.end]
    const endPos = endBlock.pos + endBlock.node.nodeSize
    const node = buildNode(schema, parser, group)
    if (node) transaction = transaction.replaceWith(startPos, endPos, node)
  }

  editor.view.dispatch(transaction.scrollIntoView())
  editor.view.focus()
  return groups.length
}

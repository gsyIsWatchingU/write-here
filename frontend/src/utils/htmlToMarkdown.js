import TurndownService from 'turndown'

// 编辑器正文（TipTap HTML）转 Markdown，用于把整篇文档交给 AI 润色。
// 代码块语言、表格与任务列表单独处理，保证结构与编辑器内一致。
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  bulletListMarker: '-',
  hr: '---',
  blankReplacement: (content, node) => {
    if (node.nodeName === 'BR') return '  \n'
    return node.isBlock ? '\n\n' : ''
  },
})

// 表格 → GitHub 风格管道表格（turndown 默认不支持表格）。
turndown.addRule('table', {
  filter: 'table',
  replacement: (content, node) => {
    const rows = Array.from(node.querySelectorAll('tr'))
    if (rows.length === 0) return ''

    const parseRow = (tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => {
      const text = (cell.textContent || '').trim().replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ')
      return text
    })

    const firstIsHeader = Boolean(rows[0].querySelector('th'))
    const header = parseRow(rows[0])
    const body = (firstIsHeader ? rows.slice(1) : rows).map(parseRow)
    const columnCount = Math.max(header.length, ...body.map((row) => row.length))
    const widths = Array.from({ length: columnCount }, (_, i) => Math.max(
      header[i]?.length || 0,
      3,
      ...body.map((row) => (row[i] || '').length)
    ))

    const formatRow = (row) => `| ${widths.map((width, i) => (row[i] || '').padEnd(width)).join(' | ')} |`
    const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
    return `\n\n${formatRow(header)}\n${separator}\n${body.map(formatRow).join('\n')}\n\n`
  },
})

// 任务列表 → "- [x] / - [ ]"
turndown.addRule('taskListItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = node.getAttribute('data-checked') === 'true'
    const body = content.replace(/^\s+/, '').replace(/\s+$/, '')
    // 行首换行由 turndown 负责块级拼接，保证相邻任务项各占一行
    return `\n- [${checked ? 'x' : ' '}] ${body}`
  },
})

// 高亮标记 → ==文字==（markdown-it 未启用该语法时按普通文字保留，不丢失内容）
turndown.addRule('highlight', {
  filter: 'mark',
  replacement: (content) => `==${content}==`,
})

export function htmlToMarkdown(html) {
  return turndown.turndown(html || '')
}

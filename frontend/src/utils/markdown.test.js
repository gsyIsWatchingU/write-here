import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { normalizeImportedMarkdown } from './markdown.js'

const parser = new MarkdownIt({ html: false, linkify: true })

test('还原被转义的标题、引用和列表标记', () => {
  const source = [
    '\\## 1. NC 是什么？',
    '',
    '\\> 回答方式：先说结论。',
    '',
    '1\\. 锁：唯一标识。',
    '2\\) 并发：来自压测。',
    '',
    '\\- 补偿与对账。',
  ].join('\n')

  const html = parser.render(normalizeImportedMarkdown(source))

  assert.match(html, /<h2>1\. NC 是什么？<\/h2>/)
  assert.match(html, /<blockquote>/)
  assert.match(html, /<ol>/)
  assert.match(html, /<ul>/)
})

test('保留正文和代码围栏里的转义标记', () => {
  const source = [
    '正文中的 \\# 仍然是井号。',
    '',
    '```md',
    '\\## 代码示例',
    '1\\. 代码示例',
    '```',
  ].join('\n')

  const normalized = normalizeImportedMarkdown(source)

  assert.match(normalized, /正文中的 \\# 仍然是井号。/)
  assert.match(normalized, /```md\n\\## 代码示例\n1\\\. 代码示例\n```/)
})

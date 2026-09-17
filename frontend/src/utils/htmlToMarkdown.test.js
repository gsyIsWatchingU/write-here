import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { htmlToMarkdown } from './htmlToMarkdown.js'
import { markdownTaskListPlugin } from './markdownTasks.js'

const parser = new MarkdownIt({ html: false, linkify: true }).use(markdownTaskListPlugin)

test('htmlToMarkdown 转换标题、段落与行内格式', () => {
  const html = '<h1>一级标题</h1><p>普通段落，包含 <strong>粗体</strong>、<em>斜体</em> 和 <a href="https://example.com">链接</a>。</p><h2>二级标题</h2>'
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /^# 一级标题/)
  assert.match(markdown, /## 二级标题/)
  assert.match(markdown, /\*\*粗体\*\*/)
  assert.match(markdown, /\*斜体\*/)
  assert.match(markdown, /\[链接\]\(https:\/\/example\.com\)/)
})

test('htmlToMarkdown 保留代码块语言围栏', () => {
  const html = '<pre><code class="language-javascript">const answer = 42;\nconsole.log(answer);</code></pre>'
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /```javascript/)
  assert.match(markdown, /const answer = 42;/)
  assert.match(markdown, /```$/)
})

test('htmlToMarkdown 表格转换为管道表格', () => {
  const html = [
    '<table><tbody>',
    '<tr><th>名称</th><th>说明</th></tr>',
    '<tr><td>HashMap</td><td>哈希表</td></tr>',
    '<tr><td>ArrayList</td><td>动态数组</td></tr>',
    '</tbody></table>',
  ].join('')
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /\| 名称\s+\| 说明\s+\|/)
  assert.match(markdown, /\| ---+ \| ---+ \|/)
  assert.match(markdown, /\| HashMap\s+\| 哈希表\s+\|/)
  assert.match(markdown, /\| ArrayList\s+\| 动态数组\s+\|/)
})

test('htmlToMarkdown 任务列表输出勾选标记，且可被 markdown-it 还原为任务列表', () => {
  const html = [
    '<ul data-type="taskList">',
    '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>已完成项</p></div></li>',
    '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>待办项</p></div></li>',
    '</ul>',
  ].join('')
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /- \[x\] 已完成项/)
  assert.match(markdown, /- \[ \] 待办项/)

  const rendered = parser.render(markdown)
  assert.match(rendered, /<ul data-type="taskList">/)
  assert.match(rendered, /data-type="taskItem" data-checked="true">已完成项/)
  assert.match(rendered, /data-type="taskItem" data-checked="false">待办项/)
})

test('htmlToMarkdown 保留图片、引用与无序列表', () => {
  const html = [
    '<p>正文前</p>',
    '<blockquote><p>引用内容</p></blockquote>',
    '<ul><li>条目一</li><li>条目二</li></ul>',
    '<p><img src="https://example.com/a.png" alt="示意图"></p>',
  ].join('')
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /> 引用内容/)
  assert.match(markdown, /- +条目一/)
  assert.match(markdown, /- +条目二/)
  assert.match(markdown, /!\[示意图\]\(https:\/\/example\.com\/a\.png\)/)
})

test('htmlToMarkdown 空输入返回空字符串', () => {
  assert.equal(htmlToMarkdown(''), '')
  assert.equal(htmlToMarkdown('<p></p>'), '')
})

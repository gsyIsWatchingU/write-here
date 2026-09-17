import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownTaskListPlugin } from './markdownTasks.js'

const parser = new MarkdownIt({ html: false, linkify: true }).use(markdownTaskListPlugin)

test('勾选与未勾选任务列表渲染为 taskList / taskItem', () => {
  const html = parser.render('- [x] 已完成\n- [ ] 待办')
  assert.match(html, /<ul data-type="taskList">/)
  assert.match(html, /<li data-type="taskItem" data-checked="true">已完成<\/li>/)
  assert.match(html, /<li data-type="taskItem" data-checked="false">待办<\/li>/)
})

test('普通列表不受插件影响', () => {
  const html = parser.render('- 普通条目\n- 另一条')
  assert.ok(!html.includes('data-type="taskList"'))
  assert.match(html, /<ul>/)
  assert.match(html, /<li>普通条目<\/li>/)
})

test('任务列表与其他列表混合时只标记含勾选的列表', () => {
  const html = parser.render('普通列表：\n- a\n\n任务列表：\n- [x] b\n- [ ] c')
  const taskLists = html.match(/data-type="taskList"/g) || []
  assert.equal(taskLists.length, 1)
  assert.match(html, /<li>a<\/li>/)
})

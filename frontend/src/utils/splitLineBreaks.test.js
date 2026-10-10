import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema, Slice, Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { handleExternalLineBreakPaste, splitBlockLines, splitParagraphLines, splitPastedParagraphs } from './splitLineBreaks.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', attrs: { textAlign: { default: null } } },
    hardBreak: { inline: true, group: 'inline' },
    codeBlock: { content: 'text*', group: 'block', code: true },
    blockquote: { content: 'block+', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block', attrs: { start: { default: 1 } } },
    listItem: { content: 'paragraph block*' },
    taskList: { content: 'taskItem+', group: 'block' },
    taskItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
    text: { group: 'inline' },
  },
  marks: { bold: {}, link: { attrs: { href: {} } } },
})

test('GPT 列表显式换行拆成独立项，保留格式、序号、后续段落和嵌套结构', () => {
  const nested = schema.node('bulletList', null, schema.node('listItem', null, p(text('子项'))))
  const item = schema.node('listItem', null, [p([
    schema.text('问题', [schema.mark('bold')]), br(),
    schema.text('回答', [schema.mark('link', { href: 'https://example.com' })]),
  ]), p(text('补充')), nested])
  const original = schema.node('orderedList', { start: 4 }, [item, schema.node('listItem', null, p(text('另一项')))])
  const converted = splitPastedParagraphs(new Slice(Fragment.from(original), 0, 0)).content.firstChild
  assert.equal(converted.attrs.start, 4)
  assert.deepEqual(converted.content.content.map(node => node.textContent), ['问题', '回答补充子项', '另一项'])
  assert.equal(converted.firstChild.firstChild.firstChild.marks[0].type.name, 'bold')
  assert.equal(converted.child(1).firstChild.firstChild.marks[0].attrs.href, 'https://example.com')
  assert.ok(converted.child(1).lastChild.eq(nested))
  assert.equal(splitBlockLines(schema.node('taskItem', { checked: true }, p([text('甲'), br(), text('乙')])))[1].attrs.checked, true)
})
const br = () => schema.node('hardBreak')
const p = content => schema.node('paragraph', null, content)
const text = value => schema.text(value)

test('显式换行拆块，粗体、链接、段落对齐与空行保留', () => {
  const node = schema.node('paragraph', { textAlign: 'center' }, [
    schema.text('第一项', [schema.mark('bold')]), br(), br(),
    schema.text('第二项', [schema.mark('link', { href: 'https://example.com' })]), br(),
  ])
  const lines = splitParagraphLines(node)
  assert.deepEqual(lines.map(line => line.textContent), ['第一项', '', '第二项', ''])
  assert.ok(lines.every(line => line.attrs.textAlign === 'center'))
  assert.equal(lines[0].firstChild.marks[0].type.name, 'bold')
  assert.equal(lines[2].firstChild.marks[0].attrs.href, 'https://example.com')
})

test('没有显式换行的长段落不拆，代码与引用保持原结构', () => {
  assert.equal(splitParagraphLines(p(text('长文字'.repeat(100)))), null)
  assert.equal(splitParagraphLines(schema.node('codeBlock', null, text('a\nb'))), null)
  const quote = schema.node('blockquote', null, p([text('a'), br(), text('b')]))
  const slice = new Slice(Fragment.from(quote), 0, 0)
  assert.equal(splitPastedParagraphs(slice), slice)
})

function viewFor(node = p(text('前后')), depth = 1) {
  const doc = schema.node('doc', null, node)
  const pos = depth === 1 ? 2 : 3
  const view = {
    editable: true,
    state: EditorState.create({ doc, selection: TextSelection.create(doc, pos) }),
    dispatch(tr) { this.state = this.state.apply(tr) },
  }
  return view
}
const eventFor = html => ({ clipboardData: { getData: () => html } })
const pasted = () => new Slice(Fragment.from(p([text('甲'), br(), text('乙')])), 1, 1)

test('外部 HTML 粘贴在光标处拆段并保留前后文字', () => {
  const view = viewFor()
  assert.equal(handleExternalLineBreakPaste(view, eventFor('<p>甲<br>乙</p>'), pasted()), true)
  assert.deepEqual(view.state.doc.content.content.map(node => node.textContent), ['前甲', '乙后'])
})

test('粘贴覆盖跨段选区时拆段，不丢选区外内容', () => {
  const view = viewFor([p(text('前中')), p(text('中后'))])
  view.state = view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 6)))
  handleExternalLineBreakPaste(view, eventFor('<p>甲<br>乙</p>'), pasted())
  assert.deepEqual(view.state.doc.content.content.map(node => node.textContent), ['前甲', '乙后'])
})

test('编辑器内部复制的软换行与纯文本粘贴保持原行为', () => {
  const view = viewFor()
  assert.equal(handleExternalLineBreakPaste(view, eventFor('<p data-pm-slice="1 1 []">甲<br>乙</p>'), pasted()), false)
  assert.equal(handleExternalLineBreakPaste(view, eventFor(''), pasted()), false)
})

test('列表光标处粘贴显式换行拆段，不吞掉当前项前后文字', () => {
  const doc = schema.node('doc', null, schema.node('bulletList', null,
    schema.node('listItem', null, p(text('前后')))))
  const view = {
    editable: true,
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 4) }),
    dispatch(tr) { this.state = this.state.apply(tr) },
  }
  assert.equal(handleExternalLineBreakPaste(view, eventFor('<p>甲<br>乙</p>'), pasted()), true)
  assert.equal(view.state.doc.textContent, '前甲乙后')
  assert.equal(view.state.doc.firstChild.firstChild.childCount, 2)
})

test('只读、代码块、嵌套容器不自动拆段', () => {
  const event = eventFor('<p>甲<br>乙</p>')
  const readonly = viewFor()
  readonly.editable = false
  assert.equal(handleExternalLineBreakPaste(readonly, event, pasted()), false)
  assert.equal(handleExternalLineBreakPaste(viewFor(schema.node('codeBlock', null, text('code'))), event, pasted()), false)
  assert.equal(handleExternalLineBreakPaste(viewFor(schema.node('blockquote', null, p(text('引用'))), 2), event, pasted()), false)
})

test('旧内容整块修复可经事务序列化回读，前后块不变', () => {
  const view = viewFor([p(text('前')), p([text('甲'), br(), text('乙')]), p(text('后'))])
  const old = view.state.doc.child(1)
  view.dispatch(view.state.tr.replaceWith(3, 3 + old.nodeSize, splitParagraphLines(old)))
  const restored = schema.nodeFromJSON(view.state.doc.toJSON())
  assert.deepEqual(restored.content.content.map(node => node.textContent), ['前', '甲', '乙', '后'])
})

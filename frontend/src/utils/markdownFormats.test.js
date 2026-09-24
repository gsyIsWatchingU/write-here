import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { convertMarkdownFormats } from './markdownFormats.js'

const md = new MarkdownIt({ html: false, linkify: true })

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }] },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
    },
    blockquote: { content: 'block+', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*', group: 'block' },
    taskList: { content: 'taskItem+', group: 'block' },
    taskItem: {
      attrs: { checked: { default: false } },
      content: 'paragraph block*',
      group: 'block',
    },
    codeBlock: {
      attrs: { language: { default: null } },
      content: 'text*',
      group: 'block',
      code: true,
    },
    horizontalRule: { group: 'block' },
    table: { content: 'tableRow+', group: 'block' },
    tableRow: { content: 'tableCell+', group: 'block' },
    tableCell: { content: 'block+', group: 'block' },
    tableHeader: { content: 'block+', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: 'strong' }],
      toDOM: () => ['strong', 0],
    },
    em: {},
    strike: {},
    code: {},
    link: { attrs: { href: { default: null } } },
  },
})

function paragraph(text, markedText = '') {
  const content = [schema.text(text)]
  if (markedText) content.push(schema.text(markedText, [schema.marks.strong.create()]))
  return schema.nodes.paragraph.create(null, content)
}

function codeBlock(language, text) {
  return schema.nodes.codeBlock.create({ language }, schema.text(text))
}

function createEditor(doc) {
  let state = EditorState.create({ schema, doc })
  const editor = {
    get state() {
      return state
    },
    view: {
      dispatch(transaction) {
        state = state.apply(transaction)
      },
      focus() {},
    },
  }
  return editor
}

test('连续引用行合并为 blockquote 且保留内容', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('> 第一行'),
    paragraph('> 第二行'),
    paragraph('普通段落'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [quote, rest] = editor.state.doc.content.content
  assert.equal(quote.type.name, 'blockquote')
  assert.equal(quote.childCount, 2)
  assert.equal(quote.child(0).textContent, '第一行')
  assert.equal(quote.child(1).textContent, '第二行')
  assert.equal(rest.type.name, 'paragraph')
  assert.equal(rest.textContent, '普通段落')
})

test('--- 单独一行渲染为分割线', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('上方文字'),
    paragraph('---'),
    paragraph('下方文字'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [up, hr, down] = editor.state.doc.content.content
  assert.equal(up.textContent, '上方文字')
  assert.equal(hr.type.name, 'horizontalRule')
  assert.equal(down.textContent, '下方文字')
})

test('连续无序列表行合并为 bulletList', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('- 苹果'),
    paragraph('- 香蕉'),
    paragraph('- 橙子'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [list] = editor.state.doc.content.content
  assert.equal(list.type.name, 'bulletList')
  assert.equal(list.childCount, 3)
  assert.equal(list.child(0).textContent, '苹果')
  assert.equal(list.child(1).textContent, '香蕉')
  assert.equal(list.child(2).textContent, '橙子')
})

test('连续有序列表行合并为 orderedList', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('1. 第一步'),
    paragraph('2. 第二步'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [list] = editor.state.doc.content.content
  assert.equal(list.type.name, 'orderedList')
  assert.equal(list.childCount, 2)
  assert.equal(list.child(0).textContent, '第一步')
  assert.equal(list.child(1).textContent, '第二步')
})

test('- [x] / - [ ] 渲染为任务列表并保留勾选状态', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('- [x] 已完成'),
    paragraph('- [ ] 待处理'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [list] = editor.state.doc.content.content
  assert.equal(list.type.name, 'taskList')
  assert.equal(list.childCount, 2)
  assert.equal(list.child(0).attrs.checked, true)
  assert.equal(list.child(0).textContent, '已完成')
  assert.equal(list.child(1).attrs.checked, false)
  assert.equal(list.child(1).textContent, '待处理')
})

test('GFM 表格渲染为 table（表头行 + 数据行）', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('| 名称 | 数量 |'),
    paragraph('| --- | --- |'),
    paragraph('| 苹果 | 3 |'),
    paragraph('| 香蕉 | 5 |'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [table] = editor.state.doc.content.content
  assert.equal(table.type.name, 'table')
  assert.equal(table.childCount, 3)

  const [header, first, second] = table.content.content
  assert.equal(header.type.name, 'tableRow')
  assert.equal(header.child(0).type.name, 'tableHeader')
  assert.equal(header.child(0).textContent, '名称')
  assert.equal(header.child(1).textContent, '数量')
  assert.equal(first.child(0).type.name, 'tableCell')
  assert.equal(first.child(0).textContent, '苹果')
  assert.equal(second.child(1).textContent, '5')
})

test('表格分隔行可省略竖线（---）', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('| 甲 | 乙 |'),
    paragraph('---'),
    paragraph('| 1 | 2 |'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [table] = editor.state.doc.content.content
  assert.equal(table.type.name, 'table')
  assert.equal(table.childCount, 2)
  assert.equal(table.child(1).child(0).textContent, '1')
})

test('代码围栏渲染为 codeBlock 并保留语言', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('```js'),
    paragraph('console.log(1)'),
    paragraph('```'),
    paragraph('后续段落'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [code, rest] = editor.state.doc.content.content
  assert.equal(code.type.name, 'codeBlock')
  assert.equal(code.attrs.language, 'js')
  assert.equal(code.textContent, 'console.log(1)')
  assert.equal(rest.textContent, '后续段落')
})

test('列表项内的行内标记被渲染', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('- **加粗** 项'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [list] = editor.state.doc.content.content
  const itemParagraph = list.child(0).child(0)
  const [strong, tail] = itemParagraph.content.content
  assert.equal(strong.type.name, 'text')
  assert.equal(strong.text, '加粗')
  assert.equal(strong.marks[0].type.name, 'strong')
  assert.equal(tail.text, ' 项')
})

test('行内链接、删除线、斜体与行内代码被渲染', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('- 访问 [官网](https://example.com)，~~旧版~~，*斜体*，`代码`'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [list] = editor.state.doc.content.content
  const itemParagraph = list.child(0).child(0)
  const marksOf = (index) => itemParagraph.content.content[index].marks.map((m) => m.type.name)
  const textOf = (index) => itemParagraph.content.content[index].text

  assert.equal(textOf(0), '访问 ')
  assert.deepEqual(marksOf(0), [])
  assert.equal(textOf(1), '官网')
  assert.deepEqual(marksOf(1), ['link'])
  assert.equal(itemParagraph.content.content[1].marks[0].attrs.href, 'https://example.com')
  assert.equal(textOf(2), '，')
  assert.equal(textOf(3), '旧版')
  assert.deepEqual(marksOf(3), ['strike'])
  assert.equal(textOf(5), '斜体')
  assert.deepEqual(marksOf(5), ['em'])
  assert.equal(textOf(7), '代码')
  assert.deepEqual(marksOf(7), ['code'])
})

test('标题转换保留原有行内 marks', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('## ', '加粗标题'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 1)

  const [heading] = editor.state.doc.content.content
  assert.equal(heading.type.name, 'heading')
  assert.equal(heading.attrs.level, 2)
  assert.equal(heading.textContent, '加粗标题')
  assert.equal(heading.firstChild.marks[0].type.name, 'strong')
})

test('普通文本、无空格标题与已有格式块不转换', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('#没有空格，不转换'),
    codeBlock('js', '## 代码里的标题'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 0)
  const [first, second] = editor.state.doc.content.content
  assert.equal(first.type.name, 'paragraph')
  assert.equal(second.type.name, 'codeBlock')
})

test('空段落会打断连续块组', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('> 第一段引用'),
    schema.nodes.paragraph.create(),
    paragraph('> 第二段引用'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 2)

  const [one, blank, two] = editor.state.doc.content.content
  assert.equal(one.type.name, 'blockquote')
  assert.equal(blank.type.name, 'paragraph')
  assert.equal(two.type.name, 'blockquote')
})

test('混合 Markdown 一次性渲染并计数', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('# 大标题'),
    paragraph('> 引用内容'),
    paragraph('- 列表一'),
    paragraph('- 列表二'),
    paragraph('| A | B |'),
    paragraph('| - | - |'),
    paragraph('| 1 | 2 |'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 4)

  const nodes = editor.state.doc.content.content
  assert.equal(nodes[0].type.name, 'heading')
  assert.equal(nodes[1].type.name, 'blockquote')
  assert.equal(nodes[2].type.name, 'bulletList')
  assert.equal(nodes[3].type.name, 'table')
})

test('行首转义标记同样被识别', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('\\# 转义标题'),
    paragraph('\\- 转义列表'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 2)

  const [heading, list] = editor.state.doc.content.content
  assert.equal(heading.type.name, 'heading')
  assert.equal(heading.textContent, '转义标题')
  assert.equal(list.type.name, 'bulletList')
  assert.equal(list.child(0).textContent, '转义列表')
})

test('连续识别完成后再次识别返回 0', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('- 苹果'),
    paragraph('> 引用'),
  ]))

  assert.equal(convertMarkdownFormats(editor, md), 2)
  assert.equal(convertMarkdownFormats(editor, md), 0)
})

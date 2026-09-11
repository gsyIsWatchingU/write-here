import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { convertMarkdownHeadings, parseMarkdownHeading } from './markdownHeadings.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
    },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
  },
})

function paragraph(text, markedText = '') {
  const content = [schema.text(text)]
  if (markedText) content.push(schema.text(markedText, [schema.marks.strong.create()]))
  return schema.nodes.paragraph.create(null, content)
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

test('识别 1 到 6 级 Markdown 标题及被转义的标题标记', () => {
  assert.deepEqual(parseMarkdownHeading('## 二级标题'), {
    level: 2,
    contentStart: 3,
    contentEnd: 7,
  })
  assert.deepEqual(parseMarkdownHeading('\\###### 六级标题 ###  '), {
    level: 6,
    contentStart: 8,
    contentEnd: 12,
  })
  assert.equal(parseMarkdownHeading('#没有空格'), null)
  assert.equal(parseMarkdownHeading('    # 缩进超过三个空格'), null)
  assert.equal(parseMarkdownHeading('####### 超过六级'), null)
})

test('一键转换顶层普通段落并保留行内格式', () => {
  const editor = createEditor(schema.nodes.doc.create(null, [
    paragraph('## 1. NC 是什么？'),
    paragraph('\\### 子标题 ###  '),
    paragraph('# ', '加粗标题'),
    paragraph('#没有空格，不转换'),
    schema.nodes.code_block.create(null, schema.text('## 代码示例')),
  ]))

  assert.equal(convertMarkdownHeadings(editor), 3)

  const [first, second, third, fourth, fifth] = editor.state.doc.content.content
  assert.equal(first.type.name, 'heading')
  assert.equal(first.attrs.level, 2)
  assert.equal(first.textContent, '1. NC 是什么？')
  assert.equal(second.attrs.level, 3)
  assert.equal(second.textContent, '子标题')
  assert.equal(third.attrs.level, 1)
  assert.equal(third.textContent, '加粗标题')
  assert.equal(third.firstChild.marks[0].type.name, 'strong')
  assert.equal(fourth.type.name, 'paragraph')
  assert.equal(fifth.type.name, 'code_block')
  assert.equal(convertMarkdownHeadings(editor), 0)
})

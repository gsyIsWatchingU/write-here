import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { handleBackspaceDeleteEmptyLine } from './emptyLineBackspace.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
    orderedList: { content: 'listItem+', group: 'block', attrs: { order: { default: 1 } } },
    listItem: { content: 'paragraph block*' },
  },
})

function emptyParagraph() {
  return schema.node('paragraph')
}

function paragraphWith(text) {
  return schema.node('paragraph', null, schema.text(text))
}

function emptyListItem() {
  return schema.node('listItem', null, [emptyParagraph()])
}

function listItemWith(text) {
  return schema.node('listItem', null, [paragraphWith(text)])
}

function listWith(...items) {
  return schema.node('orderedList', null, items)
}

// 定位文档中第一个空文本块的内部位置（光标放在空行开头）。
function cursorAtFirstEmptyTextblock(doc) {
  let position = null
  doc.descendants((node, pos) => {
    if (position === null && node.isTextblock && node.content.size === 0) {
      position = pos + 1
    }
  })
  return position
}

function makeView(doc, cursorPos) {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, cursorPos),
  })
  let dispatched = null
  const view = {
    editable: true,
    state,
    dispatch(transaction) {
      dispatched = transaction
    },
  }
  return { view, getDispatched: () => dispatched }
}

test('文档开头空段落后按退格会删除该空行', () => {
  const doc = schema.node('doc', null, [
    emptyParagraph(),
    paragraphWith('第二行'),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), true)
  const dispatched = getDispatched()
  assert.ok(dispatched)
  assert.equal(dispatched.doc.childCount, 1)
  assert.equal(dispatched.doc.child(0).textContent, '第二行')
  assert.equal(dispatched.selection.from, 1)
})

test('文档开头空的有序列表项按退格会删除该空项并保留后续项', () => {
  const doc = schema.node('doc', null, [
    listWith(emptyListItem(), listItemWith('语言基础')),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), true)
  const dispatched = getDispatched()
  assert.ok(dispatched)
  assert.equal(dispatched.doc.childCount, 1)
  assert.equal(dispatched.doc.child(0).type.name, 'orderedList')
  assert.equal(dispatched.doc.child(0).childCount, 1)
  assert.equal(dispatched.doc.child(0).child(0).textContent, '语言基础')
})

test('整个文档只有一个空列表时按退格会替换为空段落', () => {
  const doc = schema.node('doc', null, [listWith(emptyListItem())])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), true)
  const dispatched = getDispatched()
  assert.ok(dispatched)
  assert.equal(dispatched.doc.childCount, 1)
  assert.equal(dispatched.doc.child(0).type.name, 'paragraph')
  assert.equal(dispatched.doc.child(0).content.size, 0)
})

test('文档只有一个空段落时按退格不做任何处理', () => {
  const doc = schema.node('doc', null, [emptyParagraph()])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), false)
  assert.equal(getDispatched(), null)
})

test('空行不在文档开头时交给默认行为处理', () => {
  const doc = schema.node('doc', null, [
    paragraphWith('第一行'),
    emptyParagraph(),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), false)
  assert.equal(getDispatched(), null)
})

test('非空文本块不触发空行删除', () => {
  const doc = schema.node('doc', null, [paragraphWith('内容')])
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
  })
  const view = {
    editable: true,
    state,
    dispatch() {
      assert.fail('不应派发事务')
    },
  }
  const event = { key: 'Backspace' }

  assert.equal(handleBackspaceDeleteEmptyLine(view, event), false)
})

test('带组合键的退格交给默认行为', () => {
  const doc = schema.node('doc', null, [
    emptyParagraph(),
    paragraphWith('第二行'),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))

  assert.equal(handleBackspaceDeleteEmptyLine(view, { key: 'Backspace', ctrlKey: true }), false)
  assert.equal(getDispatched(), null)
})

test('只读编辑器不触发空行删除', () => {
  const doc = schema.node('doc', null, [
    emptyParagraph(),
    paragraphWith('第二行'),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))
  view.editable = false

  assert.equal(handleBackspaceDeleteEmptyLine(view, { key: 'Backspace' }), false)
  assert.equal(getDispatched(), null)
})

test('非退格按键交给默认行为', () => {
  const doc = schema.node('doc', null, [
    emptyParagraph(),
    paragraphWith('第二行'),
  ])
  const { view, getDispatched } = makeView(doc, cursorAtFirstEmptyTextblock(doc))

  assert.equal(handleBackspaceDeleteEmptyLine(view, { key: 'Enter' }), false)
  assert.equal(getDispatched(), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { handleCodeBlockTab } from './codeBlockIndent.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    codeBlock: { content: 'text*', group: 'block', code: true, marks: '' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
})

function createView(text, fromOffset, toOffset = fromOffset, editable = true) {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, text ? schema.text(text) : undefined),
  ])
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1 + fromOffset, 1 + toOffset),
  })

  return {
    editable,
    get state() { return state },
    dispatch(transaction) { state = state.apply(transaction) },
  }
}

function tabEvent(shiftKey = false) {
  return { key: 'Tab', shiftKey, altKey: false, ctrlKey: false, metaKey: false }
}

test('Tab 缩进代码块中的所有选中行', () => {
  const view = createView('first\nsecond\nthird', 1, 12)

  assert.equal(handleCodeBlockTab(view, tabEvent()), true)
  assert.equal(view.state.doc.textContent, '  first\n  second\nthird')
  assert.equal(view.state.selection.from, 4)
  assert.equal(view.state.selection.to, 17)
})

test('选区结束于下一行开头时不缩进下一行', () => {
  const view = createView('first\nsecond\nthird', 0, 13)

  handleCodeBlockTab(view, tabEvent())
  assert.equal(view.state.doc.textContent, '  first\n  second\nthird')
})

test('未选中文字时 Tab 在光标处插入两个空格', () => {
  const view = createView('first', 2)

  handleCodeBlockTab(view, tabEvent())
  assert.equal(view.state.doc.textContent, 'fi  rst')
  assert.equal(view.state.selection.from, 5)
})

test('Shift+Tab 移除选中行的一级缩进', () => {
  const view = createView('  first\n\tsecond\nthird', 2, 16)

  assert.equal(handleCodeBlockTab(view, tabEvent(true)), true)
  assert.equal(view.state.doc.textContent, 'first\nsecond\nthird')
  assert.equal(view.state.selection.from, 1)
  assert.equal(view.state.selection.to, 14)
})

test('只读状态不接管 Tab', () => {
  const view = createView('first', 0, 0, false)

  assert.equal(handleCodeBlockTab(view, tabEvent()), false)
  assert.equal(view.state.doc.textContent, 'first')
})

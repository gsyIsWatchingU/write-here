import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  findBlockGapInsertionIndex,
  getTopLevelInsertionPosition,
  insertParagraphInClickedGap,
} from './blockGapInsertion.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
})

test('点击相邻块之间的空白时返回插入位置', () => {
  const rects = [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 90 },
    { top: 110, bottom: 140 },
  ]

  assert.equal(findBlockGapInsertionIndex(rects, 48), 1)
  assert.equal(findBlockGapInsertionIndex(rects, 100), 2)
})

test('点击块内部或编辑器首尾空白时不新增段落', () => {
  const rects = [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 90 },
  ]

  assert.equal(findBlockGapInsertionIndex(rects, 20), -1)
  assert.equal(findBlockGapInsertionIndex(rects, 5), -1)
  assert.equal(findBlockGapInsertionIndex(rects, 100), -1)
})

test('顶层插入位置按前置块大小计算', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一行')),
    schema.node('paragraph', null, schema.text('第二行')),
  ])

  assert.equal(getTopLevelInsertionPosition(doc, 0), 0)
  assert.equal(getTopLevelInsertionPosition(doc, 1), doc.child(0).nodeSize)
  assert.equal(getTopLevelInsertionPosition(doc, 2), doc.content.size)
})

test('点击块间空白会插入空段落并将光标放入新行', () => {
  const initialDoc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一行')),
    schema.node('paragraph', null, schema.text('第二行')),
  ])
  const state = EditorState.create({ doc: initialDoc })
  let dispatched = null
  let focused = false
  let defaultPrevented = false
  const view = {
    editable: true,
    state,
    dom: {
      children: [
        { getBoundingClientRect: () => ({ top: 10, bottom: 40 }) },
        { getBoundingClientRect: () => ({ top: 56, bottom: 90 }) },
      ],
    },
    dispatch(transaction) {
      dispatched = transaction
    },
    focus() {
      focused = true
    },
  }
  const event = {
    button: 0,
    clientY: 48,
    preventDefault() {
      defaultPrevented = true
    },
  }

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(dispatched.doc.childCount, 3)
  assert.equal(dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(dispatched.doc.child(1).textContent, '')
  assert.equal(dispatched.selection.from, initialDoc.child(0).nodeSize + 1)
  assert.equal(focused, true)
  assert.equal(defaultPrevented, true)
})

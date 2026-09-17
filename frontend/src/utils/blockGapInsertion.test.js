import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  findBlockGapInsertionIndex,
  findTrailingInsertionIndex,
  getTopLevelInsertionPosition,
  hasAdjacentEmptyTextBlock,
  insertParagraphInClickedGap,
  shouldInsertTrailingParagraph,
} from './blockGapInsertion.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    heading: { content: 'text*', group: 'block', defining: true, attrs: { level: { default: 1 } } },
    codeBlock: { content: 'text*', group: 'block', code: true, marks: '' },
    blockquote: { content: 'block+', group: 'block' },
    bulletList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*' },
    text: { group: 'inline' },
  },
})

function makeView(doc, rects, options = {}) {
  const view = {
    editable: options.editable ?? true,
    state: EditorState.create({ doc }),
    dom: { children: rects.map(rect => ({ getBoundingClientRect: () => rect })) },
    dispatched: null,
    focused: false,
    dispatch(transaction) {
      view.dispatched = transaction
    },
    focus() {
      view.focused = true
    },
  }
  return view
}

function makeEvent(clientY, overrides = {}) {
  const event = {
    button: 0,
    clientY,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    ...overrides,
  }
  return event
}

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

test('点击位置旁已有空行时不再重复新增', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一行')),
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('第二行')),
  ])

  assert.equal(hasAdjacentEmptyTextBlock(doc, 1), true)
  assert.equal(hasAdjacentEmptyTextBlock(doc, 2), true)
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

test('已经自动新增空行后再次点击相邻空白不会继续插入', () => {
  const initialDoc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一行')),
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('第二行')),
  ])
  const state = EditorState.create({ doc: initialDoc })
  let dispatched = false
  let defaultPrevented = false
  const view = {
    editable: true,
    state,
    dom: {
      children: [
        { getBoundingClientRect: () => ({ top: 10, bottom: 40 }) },
        { getBoundingClientRect: () => ({ top: 56, bottom: 80 }) },
        { getBoundingClientRect: () => ({ top: 96, bottom: 130 }) },
      ],
    },
    dispatch() {
      dispatched = true
    },
    focus() {},
  }
  const event = {
    button: 0,
    clientY: 88,
    preventDefault() {
      defaultPrevented = true
    },
  }

  assert.equal(insertParagraphInClickedGap(view, event), false)
  assert.equal(dispatched, false)
  assert.equal(defaultPrevented, false)
})

test('点击最后一块下方空白时返回末尾插入索引', () => {
  const rects = [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 90 },
  ]

  assert.equal(findTrailingInsertionIndex(rects, 100), 2)
  assert.equal(findTrailingInsertionIndex(rects, 91), 2)
  assert.equal(findTrailingInsertionIndex(rects, 90), -1)
  assert.equal(findTrailingInsertionIndex(rects, 70), -1)
  assert.equal(findTrailingInsertionIndex([], 100), -1)
  assert.equal(findTrailingInsertionIndex(rects, Number.NaN), -1)
})

test('末尾块的出口能力决定是否允许补行', () => {
  const listDoc = schema.node('bulletList', null, [
    schema.node('listItem', null, [schema.node('paragraph', null, schema.text('项'))]),
  ])

  assert.equal(shouldInsertTrailingParagraph(schema.node('paragraph', null, schema.text('正文'))), false)
  assert.equal(shouldInsertTrailingParagraph(schema.node('paragraph')), false)
  assert.equal(shouldInsertTrailingParagraph(schema.node('heading', { level: 2 }, schema.text('标题'))), false)
  assert.equal(shouldInsertTrailingParagraph(schema.node('codeBlock', null, schema.text('console.log(1)'))), true)
  assert.equal(shouldInsertTrailingParagraph(schema.node('codeBlock')), true)
  assert.equal(shouldInsertTrailingParagraph(schema.node('blockquote', null, [schema.node('paragraph', null, schema.text('引用'))])), true)
  assert.equal(shouldInsertTrailingParagraph(listDoc), true)
  assert.equal(shouldInsertTrailingParagraph(null), false)
})

test('末尾是代码块时点击下方空白会补一行并聚焦新行', () => {
  const initialDoc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('说明')),
    schema.node('codeBlock', null, schema.text('console.log(1)')),
  ])
  const view = makeView(initialDoc, [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 120 },
  ])
  const event = makeEvent(180)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 3)
  assert.equal(view.dispatched.doc.child(2).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(2).textContent, '')
  assert.equal(view.dispatched.selection.from, initialDoc.content.size + 1)
  assert.equal(view.focused, true)
  assert.equal(event.defaultPrevented, true)
})

test('末尾是空代码块时同样可以点击下方空白补一行', () => {
  const initialDoc = schema.node('doc', null, [schema.node('codeBlock')])
  const view = makeView(initialDoc, [{ top: 20, bottom: 72 }])
  const event = makeEvent(140)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(view.dispatched.selection.from, initialDoc.content.size + 1)
})

test('末尾是段落或标题时点击下方空白不补行', () => {
  const paragraphDoc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('正文'))])
  const paragraphView = makeView(paragraphDoc, [{ top: 20, bottom: 60 }])
  const paragraphEvent = makeEvent(150)

  assert.equal(insertParagraphInClickedGap(paragraphView, paragraphEvent), false)
  assert.equal(paragraphView.dispatched, null)
  assert.equal(paragraphEvent.defaultPrevented, false)

  const headingDoc = schema.node('doc', null, [schema.node('heading', { level: 1 }, schema.text('标题'))])
  const headingView = makeView(headingDoc, [{ top: 20, bottom: 60 }])

  assert.equal(insertParagraphInClickedGap(headingView, makeEvent(150)), false)
  assert.equal(headingView.dispatched, null)
})

test('补行后末尾变成空段落，再次点击不会继续插入', () => {
  const firstDoc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const firstView = makeView(firstDoc, [{ top: 20, bottom: 60 }])

  assert.equal(insertParagraphInClickedGap(firstView, makeEvent(150)), true)

  const secondDoc = firstView.dispatched.doc
  const secondView = makeView(secondDoc, [
    { top: 20, bottom: 60 },
    { top: 76, bottom: 100 },
  ])
  const secondEvent = makeEvent(150)

  assert.equal(insertParagraphInClickedGap(secondView, secondEvent), false)
  assert.equal(secondView.dispatched, null)
})

test('块间空白点击逻辑不受末尾补行影响', () => {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, schema.text('a = 1')),
    schema.node('paragraph', null, schema.text('正文')),
  ])
  const view = makeView(doc, [
    { top: 20, bottom: 60 },
    { top: 96, bottom: 130 },
  ])

  assert.equal(insertParagraphInClickedGap(view, makeEvent(78)), true)
  assert.equal(view.dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(1).textContent, '')
  assert.equal(view.dispatched.doc.childCount, 3)
})

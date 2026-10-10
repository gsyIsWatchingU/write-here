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
  insertParagraphInLeadingBlank,
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
    image: { group: 'block', atom: true, attrs: { src: { default: null } } },
    text: { group: 'inline' },
  },
})

function makeView(doc, rects, options = {}) {
  const view = {
    editable: options.editable ?? true,
    state: EditorState.create({ doc }),
    dom: {
      children: rects.map(rect => ({ getBoundingClientRect: () => rect })),
      parentElement: options.parentElement ?? null,
    },
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

// 模拟双击：先触发 detail=1 的单击（只做默认行为、不插入），返回 detail=2 的第二次点击事件，
// 由调用方再传给插入函数以验证双击行为。
function secondClick(view, clientY, overrides = {}) {
  insertParagraphInClickedGap(view, makeEvent(clientY, { ...overrides, detail: 1 }))
  return makeEvent(clientY, { ...overrides, detail: 2 })
}

// 模拟双击：容器顶部/底部空白入口。
function secondClickBlank(view, clientY, overrides = {}) {
  insertParagraphInLeadingBlank(view, makeEvent(clientY, { ...overrides, detail: 1 }))
  return makeEvent(clientY, { ...overrides, detail: 2 })
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
  const event = secondClick(view, 48)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(dispatched.doc.childCount, 3)
  assert.equal(dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(dispatched.doc.child(1).textContent, '')
  assert.equal(dispatched.selection.from, initialDoc.child(0).nodeSize + 1)
  assert.equal(focused, true)
  assert.equal(event.defaultPrevented, true)
})

test('已经自动新增空行后再次点击相邻空白不会继续插入', () => {
  const initialDoc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一行')),
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('第二行')),
  ])
  const state = EditorState.create({ doc: initialDoc })
  let dispatched = false
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
  const event = secondClick(view, 88)

  assert.equal(insertParagraphInClickedGap(view, event), false)
  assert.equal(dispatched, false)
  assert.equal(event.defaultPrevented, false)
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
  const event = secondClick(view, 180)

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
  const event = secondClick(view, 140)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(view.dispatched.selection.from, initialDoc.content.size + 1)
})

test('末尾是段落或标题时点击下方空白不补行', () => {
  const paragraphDoc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('正文'))])
  const paragraphView = makeView(paragraphDoc, [{ top: 20, bottom: 60 }])
  const paragraphEvent = secondClick(paragraphView, 150)

  assert.equal(insertParagraphInClickedGap(paragraphView, paragraphEvent), false)
  assert.equal(paragraphView.dispatched, null)
  assert.equal(paragraphEvent.defaultPrevented, false)

  const headingDoc = schema.node('doc', null, [schema.node('heading', { level: 1 }, schema.text('标题'))])
  const headingView = makeView(headingDoc, [{ top: 20, bottom: 60 }])

  assert.equal(insertParagraphInClickedGap(headingView, secondClick(headingView, 150)), false)
  assert.equal(headingView.dispatched, null)
})

test('补行后末尾变成空段落，再次点击不会继续插入', () => {
  const firstDoc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const firstView = makeView(firstDoc, [{ top: 20, bottom: 60 }])

  assert.equal(insertParagraphInClickedGap(firstView, secondClick(firstView, 150)), true)

  const secondDoc = firstView.dispatched.doc
  const secondView = makeView(secondDoc, [
    { top: 20, bottom: 60 },
    { top: 76, bottom: 100 },
  ])
  const secondEvent = secondClick(secondView, 150)

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

  assert.equal(insertParagraphInClickedGap(view, secondClick(view, 78)), true)
  assert.equal(view.dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(1).textContent, '')
  assert.equal(view.dispatched.doc.childCount, 3)
})

test('点击图片与后续空段落之间的间距，光标进入空段落而非选中图片', () => {
  const imageNode = schema.node('image', { src: 'x.png' })
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('上文')),
    imageNode,
    schema.node('paragraph'),
  ])
  const view = makeView(doc, [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 120 },
    { top: 136, bottom: 160 },
  ])
  // 点击 figure.bottom(120) 和空段落.top(136) 之间
  const event = secondClick(view, 128)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  // 不新增块，只是移动了光标
  assert.equal(view.dispatched.doc.childCount, 3)
  // 光标落在空段落内
  const imageSize = doc.child(1).nodeSize
  assert.equal(view.dispatched.selection.from, doc.child(0).nodeSize + imageSize + 1)
  assert.equal(view.focused, true)
  assert.equal(event.defaultPrevented, true)
})

test('点击空段落与后续普通段落之间的间距，仍不主动改光标', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('上文')),
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('下文')),
  ])
  const view = makeView(doc, [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 80 },
    { top: 96, bottom: 130 },
  ])
  // 点击空段落(56-80) 和 下文(96-130) 之间
  const event = secondClick(view, 88)

  assert.equal(insertParagraphInClickedGap(view, event), false)
  assert.equal(view.dispatched, null)
  assert.equal(event.defaultPrevented, false)
})

test('图片是最后一块时点击下方空白会补一行', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('上文')),
    schema.node('image', { src: 'x.png' }),
  ])
  const view = makeView(doc, [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 120 },
  ])
  const event = secondClick(view, 180)

  assert.equal(insertParagraphInClickedGap(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 3)
  assert.equal(view.dispatched.doc.child(2).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(2).textContent, '')
})

test('第一个块是代码块时点击顶部空白会在文档开头补一行', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })
  const event = secondClickBlank(view, 20, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(0).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(0).textContent, '')
  assert.equal(view.dispatched.selection.from, 1)
  assert.equal(view.focused, true)
  assert.equal(event.defaultPrevented, true)
})

test('第一个块是图片时点击顶部空白会在文档开头补一行', () => {
  const doc = schema.node('doc', null, [schema.node('image', { src: 'x.png' })])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 140 }], { parentElement })
  const event = secondClickBlank(view, 20, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(0).type.name, 'paragraph')
  assert.equal(view.dispatched.selection.from, 1)
})

test('第一个块是段落或标题时点击顶部空白不补行', () => {
  const paragraphDoc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('正文'))])
  const parentElement = {}
  const paragraphView = makeView(paragraphDoc, [{ top: 60, bottom: 100 }], { parentElement })
  const paragraphEvent = secondClickBlank(paragraphView, 20, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(paragraphView, paragraphEvent), false)
  assert.equal(paragraphView.dispatched, null)
  assert.equal(paragraphEvent.defaultPrevented, false)

  const headingDoc = schema.node('doc', null, [schema.node('heading', { level: 1 }, schema.text('标题'))])
  const headingView = makeView(headingDoc, [{ top: 60, bottom: 100 }], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(headingView, secondClickBlank(headingView, 20, { target: parentElement })), false)
  assert.equal(headingView.dispatched, null)
})

test('第一个块已是空段落时点击顶部空白不再补行', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph')])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 100 }], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, secondClickBlank(view, 20, { target: parentElement })), false)
  assert.equal(view.dispatched, null)
})

test('点击第一个块内部或非容器空白时顶部补行不生效', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })

  // 点击位置落在第一个块内部（clientY 在块范围内）
  assert.equal(insertParagraphInLeadingBlank(view, secondClickBlank(view, 90, { target: parentElement })), false)
  assert.equal(view.dispatched, null)

  // 事件 target 不是 .editor-content 本身（例如点击了外层 wrapper 的空白）
  assert.equal(insertParagraphInLeadingBlank(view, secondClickBlank(view, 20, { target: {} })), false)
  assert.equal(view.dispatched, null)
})

test('顶部补行忽略非左键、修饰键与只读视图', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const editableView = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })
  const readOnlyView = makeView(doc, [{ top: 60, bottom: 120 }], { editable: false, parentElement })

  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(20, { target: parentElement, button: 2 })), false)
  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(20, { target: parentElement, ctrlKey: true })), false)
  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(20, { target: parentElement, shiftKey: true })), false)
  assert.equal(insertParagraphInLeadingBlank(readOnlyView, makeEvent(20, { target: parentElement })), false)
  assert.equal(editableView.dispatched, null)
})

test('没有内容块时顶部补行不生效', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('正文'))])
  const parentElement = {}
  const view = makeView(doc, [], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, makeEvent(20, { target: parentElement })), false)
  assert.equal(view.dispatched, null)
})

test('顶部补行后第一个块变为空段落，再次点击不会继续插入', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, secondClickBlank(view, 20, { target: parentElement })), true)

  const secondDoc = view.dispatched.doc
  const secondView = makeView(secondDoc, [
    { top: 20, bottom: 50 },
    { top: 66, bottom: 126 },
  ], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(secondView, secondClickBlank(secondView, 10, { target: parentElement })), false)
  assert.equal(secondView.dispatched, null)
})

test('点击容器底部大空白（末尾是代码块）在文档末尾补一行', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })
  // 点击位置在 .ProseMirror 盒下方、容器底部空白内
  const event = secondClickBlank(view, 500, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(1).type.name, 'paragraph')
  assert.equal(view.dispatched.doc.child(1).textContent, '')
  assert.equal(view.dispatched.selection.from, doc.content.size + 1)
  assert.equal(view.focused, true)
  assert.equal(event.defaultPrevented, true)
})

test('点击容器底部大空白（末尾是图片）同样补一行', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('上文')),
    schema.node('image', { src: 'x.png' }),
  ])
  const parentElement = {}
  const view = makeView(doc, [
    { top: 10, bottom: 40 },
    { top: 56, bottom: 120 },
  ], { parentElement })
  const event = secondClickBlank(view, 400, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, event), true)
  assert.equal(view.dispatched.doc.childCount, 3)
  assert.equal(view.dispatched.doc.child(2).type.name, 'paragraph')
  assert.equal(view.dispatched.selection.from, doc.content.size + 1)
})

test('容器底部大空白但末尾是段落或标题时不补行', () => {
  const paragraphDoc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('正文'))])
  const parentElement = {}
  const paragraphView = makeView(paragraphDoc, [{ top: 60, bottom: 100 }], { parentElement })
  const paragraphEvent = secondClickBlank(paragraphView, 500, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(paragraphView, paragraphEvent), false)
  assert.equal(paragraphView.dispatched, null)
  assert.equal(paragraphEvent.defaultPrevented, false)

  const headingDoc = schema.node('doc', null, [schema.node('heading', { level: 2 }, schema.text('标题'))])
  const headingView = makeView(headingDoc, [{ top: 60, bottom: 100 }], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(headingView, secondClickBlank(headingView, 500, { target: parentElement })), false)
  assert.equal(headingView.dispatched, null)
})

test('点击容器中部空白（既不在首块上方也不在末块下方）不补行', () => {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, schema.text('a = 1')),
    schema.node('paragraph', null, schema.text('正文')),
  ])
  const parentElement = {}
  const view = makeView(doc, [
    { top: 60, bottom: 120 },
    { top: 140, bottom: 170 },
  ], { parentElement })
  // clientY 落在两块之间，但 target 是容器（如左右 padding），保持默认行为
  const event = secondClickBlank(view, 130, { target: parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, event), false)
  assert.equal(view.dispatched, null)
  assert.equal(event.defaultPrevented, false)
})

test('容器底部补行忽略非左键、修饰键与只读视图', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const editableView = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })
  const readOnlyView = makeView(doc, [{ top: 60, bottom: 120 }], { editable: false, parentElement })

  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(500, { target: parentElement, button: 2 })), false)
  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(500, { target: parentElement, ctrlKey: true })), false)
  assert.equal(insertParagraphInLeadingBlank(editableView, makeEvent(500, { target: parentElement, shiftKey: true })), false)
  assert.equal(insertParagraphInLeadingBlank(readOnlyView, makeEvent(500, { target: parentElement })), false)
  assert.equal(editableView.dispatched, null)
})

test('容器底部补行后末尾变为空段落，再次点击不会继续插入', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(view, secondClickBlank(view, 500, { target: parentElement })), true)

  const secondDoc = view.dispatched.doc
  const secondView = makeView(secondDoc, [
    { top: 60, bottom: 120 },
    { top: 136, bottom: 160 },
  ], { parentElement })

  assert.equal(insertParagraphInLeadingBlank(secondView, secondClickBlank(secondView, 500, { target: parentElement })), false)
  assert.equal(secondView.dispatched, null)
})

test('单击空白不插入，双击同一空隙才补行（防误触）', () => {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, schema.text('a = 1')),
    schema.node('paragraph', null, schema.text('正文')),
  ])
  const view = makeView(doc, [
    { top: 20, bottom: 60 },
    { top: 96, bottom: 130 },
  ])

  // 单击（detail=1）：不插入，且不阻止默认行为（光标定位交给 ProseMirror）
  assert.equal(insertParagraphInClickedGap(view, makeEvent(78, { detail: 1 })), false)
  assert.equal(view.dispatched, null)

  // 同一空隙的第二次点击（detail=2）：补行
  const secondEvent = makeEvent(78, { detail: 2 })
  assert.equal(insertParagraphInClickedGap(view, secondEvent), true)
  assert.equal(view.dispatched.doc.childCount, 3)
  assert.equal(secondEvent.defaultPrevented, true)
})

test('三连击空白不会在插入后继续插入', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const view = makeView(doc, [{ top: 20, bottom: 60 }])

  assert.equal(insertParagraphInClickedGap(view, makeEvent(150, { detail: 1 })), false)
  assert.equal(insertParagraphInClickedGap(view, makeEvent(150, { detail: 2 })), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  // 第三击属于连击（detail=3），不再插入
  assert.equal(insertParagraphInClickedGap(view, makeEvent(150, { detail: 3 })), false)
  assert.equal(view.dispatched.doc.childCount, 2)
})

test('快速点击两个不同空隙不误判为双击', () => {
  const doc = schema.node('doc', null, [
    schema.node('codeBlock', null, schema.text('a = 1')),
    schema.node('paragraph', null, schema.text('正文')),
    schema.node('codeBlock', null, schema.text('b = 2')),
  ])
  const view = makeView(doc, [
    { top: 20, bottom: 60 },
    { top: 76, bottom: 110 },
    { top: 126, bottom: 166 },
  ])

  // 第一次点击空隙 1（代码块与正文之间）
  assert.equal(insertParagraphInClickedGap(view, makeEvent(68, { detail: 1 })), false)
  // 紧接着点击另一个空隙 2（正文与第二个代码块之间）：detail=2 但空隙不同，不插入
  assert.equal(insertParagraphInClickedGap(view, makeEvent(118, { detail: 2 })), false)
  assert.equal(view.dispatched, null)

  // 停顿后回到空隙 1 重新双击：仍能正常补行
  assert.equal(insertParagraphInClickedGap(view, makeEvent(68, { detail: 1 })), false)
  assert.equal(insertParagraphInClickedGap(view, makeEvent(68, { detail: 2 })), true)
  assert.equal(view.dispatched.doc.childCount, 4)
})

test('单击容器顶部/底部空白不插入，双击才补行', () => {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('a = 1'))])
  const parentElement = {}
  const view = makeView(doc, [{ top: 60, bottom: 120 }], { parentElement })

  // 顶部：单击不插入
  assert.equal(insertParagraphInLeadingBlank(view, makeEvent(20, { target: parentElement, detail: 1 })), false)
  assert.equal(view.dispatched, null)
  // 顶部：双击插入
  assert.equal(insertParagraphInLeadingBlank(view, makeEvent(20, { target: parentElement, detail: 2 })), true)
  assert.equal(view.dispatched.doc.childCount, 2)
  assert.equal(view.dispatched.doc.child(0).type.name, 'paragraph')

  // 底部：用补行后的文档（末尾现在是段落，不补行）重新验证单击不插入
  const secondDoc = view.dispatched.doc
  const secondView = makeView(secondDoc, [
    { top: 20, bottom: 50 },
    { top: 66, bottom: 126 },
  ], { parentElement })
  assert.equal(insertParagraphInLeadingBlank(secondView, makeEvent(500, { target: parentElement, detail: 1 })), false)
  assert.equal(secondView.dispatched, null)

  // 底部：末尾是代码块的独立场景，单击不插入、双击插入
  const thirdDoc = schema.node('doc', null, [schema.node('codeBlock', null, schema.text('b = 2'))])
  const thirdView = makeView(thirdDoc, [{ top: 60, bottom: 120 }], { parentElement })
  assert.equal(insertParagraphInLeadingBlank(thirdView, makeEvent(500, { target: parentElement, detail: 1 })), false)
  assert.equal(thirdView.dispatched, null)
  assert.equal(insertParagraphInLeadingBlank(thirdView, makeEvent(500, { target: parentElement, detail: 2 })), true)
  assert.equal(thirdView.dispatched.doc.childCount, 2)
})

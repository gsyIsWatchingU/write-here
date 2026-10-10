import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import {
  getBlockInsertionIndex,
  getBlockMenuAnchor,
  getOperationBlock,
  getBlockMoveTargetIndex,
  moveTopLevelBlock,
  moveSiblingBlock,
  shouldShowBlockMenu,
} from './blockMenu.js'

test('光标停留时返回当前块锚点', () => {
  const anchor = { depth: 1 }
  assert.equal(getBlockMenuAnchor({ empty: true, $from: anchor }), anchor)
})

const listSchema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block' },
  bulletList: { content: 'listItem+', group: 'block' },
  listItem: { content: 'paragraph block*' },
  text: { group: 'inline' },
} })
const lp = value => listSchema.node('paragraph', null, listSchema.text(value))
const li = (value, tail = []) => listSchema.node('listItem', null, [lp(value), ...tail])
const listDoc = () => listSchema.node('doc', null, [lp('前'),
  listSchema.node('bulletList', null, [li('甲'), li('乙'), li('丙')]), lp('后')])

test('列表块操作定位单项而非整个列表，嵌套列表定位最内层项', () => {
  const doc = listDoc()
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 12) })
  const block = getOperationBlock(state.selection)
  assert.equal(block.node.textContent, '乙')
  assert.equal(block.parent.type.name, 'bulletList')
  assert.equal(block.position, 9)
  assert.equal(block.index, 1)
  const nested = listSchema.node('doc', null, listSchema.node('bulletList', null,
    li('外', [listSchema.node('bulletList', null, [li('内'), li('另')])])) )
  let position
  nested.descendants((node, pos) => { if (node.isText && node.text === '内') position = pos })
  const inner = getOperationBlock(TextSelection.create(nested, position))
  assert.equal(inner.node.textContent, '内')
  assert.equal(inner.parent.childCount, 2)
})

test('单项上移下移不带走列表、前后段落或其他项', () => {
  const doc = listDoc()
  const state = EditorState.create({ doc })
  const up = moveSiblingBlock(state.tr, 1, 0, 3)
  assert.deepEqual(up.transaction.doc.child(1).content.content.map(node => node.textContent), ['乙', '甲', '丙'])
  assert.equal(up.transaction.doc.firstChild.textContent, '前')
  assert.equal(up.transaction.doc.lastChild.textContent, '后')
  assert.equal(up.insertPosition, 4)
  const down = moveSiblingBlock(state.tr, 1, 2, 3)
  assert.deepEqual(down.transaction.doc.child(1).content.content.map(node => node.textContent), ['甲', '丙', '乙'])
  assert.equal(moveSiblingBlock(state.tr, 0, -1, 3), null)
})

test('划词选中时仍返回选区起点所在块锚点', () => {
  const anchor = { depth: 2 }
  assert.equal(getBlockMenuAnchor({ empty: false, $from: anchor }), anchor)
})

test('文档根节点或无选区时不显示块操作柄', () => {
  assert.equal(getBlockMenuAnchor({ empty: false, $from: { depth: 0 } }), null)
  assert.equal(getBlockMenuAnchor(null), null)
})

test('拖动落点按完整块的上下半区计算', () => {
  const rects = [
    { top: 10, height: 40 },
    { top: 60, height: 120 },
  ]

  assert.equal(getBlockInsertionIndex(rects, 20), 0)
  assert.equal(getBlockInsertionIndex(rects, 50), 1)
  assert.equal(getBlockInsertionIndex(rects, 130), 2)
})

test('拖动整块时把原始插入边界换算为删除后的目标索引', () => {
  assert.equal(getBlockMoveTargetIndex(1, 0, 4), 0)
  assert.equal(getBlockMoveTargetIndex(1, 4, 4), 3)
  assert.equal(getBlockMoveTargetIndex(1, 1, 4), null)
  assert.equal(getBlockMoveTargetIndex(1, 2, 4), null)
  assert.equal(getBlockMoveTargetIndex(4, 0, 4), null)
})

test('编辑器聚焦且命中内容块时显示块操作柄', () => {
  assert.equal(shouldShowBlockMenu({
    isDestroyed: false,
    isEditable: true,
    isFocused: true,
    interacting: false,
    hasTarget: true,
  }), true)
})

test('点击操作柄导致编辑器失焦时仍保留块操作柄', () => {
  // 代码块操作柄点击后编辑器 blur，如果按焦点判定就会被立刻收起，表现为「点了没反应」。
  assert.equal(shouldShowBlockMenu({
    isDestroyed: false,
    isEditable: true,
    isFocused: false,
    interacting: true,
    hasTarget: true,
  }), true)
})

test('未聚焦且无交互时收起块操作柄', () => {
  assert.equal(shouldShowBlockMenu({
    isDestroyed: false,
    isEditable: true,
    isFocused: false,
    interacting: false,
    hasTarget: true,
  }), false)
})

test('没有可用内容块时不显示块操作柄', () => {
  assert.equal(shouldShowBlockMenu({
    isDestroyed: false,
    isEditable: true,
    isFocused: true,
    interacting: true,
    hasTarget: false,
  }), false)
})

test('编辑器只读或已销毁时不显示块操作柄', () => {
  assert.equal(shouldShowBlockMenu({
    isDestroyed: false,
    isEditable: false,
    isFocused: true,
    interacting: true,
    hasTarget: true,
  }), false)
  assert.equal(shouldShowBlockMenu({
    isDestroyed: true,
    isEditable: true,
    isFocused: true,
    interacting: true,
    hasTarget: true,
  }), false)
})

test('拖动代码块会原样移动整个顶层节点', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'text*', group: 'block' },
      codeBlock: { content: 'text*', group: 'block', code: true },
      text: { group: 'inline' },
    },
  })
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, schema.text('第一段')),
    schema.node('codeBlock', null, schema.text('line 1\nline 2')),
    schema.node('paragraph', null, schema.text('最后一段')),
  ])
  const state = EditorState.create({ doc })
  const result = moveTopLevelBlock(state.tr, 1, 0)

  assert.ok(result)
  assert.equal(result.transaction.doc.child(0).type.name, 'codeBlock')
  assert.equal(result.transaction.doc.child(0).textContent, 'line 1\nline 2')
  assert.equal(result.transaction.doc.childCount, 3)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  getBlockInsertionIndex,
  getBlockMenuAnchor,
  getBlockMoveTargetIndex,
  moveTopLevelBlock,
} from './blockMenu.js'

test('光标停留时返回当前块锚点', () => {
  const anchor = { depth: 1 }
  assert.equal(getBlockMenuAnchor({ empty: true, $from: anchor }), anchor)
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

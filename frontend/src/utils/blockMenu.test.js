import assert from 'node:assert/strict'
import test from 'node:test'
import { getBlockMenuAnchor } from './blockMenu.js'

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

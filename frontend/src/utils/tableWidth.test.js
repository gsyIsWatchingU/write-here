import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TABLE_WIDTH_ATTRIBUTE,
  TABLE_WIDTH_AUTO,
  TABLE_WIDTH_FULL,
  getTableWidthAttrs,
  getTableWidthLabel,
  getTableWidthMode,
  isTableNode,
  normalizeTableWidthMode,
} from './tableWidth.js'

function tableNode(attrs = {}) {
  return { type: { name: 'table' }, attrs: { ...attrs } }
}

test('未设置或未知的宽度模式一律按窗口宽度处理', () => {
  assert.equal(normalizeTableWidthMode(undefined), TABLE_WIDTH_FULL)
  assert.equal(normalizeTableWidthMode(''), TABLE_WIDTH_FULL)
  assert.equal(normalizeTableWidthMode('100%'), TABLE_WIDTH_FULL)
  assert.equal(normalizeTableWidthMode(TABLE_WIDTH_AUTO), TABLE_WIDTH_AUTO)
})

test('只有 table 节点才算表格块', () => {
  assert.equal(isTableNode(tableNode()), true)
  assert.equal(isTableNode({ type: { name: 'paragraph' }, attrs: {} }), false)
  assert.equal(isTableNode(null), false)
  assert.equal(isTableNode(undefined), false)
})

test('老文档的表格没有 widthMode 时默认铺满窗口', () => {
  assert.equal(getTableWidthMode(tableNode()), TABLE_WIDTH_FULL)
  assert.equal(getTableWidthMode(tableNode({ widthMode: TABLE_WIDTH_AUTO })), TABLE_WIDTH_AUTO)
})

test('切到不同模式时返回合并后的 attrs', () => {
  const node = tableNode({ widthMode: TABLE_WIDTH_FULL, colspan: 1 })
  assert.deepEqual(getTableWidthAttrs(node, TABLE_WIDTH_AUTO), {
    widthMode: TABLE_WIDTH_AUTO,
    colspan: 1,
  })
})

test('非表格或模式没变时不产生 attrs，避免空事务', () => {
  assert.equal(getTableWidthAttrs(tableNode({ widthMode: TABLE_WIDTH_FULL }), TABLE_WIDTH_FULL), null)
  assert.equal(getTableWidthAttrs({ type: { name: 'paragraph' }, attrs: {} }, TABLE_WIDTH_AUTO), null)
  assert.equal(getTableWidthAttrs(null, TABLE_WIDTH_AUTO), null)
})

test('模式标签与属性名保持稳定', () => {
  assert.equal(getTableWidthLabel(TABLE_WIDTH_FULL), '适应窗口宽度')
  assert.equal(getTableWidthLabel(TABLE_WIDTH_AUTO), '适应内容')
  assert.equal(getTableWidthLabel('乱七八糟'), '适应窗口宽度')
  assert.equal(TABLE_WIDTH_ATTRIBUTE, 'data-table-width')
})

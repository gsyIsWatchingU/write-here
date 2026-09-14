import test from 'node:test'
import assert from 'node:assert/strict'
import { filterDocumentDirectory } from './documentDirectory.js'

const documents = [
  { id: 1, title: '项目说明' },
  { id: 2, title: '接口设计', username: '小林' },
]

test('文档目录支持按标题筛选', () => {
  assert.deepEqual(filterDocumentDirectory(documents, '接口').map(item => item.id), [2])
})

test('协作文档支持按作者筛选并忽略首尾空格', () => {
  assert.deepEqual(filterDocumentDirectory(documents, ' 小林 ').map(item => item.id), [2])
})

test('空关键词保留全部文档', () => {
  assert.equal(filterDocumentDirectory(documents, '').length, 2)
})

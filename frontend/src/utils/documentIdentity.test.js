import test from 'node:test'
import assert from 'node:assert/strict'
import { getDocumentIdentifier, getDocumentPath } from './documentIdentity.js'

test('文档路径优先使用 publicId 并兼容旧数字 ID', () => {
  const publicId = '0123456789abcdef0123456789abcdef'
  assert.equal(getDocumentIdentifier({ id: 9, publicId }), publicId)
  assert.equal(getDocumentPath({ id: 9, publicId }), `/doc/${publicId}`)
  assert.equal(getDocumentPath({ id: 9 }), '/doc/9')
})

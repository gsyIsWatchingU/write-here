import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  commentAnchorPluginKey,
  createCommentAnchorPlugin,
  mapCommentAnchor,
  resolveCommentAnchor,
} from './commentAnchors.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
})

function createDoc(text = 'Alpha selected text Omega') {
  return schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))])
}

function createAnchor(overrides = {}) {
  return {
    id: 1,
    parentId: null,
    anchorFrom: 7,
    anchorTo: 20,
    quoteText: 'selected text',
    quotePrefix: 'Alpha ',
    quoteSuffix: ' Omega',
    anchorStatus: 'active',
    isResolved: 0,
    ...overrides,
  }
}

test('位置失效后可根据原文和上下文重新定位', () => {
  const resolved = resolveCommentAnchor(createDoc(), createAnchor({ anchorFrom: 1, anchorTo: 6 }))
  assert.equal(resolved.anchorFrom, 7)
  assert.equal(resolved.anchorTo, 20)
  assert.equal(resolved.anchorStatus, 'active')
})

test('正文插入后锚点跟随 transaction mapping 移动', () => {
  const state = EditorState.create({ schema, doc: createDoc() })
  const transaction = state.tr.insertText('New ', 1)
  const mapped = mapCommentAnchor(createAnchor(), transaction)
  assert.equal(mapped.anchorFrom, 11)
  assert.equal(mapped.anchorTo, 24)
  assert.equal(mapped.quoteText, 'selected text')
})

test('原文完全删除后锚点进入失效状态', () => {
  const state = EditorState.create({ schema, doc: createDoc() })
  const transaction = state.tr.delete(7, 20)
  const mapped = mapCommentAnchor(createAnchor(), transaction)
  assert.equal(mapped.anchorStatus, 'orphaned')
  assert.equal(mapped.anchorFrom, mapped.anchorTo)
})

test('装饰层允许多个评论范围重叠', () => {
  const plugin = createCommentAnchorPlugin()
  const state = EditorState.create({ schema, doc: createDoc(), plugins: [plugin] })
  const next = state.apply(state.tr.setMeta(commentAnchorPluginKey, {
    comments: [
      createAnchor(),
      createAnchor({ id: 2, anchorFrom: 10, anchorTo: 20, quoteText: 'ected text' }),
    ],
    activeCommentId: 1,
    showResolved: false,
  }))
  assert.equal(plugin.getState(next).find().length, 2)
})

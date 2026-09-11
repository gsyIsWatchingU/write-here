import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { convertBlock, getSelectionBlockType } from './editorBlocks.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'text*',
      group: 'block',
    },
    text: { group: 'inline' },
  },
})

function createBoundarySelectionEditor() {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 2 }, schema.text('标题')),
    schema.node('paragraph', null, schema.text('正文内容')),
  ])
  const paragraphPosition = doc.child(0).nodeSize
  const state = {
    doc,
    selection: {
      from: paragraphPosition,
      to: paragraphPosition + doc.child(1).nodeSize - 1,
      empty: false,
    },
  }
  const calls = []
  const chain = {
    focus() { return this },
    setTextSelection(range) { calls.push(['setTextSelection', range]); return this },
    setHeading(attributes) { calls.push(['setHeading', attributes]); return this },
    run() { calls.push(['run']); return true },
  }
  return {
    editor: {
      state,
      isEditable: true,
      isDestroyed: false,
      isActive: () => false,
      chain: () => chain,
    },
    calls,
    paragraphPosition,
    paragraphSize: doc.child(1).nodeSize,
  }
}

test('边界选区只识别实际选中的正文块', () => {
  const { editor } = createBoundarySelectionEditor()
  assert.equal(getSelectionBlockType(editor), 'paragraph')
})

test('块转换会把边界选区收敛到实际文本块', () => {
  const { editor, calls, paragraphPosition, paragraphSize } = createBoundarySelectionEditor()
  assert.equal(convertBlock(editor, 'heading-1'), true)
  assert.deepEqual(calls, [
    ['setTextSelection', { from: paragraphPosition + 1, to: paragraphPosition + paragraphSize - 1 }],
    ['setHeading', { level: 1 }],
    ['run'],
  ])
})

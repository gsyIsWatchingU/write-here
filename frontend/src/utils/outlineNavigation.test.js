import assert from 'node:assert/strict'
import test from 'node:test'

import { scrollToOutlineHeading } from './outlineNavigation.js'

function createEditor({ documentSize = 80, domNode } = {}) {
  const focusCalls = []
  const nodeDOMCalls = []
  const editor = {
    state: { doc: { content: { size: documentSize } } },
    view: {
      nodeDOM(position) {
        nodeDOMCalls.push(position)
        return domNode
      },
    },
    commands: {
      focus(...args) {
        focusCalls.push(args)
      },
    },
  }

  return { editor, focusCalls, nodeDOMCalls }
}

test('点击大纲后将标题滚动到固定顶部位置', () => {
  const scrollCalls = []
  const headingElement = {
    nodeType: 1,
    tagName: 'H2',
    scrollIntoView(options) {
      scrollCalls.push(options)
    },
  }
  const { editor, focusCalls, nodeDOMCalls } = createEditor({ domNode: headingElement })

  assert.equal(scrollToOutlineHeading(editor, 12), true)
  assert.deepEqual(nodeDOMCalls, [12])
  assert.deepEqual(focusCalls, [[13, { scrollIntoView: false }]])
  assert.deepEqual(scrollCalls, [{
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest',
  }])
})

test('忽略失效位置或无法定位的标题节点', () => {
  const paragraph = { nodeType: 1, tagName: 'P', scrollIntoView() {} }
  const { editor, focusCalls, nodeDOMCalls } = createEditor({ documentSize: 20, domNode: paragraph })

  assert.equal(scrollToOutlineHeading(editor, -1), false)
  assert.equal(scrollToOutlineHeading(editor, 20), false)
  assert.equal(scrollToOutlineHeading(editor, 6), false)
  assert.deepEqual(nodeDOMCalls, [6])
  assert.deepEqual(focusCalls, [])
})

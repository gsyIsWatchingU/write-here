import assert from 'node:assert/strict'
import test from 'node:test'
import { copyPlainText } from './clipboard.js'

test('优先使用 Clipboard API 复制文本', async () => {
  let copied = ''
  const clipboard = {
    async writeText(value) {
      copied = value
    },
  }

  assert.equal(await copyPlainText('const answer = 42', { clipboard }), true)
  assert.equal(copied, 'const answer = 42')
})

test('Clipboard API 失败时使用兼容复制方案', async () => {
  let textarea = null
  let command = ''
  const documentRef = {
    body: {
      appendChild(node) {
        textarea = node
      },
    },
    createElement() {
      return {
        value: '',
        readOnly: false,
        style: {},
        selected: false,
        removed: false,
        select() { this.selected = true },
        remove() { this.removed = true },
      }
    },
    execCommand(value) {
      command = value
      return true
    },
  }
  const clipboard = {
    async writeText() {
      throw new Error('blocked')
    },
  }

  assert.equal(await copyPlainText('fallback', { clipboard, documentRef }), true)
  assert.equal(textarea.value, 'fallback')
  assert.equal(textarea.selected, true)
  assert.equal(textarea.removed, true)
  assert.equal(command, 'copy')
})

test('没有可用复制能力时返回失败', async () => {
  assert.equal(await copyPlainText('text', { clipboard: {}, documentRef: {} }), false)
})

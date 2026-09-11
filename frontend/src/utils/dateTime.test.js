import assert from 'node:assert/strict'
import test from 'node:test'

import { formatServerDateTime, parseServerDateTime } from './dateTime.js'

test('将 SQLite 无时区时间按 UTC 解析', () => {
  const date = parseServerDateTime('2026-09-11 03:17:22')

  assert.equal(date.toISOString(), '2026-09-11T03:17:22.000Z')
})

test('保留带时区的 ISO 时间含义', () => {
  const date = parseServerDateTime('2026-09-11T03:17:22.000Z')

  assert.equal(date.toISOString(), '2026-09-11T03:17:22.000Z')
})

test('按指定本地时区格式化服务器时间', () => {
  const formatted = formatServerDateTime('2026-09-11 03:17:22', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })

  assert.match(formatted, /2026\/9\/11 11:17:22/)
})

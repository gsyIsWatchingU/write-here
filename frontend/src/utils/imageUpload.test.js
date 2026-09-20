import { test } from 'node:test'
import assert from 'node:assert'
import {
  IMAGE_CONCURRENCY,
  filterImageFiles,
  readImageSize,
  uploadImageFiles,
} from './imageUpload.js'

function fakeFile(name, type, extra = {}) {
  return { name, type, ...extra }
}

test('只挑出图片文件，非图片被过滤', () => {
  const picked = filterImageFiles([
    fakeFile('a.png', 'image/png'),
    fakeFile('b.PNG', ''),
    fakeFile('notes.md', 'text/markdown'),
    null,
  ])
  assert.strictEqual(picked.length, 2)
})

test('读不到宽高时返回 0，不抛错', async () => {
  assert.deepStrictEqual(await readImageSize(fakeFile('a.png', 'image/png')), { width: 0, height: 0 })
})

test('读宽高走 objectURL 并在结束后释放', async () => {
  let revoked = 0
  const urlApi = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => { revoked += 1 },
  }
  class FakeImage {
    set src(value) { this._src = value }
    get src() { return this._src }
  }
  const size = await readImageSize(fakeFile('a.png', 'image/png'), {
    urlApi,
    ImageCtor: class extends FakeImage {
      constructor() { super(); setTimeout(() => this.onload(), 0) }
    },
  })
  assert.deepStrictEqual(size, { width: 0, height: 0 })
  assert.strictEqual(revoked, 1)
})

test('上传结果按原文件顺序返回，不受网络完成顺序影响', async () => {
  const delays = { a: 30, b: 5, c: 15 }
  const upload = (file) => new Promise((resolve) => {
    setTimeout(() => resolve({ url: `/uploads/${file.name}` }), delays[file.name])
  })

  const results = await uploadImageFiles(
    [fakeFile('a', 'image/png'), fakeFile('b', 'image/png'), fakeFile('c', 'image/png')],
    { readSize: async () => ({ width: 1, height: 1 }), upload }
  )

  assert.deepStrictEqual(results.map((r) => r.url), ['/uploads/a', '/uploads/b', '/uploads/c'])
})

test('单张失败不影响其它图片，失败项带可读错误', async () => {
  const upload = (file) => (file.name === 'bad'
    ? Promise.reject(new Error('只支持 PNG、JPEG、WebP 和 GIF 图片'))
    : Promise.resolve({ url: `/uploads/${file.name}` }))

  const results = await uploadImageFiles(
    [fakeFile('good', 'image/png'), fakeFile('bad', 'image/png')],
    { readSize: async () => ({ width: 0, height: 0 }), upload }
  )

  assert.strictEqual(results[0].ok, true)
  assert.strictEqual(results[1].ok, false)
  assert.match(results[1].error, /只支持/)
})

test('批量上限与并发上限生效', async () => {
  let inFlight = 0
  let peak = 0
  const files = Array.from({ length: 9 }, (_, i) => fakeFile(`f${i}`, 'image/png'))
  const upload = async () => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight -= 1
    return { url: '/uploads/x' }
  }

  const results = await uploadImageFiles(files, { readSize: async () => ({ width: 0, height: 0 }), upload })
  assert.strictEqual(results.length, 6, '超过 6 张的部分不上传')
  assert.ok(peak <= IMAGE_CONCURRENCY, `并发应不超过 ${IMAGE_CONCURRENCY}，实际 ${peak}`)
})

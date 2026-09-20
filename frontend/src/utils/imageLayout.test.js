import { test } from 'node:test'
import assert from 'node:assert'
import { imageFlexGrow, buildImageInsertion, toImageNode } from './imageLayout.js'
import { promoteInlineImages } from './legacyImageHtml.js'

test('同行图片按宽高比分配宽度，而不是按自然宽度', () => {
  // 两张都是正方形，宽度差 4 倍，但显示宽度应该一致
  assert.strictEqual(imageFlexGrow(500, 500), 1)
  assert.strictEqual(imageFlexGrow(2000, 2000), 1)
  // 横图更宽，竖图更窄
  assert.ok(imageFlexGrow(1600, 900) > imageFlexGrow(900, 1600))
})

test('极端长图被 clamp，不会把整行吃干净', () => {
  assert.strictEqual(imageFlexGrow(100, 2000), 0.2)
  assert.strictEqual(imageFlexGrow(2000, 100), 5)
  // 尺寸缺失时退化成等宽，不抛错
  assert.strictEqual(imageFlexGrow(0, 800), 1)
  assert.strictEqual(imageFlexGrow(null, undefined), 1)
  assert.strictEqual(imageFlexGrow('abc', 100), 1)
})

test('同行图片按宽高比分配后高度一致', () => {
  // 基准 0 + grow ∝ 宽高比 ⇒ w_i ∝ r_i ⇒ h_i = w_i / r_i 全部相等
  const a = { r: imageFlexGrow(642, 163), natural: 642 / 163 }
  const b = { r: imageFlexGrow(1857, 873), natural: 1857 / 873 }
  const rowWidth = 1376
  const heightOf = (x) => (rowWidth * x.r) / (a.r + b.r) / x.natural
  assert.ok(Math.abs(heightOf(a) - heightOf(b)) < 1, `${heightOf(a)} vs ${heightOf(b)}`)
})

test('单张插块级图片，多张合成图片组', () => {
  const one = buildImageInsertion([toImageNode({ url: '/uploads/a.png', width: 800, height: 600 })])
  assert.strictEqual(one.type, 'image')
  assert.strictEqual(one.attrs.align, 'center')
  assert.strictEqual(one.attrs.width, 800)

  const three = buildImageInsertion([
    toImageNode({ url: '/uploads/a.png' }),
    toImageNode({ url: '/uploads/b.png' }),
    toImageNode({ url: '/uploads/c.png' }),
  ])
  assert.strictEqual(three.type, 'imageGroup')
  assert.strictEqual(three.content.length, 3)

  assert.strictEqual(buildImageInsertion([]), null)
  assert.strictEqual(buildImageInsertion([null, undefined]), null)
})

test('只有图片的段落整体提升为块级图片', () => {
  assert.strictEqual(
    promoteInlineImages('<p><img src="/a.png" alt="x"></p>'),
    '<figure class="doc-image" data-align="center"><img src="/a.png" alt="x"></figure>'
  )
})

test('段落内多张图片提升为一个图片组（Markdown 导入的连续图片）', () => {
  const result = promoteInlineImages('<p><img src="/a.png">\n<img src="/b.png"></p>')
  assert.strictEqual(
    result,
    '<div class="doc-image-group" data-align="center">'
      + '<figure class="doc-image" data-align="center"><img src="/a.png"></figure>'
      + '<figure class="doc-image" data-align="center"><img src="/b.png"></figure>'
      + '</div>'
  )
})

test('图文混排按原顺序拆开：文字回段落，图片提升为块', () => {
  assert.strictEqual(
    promoteInlineImages('<p style="text-align: center">前文<img src="/a.png">后文</p>'),
    '<p style="text-align: center">前文</p>'
      + '<figure class="doc-image" data-align="center"><img src="/a.png"></figure>'
      + '<p style="text-align: center">后文</p>'
  )
})

test('没有图片的文档原样返回，重复迁移是幂等的', () => {
  const html = '<p>普通正文</p><ul><li><p>列表项</p></li></ul>'
  assert.strictEqual(promoteInlineImages(html), html)

  const once = promoteInlineImages('<p><img src="/a.png"></p>')
  assert.strictEqual(promoteInlineImages(once), once)
})

test('非字符串与空串安全返回', () => {
  assert.strictEqual(promoteInlineImages(''), '')
  assert.strictEqual(promoteInlineImages(null), '')
  assert.strictEqual(promoteInlineImages(undefined), '')
})

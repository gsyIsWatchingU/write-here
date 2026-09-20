// 旧文档里的图片是「行内节点」，只能写在段落里：<p><img src="..."></p>，
// 甚至和文字混排：<p>前文<img>后文</p>。
// 新 schema 下 image 是块级节点，塞不进段落，ProseMirror 解析时会把它静默丢掉。
// 所以在 setContent 之前先做一次提升：图片单独成块，文字保留为段落。
// 只在浏览器里跑（输入就是编辑器自己产出的 HTML），保持纯字符串处理，方便单测。

const PARAGRAPH_RE = /<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi
const IMG_TAG_RE = /<img\b[^>]*>/gi
const SPLIT_IMG_RE = /(<img\b[^>]*>)/gi
const BR_RE = /<br\s*\/?>/gi

function wrapImage(imgTag) {
  return `<figure class="doc-image" data-align="center">${imgTag}</figure>`
}

function stripInvisible(fragment) {
  return fragment
    .replace(BR_RE, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
}

/**
 * @param {string} html 编辑器 HTML（TipTap 或 markdown-it 产出）
 * @returns {string} 图片都已提升为块级节点的 HTML
 */
export function promoteInlineImages(html) {
  if (typeof html !== 'string' || html === '') return typeof html === 'string' ? html : ''
  if (!/<img\b/i.test(html)) return html

  return html.replace(PARAGRAPH_RE, (match, attrs = '', inner = '') => {
    if (!/<img\b/i.test(inner)) return match

    const images = inner.match(IMG_TAG_RE) || []
    if (images.length === 0) return match

    // 整段只有图片（可能有换行/空格/<br>）→ 整段提升
    if (stripInvisible(inner.replace(IMG_TAG_RE, '')) === '') {
      if (images.length === 1) return wrapImage(images[0])
      return `<div class="doc-image-group" data-align="center">${images.map(wrapImage).join('')}</div>`
    }

    // 图文混排 → 文字各回段落，图片逐个提升，保持原有先后顺序
    return inner
      .split(SPLIT_IMG_RE)
      .map((segment) => {
        if (!segment) return ''
        if (/^<img\b/i.test(segment)) return wrapImage(segment)
        if (stripInvisible(segment) === '') return ''
        return `<p${attrs || ''}>${segment}</p>`
      })
      .filter(Boolean)
      .join('')
  })
}

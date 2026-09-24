import { Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { imageFlexGrow } from '../utils/imageLayout'

export const IMAGE_ALIGNMENTS = ['left', 'center', 'right']

/**
 * 块级图片/图片组的鼠标点击稳定选中。
 *
 * 默认行为下，点击块级 atom 的渲染 DOM（figure.doc-image / .doc-image-group）
 * 常常把光标落到相邻段落里（posAtCoords 未命中 atom 的 point/inside），
 * 表现为「图片点不中」：此时按 Delete/Backspace 删的是相邻段落的文字，
 * 图片纹丝不动，用户误以为删除后图片又复活。
 *
 * 这里在 click 阶段把点击映射到节点位置并设置 NodeSelection，让选中稳定、可删。
 * 用 click 而非 mousedown 拦截：点击已选中节点或普通空白时不改变行为，
 * 也不影响基于 mousedown+move 的拖动。
 */
export function createBlockAtomClickSelectPlugin() {
  return new Plugin({
    key: new PluginKey('blockAtomClickSelect'),
    props: {
      handleClick(view, pos, event) {
        if (!view.editable || event.button !== 0) return false

        const target = event.target
        if (!(target instanceof HTMLElement)) return false

        const nodeElement = target.closest?.('figure.doc-image, .doc-image-group')
        if (!nodeElement || !view.dom.contains(nodeElement)) return false

        const nodePos = view.posAtDOM(nodeElement, 0)
        if (nodePos === null || nodePos < 0) return false

        const node = view.state.doc.nodeAt(nodePos)
        if (!node) return false
        if (node.type.name !== 'image' && node.type.name !== 'imageGroup') return false

        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        view.focus()
        return true
      },
    },
  })
}

/**
 * 块级 atom 节点（图片/图片组）被 NodeSelection 选中时按 Enter：
 * 在节点后面已有文本块就把光标放进去，否则插入一个空段落并聚焦。
 * 不处理时按 Enter 毫无反应，用户被 atom 节点"困住"无法继续输入。
 */
function exitBlockAtomAfterEnter(editor) {
  const { state } = editor
  const { selection, doc } = state

  if (!(selection instanceof NodeSelection)) return false
  const afterPos = selection.to
  const $after = doc.resolve(afterPos)
  const nextNode = $after.nodeAfter

  const chain = editor.chain().focus()

  // 后面紧跟文本块：直接把光标放到它开头
  if (nextNode && nextNode.isTextblock) {
    chain.setTextSelection(afterPos + 1).run()
    return true
  }

  // 否则在 atom 后面插入一个空段落
  chain
    .insertContentAt(afterPos, { type: 'paragraph' })
    .setTextSelection(afterPos + 1)
    .run()
  return true
}

function normalizeAlign(value) {
  const raw = String(value || '').trim().toLowerCase()
  return IMAGE_ALIGNMENTS.includes(raw) ? raw : 'center'
}

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 文档图片：块级节点（原来是行内的，只能蜷在段落里，无法独立居中）。
 *
 * 渲染成 `<figure class="doc-image"><img></figure>`：
 * - `data-align` 默认 center，对齐是图片自己的属性，不再依赖所在段落；
 * - `width` / `height` 写在 img 上，浏览器据此预留宽高比，图片加载时不抖；
 * - `--doc-image-ratio` 供图片组按宽高比分配同行宽度。
 */
export const DocImage = Image.extend({
  name: 'image',

  inline() {
    return false
  },

  group() {
    return 'block'
  },

  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      // 旧文档里可能残留 base64 图片：宁可让它显示出来，也不要静默消失
      allowBase64: true,
      HTMLAttributes: {},
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => exitBlockAtomAfterEnter(this.editor),
    }
  },

  addProseMirrorPlugins() {
    return [createBlockAtomClickSelectPlugin()]
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      // 宽高只作为布局提示，由 CSS 决定最终显示尺寸
      width: {
        default: null,
        parseHTML: (element) => toPositiveInt(element.getAttribute('width')),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: (element) => toPositiveInt(element.getAttribute('height')),
        renderHTML: () => ({}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => normalizeAlign(element.getAttribute('data-align')),
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure.doc-image',
        getAttrs: (element) => {
          const img = element.querySelector('img[src]')
          const src = img?.getAttribute('src')
          if (!src) return false
          return {
            src,
            alt: img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: toPositiveInt(img.getAttribute('width')),
            height: toPositiveInt(img.getAttribute('height')),
            align: normalizeAlign(element.getAttribute('data-align')),
          }
        },
      },
      // 兼容历史行内图片与 Markdown 导入：`<img>` 直接出现在块级位置
      { tag: 'img[src]' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { width, height, align } = node.attrs
    const imgAttrs = { ...HTMLAttributes }
    if (width) imgAttrs.width = width
    if (height) imgAttrs.height = height

    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, {
        class: 'doc-image',
        'data-align': normalizeAlign(align),
        style: `--doc-image-ratio:${imageFlexGrow(width, height)}`,
      }),
      ['img', mergeAttributes(imgAttrs, { draggable: 'false' })],
    ]
  },
})

/**
 * 图片组：同一次多选 / 粘贴的多张图片合成一个块，同行自适应布局。
 *
 * 为什么用容器节点而不是「相邻就分一组」的 CSS：相邻即分组会把布局语义塞给 CSS，
 * 别人在两张图中间插一句话，布局就悄悄从「双图」变成两个单图，协同下非常隐晦。
 * 容器里 `image*` 而不是 `image+`：Yjs 并发删除时可能瞬时变成空组，
 * `+` 会让结构非法并被绑定层重塑，数量上限交给业务层，不写进 schema。
 */
export const ImageGroup = Node.create({
  name: 'imageGroup',
  group: 'block',
  content: 'image*',
  isolating: true,
  draggable: true,

  addKeyboardShortcuts() {
    return {
      Enter: () => exitBlockAtomAfterEnter(this.editor),
    }
  },

  addAttributes() {
    return {
      align: {
        default: 'center',
        parseHTML: (element) => normalizeAlign(element.getAttribute('data-align')),
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div.doc-image-group' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'doc-image-group',
        'data-align': normalizeAlign(node.attrs.align),
        'data-count': String(node.childCount),
      }),
      0,
    ]
  },
})

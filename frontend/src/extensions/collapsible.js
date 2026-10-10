import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * 点击箭头（或箭头区域）切换折叠块 open 状态。
 *
 * 折叠块结构是纯容器渲染（renderHTML 只输出带 hole 的 div），不用 NodeView：
 * 箭头是 summary 行里 contenteditable=false 的 span，点击事件在这里拦截，
 * 通过 posAtDOM 定位容器节点后 setNodeMarkup 翻转 open 属性。
 */
function createCollapsibleTogglePlugin() {
  return new Plugin({
    key: new PluginKey('collapsibleToggle'),
    props: {
      handleClick(view, pos, event) {
        if (!(event.target instanceof HTMLElement)) return false
        if (!event.target.closest('.doc-collapsible-arrow')) return false

        const container = event.target.closest('[data-collapsible]')
        if (!container || !view.dom.contains(container)) return false

        const nodePos = view.posAtDOM(container, 0)
        if (nodePos == null || nodePos < 0) return false
        const node = view.state.doc.nodeAt(nodePos)
        if (!node || node.type.name !== 'collapsible') return false

        const tr = view.state.tr.setNodeMarkup(nodePos, null, {
          ...node.attrs,
          open: !node.attrs.open,
        })
        view.dispatch(tr)
        view.focus()
        return true
      },
    },
  })
}

/**
 * 折叠块标题行：内联文字 + 前面的箭头。
 *
 * 不设 group：它只能作为 collapsible 的第一个子节点出现（由 collapsible 的
 * content 表达式显式约束），放到顶层会让 schema 校验失败而被重塑。
 */
export const CollapsibleSummary = Node.create({
  name: 'collapsibleSummary',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'p.doc-collapsible-summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, { class: 'doc-collapsible-summary' }),
      ['span', { class: 'doc-collapsible-arrow', contenteditable: 'false' }, ''],
      0,
    ]
  },
})

/**
 * 飞书式折叠块（toggle block）：
 *
 * 结构：`<div data-collapsible data-open>` 内含一个标题行（CollapsibleSummary）
 * 和任意数量的内容块。折叠时 CSS 隐藏所有非标题行的子元素；open 作为节点属性
 * 随 HTML 持久化、随 Yjs 协同同步。
 */
export const Collapsible = Node.create({
  name: 'collapsible',
  group: 'block',
  // 用 * 而非 +：Yjs 并发删除内容块时可能瞬时变空，+ 会让结构非法并被重塑
  content: 'collapsibleSummary block*',
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes) => ({ 'data-open': attributes.open ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-collapsible]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-collapsible': '' }), 0]
  },

  addProseMirrorPlugins() {
    return [createCollapsibleTogglePlugin()]
  },

  addCommands() {
    return {
      insertCollapsible:
        () => ({ commands }) =>
          commands.insertContent({
            type: 'collapsible',
            content: [
              { type: 'collapsibleSummary' },
              { type: 'paragraph' },
            ],
          }),
    }
  },

  addKeyboardShortcuts() {
    return {
      // 标题行按 Enter：跳出折叠块，在容器后面新建段落并聚焦
      Enter: () => {
        if (!this.editor.isActive('collapsibleSummary')) return false
        const { $from } = this.editor.state.selection
        // 文本位于 summary 内时 $from.depth = collapsible 层 +1，
        // $from.after(depth - 1) 即整个 collapsible 结束位置
        const after = $from.after($from.depth - 1)
        this.editor.chain().focus()
          .insertContentAt(after, { type: 'paragraph' })
          .setTextSelection(after + 1)
          .run()
        return true
      },
    }
  },
})

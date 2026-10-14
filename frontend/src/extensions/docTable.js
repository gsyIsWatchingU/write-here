import Table from '@tiptap/extension-table'
import { TableView, tableEditingKey } from '@tiptap/pm/tables'
import {
  TABLE_WIDTH_ATTRIBUTE,
  normalizeTableWidthMode,
} from '../utils/tableWidth.js'

/**
 * 表格 NodeView：把宽度模式写成 <table data-table-width="...">。
 *
 * 基类每次 update 都会按 colgroup 的列宽重写 `table.style.width` /
 * `table.style.min-width`（prosemirror-tables 的 updateColumnsOnResize），
 * 所以模式只能落在 data 属性上，再由 CSS 用 !important 压住内联宽度
 * ——直接写内联 style 会在下一次 update 被覆盖掉。
 *
 * 基类 `ignoreMutation` 对 `<table>` 上的属性变更返回 true，因此这里
 * setAttribute 不会被 ProseMirror 当成用户输入重新解析，不会触发回环。
 */
export class TableWidthView extends TableView {
  constructor(node, cellMinWidth, view) {
    super(node, cellMinWidth)
    this.applyWidthMode(node)
  }

  update(node) {
    const updated = super.update(node)
    if (!updated) return false
    this.applyWidthMode(node)
    return true
  }

  applyWidthMode(node) {
    if (!this.table) return
    this.table.setAttribute(
      TABLE_WIDTH_ATTRIBUTE,
      normalizeTableWidthMode(node?.attrs?.widthMode),
    )
  }
}

/**
 * 文档里的表格节点：`Table` 加上宽度模式属性和宽度感知的 NodeView。
 *
 * Editor.vue / SharedDoc.vue 直接用它替换 `Table.configure({ resizable: true })`；
 * 两条 columnResizing 注册路径（Table 自己注册的、以及编辑器初始不可编辑时
 * extensions/resizableTable.js 补注册的）都要带上同一个 View，否则实时渲染
 * 里拿不到 data-table-width，只会退化成 CSS 默认的 100% 宽度。
 */
export const DocTable = Table.extend({
  addAttributes() {
    return {
      widthMode: {
        default: 'full',
        // 粘贴或导入带 data-table-width 的 HTML 时按同名属性读回。
        parseHTML: (element) => normalizeTableWidthMode(
          element.getAttribute(TABLE_WIDTH_ATTRIBUTE),
        ),
        renderHTML: (attributes) => ({
          [TABLE_WIDTH_ATTRIBUTE]: normalizeTableWidthMode(attributes.widthMode),
        }),
      },
    }
  },

  /**
   * 包装 tableEditing 插件的 mousedown：让普通拖选走浏览器原生连续文字。
   *
   * prosemirror-tables 的 tableEditing 插件默认在单元格内 mousedown 时挂
   * mousemove 监听，鼠标一旦拖出起始单元格就派发 CellSelection（整块单元格
   * 高亮），覆盖浏览器原生的连续文字拖选——用户想跨列选中一段文字复制时
   * 被打断，表现为"多列无法同时拖选"。
   *
   * 这里分三种情况：
   * 1. `view.editable === false`（SharedDoc 只读分享页、Editor 拿到权限前
   *    的窗口期）：一律放行，浏览器原生跨格文字选中。
   * 2. 可编辑但**普通拖选（无 Shift）**：不注册 CellSelection 的 mousemove
   *    监听，让跨格拖选走浏览器原生连续文字选中（用于跨列复制文字）。
   * 3. 可编辑且 **Shift+mousedown**：走原 prosemirror-tables 逻辑，扩展
   *    CellSelection（整块单元格选中，用于批量删除/合并单元格）。
   *
   * 原 CellSelection 的键盘操作（方向键跨格、Delete 删除单元格等）由
   * handleKeyDown 处理，不受影响。
   */
  addProseMirrorPlugins() {
    // 注意：tiptap v2 的扩展方法存放在 extension.config 里，getExtensionField
    // 会把 this 绑定为「当前扩展上下文 + this.parent」，所以这里不能写
    // super.addProseMirrorPlugins()——config 对象字面量里的 super 指向
    // Object.prototype，运行时会直接抛 "super.addProseMirrorPlugins is not a
    // function"。正确做法是调用基类 Table.config 里的实现（this 已由 tiptap
    // 绑定，this.options 即 DocTable 配置后的选项，含 resizable/View）。
    const plugins = Table.config.addProseMirrorPlugins.call(this)
    return plugins.map((plugin) => {
      // 必须用引用比较 tableEditingKey：这个版本的 PluginKey 实例属性是
      // `.key`（值为 "selectingCells$"），不是 `.name`；之前按 `.name` 判断
      // 永远 undefined，包装代码从未执行。columnResizing 插件的 key 是
      // columnResizingPluginKey，不会被误包装。
      if (plugin.spec.key !== tableEditingKey) return plugin
      const origHandleDOMEvents = plugin.spec.props?.handleDOMEvents
      const origMouseDown = origHandleDOMEvents?.mousedown
      if (!origMouseDown) return plugin
      plugin.spec.props.handleDOMEvents = {
        ...origHandleDOMEvents,
        mousedown: (view, event) => {
          // 只读一律放行；可编辑时只有 Shift+mousedown 才走原 CellSelection
          // 扩展逻辑，普通拖选放行给浏览器原生连续文字选中。
          if (!view.editable || !event.shiftKey) return false
          return origMouseDown(view, event)
        },
      }
      return plugin
    })
  },
}).configure({
  resizable: true,
  View: TableWidthView,
})

export default DocTable

import Table from '@tiptap/extension-table'
import { TableView } from '@tiptap/pm/tables'
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
}).configure({
  resizable: true,
  View: TableWidthView,
})

export default DocTable

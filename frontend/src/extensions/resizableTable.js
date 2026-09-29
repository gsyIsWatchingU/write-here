import { Extension } from '@tiptap/core'
import { columnResizing } from '@tiptap/pm/tables'
import { TableWidthView } from './docTable.js'

/**
 * 补注册表格列宽拖拽插件。
 *
 * `@tiptap/extension-table` 的 addProseMirrorPlugins 里是：
 *   const isResizable = this.options.resizable && this.editor.isEditable
 * 插件只在 editor 创建那一刻注册一次。Editor 和 SharedDoc 为了等权限确认，
 * 初始 editable 是 false、拿到权限后再 setEditable(true)，于是
 * columnResizing 插件和表格 NodeView（.tableWrapper 外层 + 随拖拽更新的
 * <colgroup>）根本没被注册；setEditable(true) 只改 contenteditable 属性，
 * 不会重建插件 —— 表现就是列宽永远拖不动、列边界也没有拖拽手柄。
 *
 * 这里在同一时机补一次：
 * - 创建时不可编辑（正是上面这种场景）：返回 columnResizing；
 * - 创建时可编辑（Table 自己会注册）：返回空数组，避免重复注册两个插件。
 *
 * 注册顺序要排在 Table 之前，让 columnResizing 先于 tableEditing 处理
 * mousedown，与 tiptap 官方插件顺序一致。
 */
export const ResizableTable = Extension.create({
  name: 'resizableTable',

  addProseMirrorPlugins() {
    if (this.editor.isEditable) return []

    // 参数与 tiptap 的 Table 默认值对齐：cellMinWidth 25 是单列最小宽度，
    // defaultCellMinWidth 决定 <table> 的 min-width（不传时 prosemirror-tables
    // 默认 100，7 列表格就会算出 700px 的 min-width，比正文区还宽、强出横向滚动条）。
    return [
      columnResizing({
        handleWidth: 6,
        cellMinWidth: 25,
        defaultCellMinWidth: 25,
        lastColumnResizable: true,
        // 与 Table 的 View 配置保持一致：宽度模式靠 NodeView 写成
        // <table data-table-width="...">，漏传会退化成默认的铺满宽度。
        View: TableWidthView,
      }),
    ]
  },
})

export default ResizableTable

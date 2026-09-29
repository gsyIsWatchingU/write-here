// 表格宽度模式的取值与换算。
//
// 模式存在 table 节点的 `widthMode` 属性上，随 Yjs 同步给所有协作者；
// 实时渲染由表格 NodeView 写成 <table data-table-width="...">，导出/粘贴的
// HTML 由属性自己的 renderHTML 输出同一个属性，两条路径共用一套 CSS。

export const TABLE_WIDTH_FULL = 'full'
export const TABLE_WIDTH_AUTO = 'auto'
export const TABLE_WIDTH_ATTRIBUTE = 'data-table-width'

export const TABLE_WIDTH_OPTIONS = [
  { id: TABLE_WIDTH_FULL, label: '适应窗口宽度' },
  { id: TABLE_WIDTH_AUTO, label: '适应内容' },
]

// 老文档没有这个属性，默认按窗口宽度铺满——与加属性之前 `#app .editor-content
// table { width: 100% }` 的表现一致。
export function normalizeTableWidthMode(value) {
  return value === TABLE_WIDTH_AUTO ? TABLE_WIDTH_AUTO : TABLE_WIDTH_FULL
}

export function isTableNode(node) {
  return Boolean(node?.type && node.type.name === 'table')
}

export function getTableWidthMode(node) {
  return normalizeTableWidthMode(node?.attrs?.widthMode)
}

export function getTableWidthLabel(mode) {
  const option = TABLE_WIDTH_OPTIONS.find((item) => item.id === normalizeTableWidthMode(mode))
  return option ? option.label : TABLE_WIDTH_OPTIONS[0].label
}

// 返回 setNodeMarkup 需要的新 attrs；非表格或模式没变时返回 null，调用方直接跳过，
// 避免为「点当前选中的模式」也发一次事务（协同场景下会广播一次空更新）。
export function getTableWidthAttrs(node, mode) {
  if (!isTableNode(node)) return null

  const nextMode = normalizeTableWidthMode(mode)
  if (getTableWidthMode(node) === nextMode) return null

  return { ...node.attrs, widthMode: nextMode }
}

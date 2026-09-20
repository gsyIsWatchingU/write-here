// 文档插图的布局计算：多图同行时按「宽高比」分配宽度，让同行图片的高度趋于一致。
// 只按自然宽度分配是错的——两张都是正方形时，500×500 和 2000×2000 会被分成 1:4，
// 视觉上毫无理由。真正该按的是宽高比：
//   行宽 W，第 i 张宽度 w_i = W · r_i / Σr，高度 h_i = w_i / r_i = W / Σr —— 同行等高。
// clamp 只兜底尺寸缺失和 1:5 ~ 5:1 之外的极端长图，避免一张图把整行吃干净。

export const MIN_IMAGE_RATIO = 0.2
export const MAX_IMAGE_RATIO = 5

export function imageFlexGrow(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1
  const ratio = w / h
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  return Math.round(Math.min(MAX_IMAGE_RATIO, Math.max(MIN_IMAGE_RATIO, ratio)) * 100) / 100
}

/**
 * 把上传结果转成要插入的 ProseMirror 节点描述。
 * 单张 → 块级图片；多张 → 一个图片组（同行自适应）。
 */
export function buildImageInsertion(items) {
  const list = items.filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  return { type: 'imageGroup', attrs: { align: 'center' }, content: list }
}

export function toImageNode({ url, width, height, alt = '' }) {
  return {
    type: 'image',
    attrs: {
      src: url,
      alt,
      width: Number(width) > 0 ? Math.round(Number(width)) : null,
      height: Number(height) > 0 ? Math.round(Number(height)) : null,
      align: 'center',
    },
  }
}

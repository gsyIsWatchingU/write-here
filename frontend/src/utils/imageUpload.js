// 不直接 import api：api.js 依赖 Vite 的 import.meta.env，在 `node --test` 下会直接炸。
// 上传实现由调用方注入，这个模块保持纯逻辑可测。

// 单张上限与后端一致（10 MB）；批量上限是 UI 约束：飞书一行最多 6 张，
// 再多就另起一组，不然一行挤十几张没有任何可读性。
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const IMAGE_MAX_PER_BATCH = 6
// 并发压到 3：express.raw 会把整张图读进内存，几十张一起 POST 相当于自己发起一次 DoS
export const IMAGE_CONCURRENCY = 3

export function isImageFile(file) {
  if (!file) return false
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(String(file.name || ''))
}

export function filterImageFiles(files) {
  return Array.from(files || []).filter(isImageFile)
}

export function describeUploadError(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  return message || '图片上传失败'
}

/**
 * 读取图片自然宽高。只在浏览器里真的读；拿不到就返回 0，由 CSS 兜底等宽布局。
 */
export async function readImageSize(file, options = {}) {
  const urlApi = options.urlApi || (typeof URL !== 'undefined' ? URL : null)
  const ImageCtor = options.ImageCtor || (typeof Image !== 'undefined' ? Image : null)
  if (!file || !urlApi?.createObjectURL || !ImageCtor) return { width: 0, height: 0 }

  const url = urlApi.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const image = new ImageCtor()
      image.onload = () => resolve({
        width: Number(image.naturalWidth || image.width) || 0,
        height: Number(image.naturalHeight || image.height) || 0,
      })
      image.onerror = () => resolve({ width: 0, height: 0 })
      image.src = url
    })
  } finally {
    urlApi.revokeObjectURL?.(url)
  }
}

/**
 * 批量上传并**按原文件顺序**返回结果。
 * 网络完成顺序是乱的（C A D B），但插入顺序必须是用户选择的 A B C D。
 */
export async function uploadImageFiles(files, options = {}) {
  const {
    maxFiles = IMAGE_MAX_PER_BATCH,
    concurrency = IMAGE_CONCURRENCY,
    readSize = readImageSize,
    upload = null,
  } = options

  if (typeof upload !== 'function') throw new Error('缺少上传实现：请传入 upload(file, size)')

  const list = Array.from(files || []).slice(0, maxFiles)
  const results = new Array(list.length)
  let cursor = 0

  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return

      const file = list[index]
      try {
        const size = await readSize(file)
        const data = await upload(file, size)
        results[index] = {
          ok: true,
          file,
          url: data?.url || '',
          width: Number(data?.width) > 0 ? Number(data.width) : size.width,
          height: Number(data?.height) > 0 ? Number(data.height) : size.height,
          deduped: Boolean(data?.deduped),
        }
      } catch (error) {
        results[index] = { ok: false, file, name: file?.name || '图片', error: describeUploadError(error) }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, () => worker())
  )
  return results
}

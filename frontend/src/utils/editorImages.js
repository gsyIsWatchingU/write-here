import { buildImageInsertion, toImageNode } from './imageLayout'
import { IMAGE_MAX_PER_BATCH, filterImageFiles, uploadImageFiles } from './imageUpload'
import { api } from './api'

const uploadToServer = (file, size) => api.uploadImage(file, size)

/**
 * 上传并插入图片的统一入口：工具栏多选、粘贴、拖放都走这里。
 *
 * 顺序：上传 → 拿到最终 URL → 一次事务插入。
 * 不先插 blob:/base64 占位再替换：blob: 只对上传者当前页面有效，
 * 协作者收到节点就是坏图；base64 还会把大量二进制塞进 Yjs。
 */
export async function insertUploadedImages(editor, files, options = {}) {
  const { onStatus = () => {}, maxFiles = IMAGE_MAX_PER_BATCH, upload = uploadImageFiles } = options

  const list = filterImageFiles(files).slice(0, maxFiles)
  if (list.length === 0) {
    onStatus({ type: 'empty' })
    return 0
  }
  if (!editor || editor.isDestroyed || !editor.isEditable) {
    onStatus({ type: 'error', text: '当前文档不可编辑' })
    return 0
  }

  onStatus({ type: 'pending', text: `正在上传 ${list.length} 张图片…` })
  const results = await upload(list, { maxFiles, upload: uploadToServer })
  const succeeded = results.filter((item) => item.ok && item.url)
  const failed = results.filter((item) => !item.ok || !item.url)

  if (succeeded.length > 0) {
    const content = buildImageInsertion(succeeded.map((item) => toImageNode(item)))
    if (content) editor.chain().focus().insertContent(content).run()
  }

  if (failed.length > 0) {
    const detail = failed.length === list.length
      ? failed[0].error || '图片上传失败'
      : `${failed.length} 张上传失败：${failed[0].error || '请重试'}`
    onStatus({ type: 'error', text: detail })
  } else if (succeeded.length > 1) {
    onStatus({ type: 'success', text: `已插入 ${succeeded.length} 张图片` })
  } else {
    onStatus({ type: 'success', text: '已插入图片' })
  }

  return succeeded.length
}

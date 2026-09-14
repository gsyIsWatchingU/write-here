export async function copyPlainText(text, options = {}) {
  const value = String(text ?? '')
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard
  const documentRef = options.documentRef ?? globalThis.document

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value)
      return true
    } catch {
      // Clipboard API 可能被浏览器策略拦截，继续尝试兼容方案。
    }
  }

  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') {
    return false
  }

  const textarea = documentRef.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  documentRef.body.appendChild(textarea)
  textarea.select()

  try {
    return documentRef.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

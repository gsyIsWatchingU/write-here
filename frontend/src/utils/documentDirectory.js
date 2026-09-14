export function filterDocumentDirectory(documents, keyword) {
  const normalizedKeyword = String(keyword || '').trim().toLocaleLowerCase('zh-CN')
  if (!normalizedKeyword) return documents

  return documents.filter(document => {
    const searchableText = `${document.title || ''} ${document.username || ''}`
      .toLocaleLowerCase('zh-CN')
    return searchableText.includes(normalizedKeyword)
  })
}

export function reorderDocumentDirectory(documents, movedId, targetId, placement = 'before') {
  const movedIndex = documents.findIndex(document => String(document.id) === String(movedId))
  if (movedIndex < 0 || String(movedId) === String(targetId)) return documents

  const reordered = [...documents]
  const [movedDocument] = reordered.splice(movedIndex, 1)
  const targetIndex = reordered.findIndex(document => String(document.id) === String(targetId))
  if (targetIndex < 0) return documents

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex
  reordered.splice(insertIndex, 0, movedDocument)
  return reordered
}

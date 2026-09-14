export function filterDocumentDirectory(documents, keyword) {
  const normalizedKeyword = String(keyword || '').trim().toLocaleLowerCase('zh-CN')
  if (!normalizedKeyword) return documents

  return documents.filter(document => {
    const searchableText = `${document.title || ''} ${document.username || ''}`
      .toLocaleLowerCase('zh-CN')
    return searchableText.includes(normalizedKeyword)
  })
}

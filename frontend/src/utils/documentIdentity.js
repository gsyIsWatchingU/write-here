export function getDocumentIdentifier(document) {
  if (document && typeof document === 'object') {
    return document.publicId || document.id
  }
  return document
}

export function getDocumentPath(document) {
  return `/doc/${encodeURIComponent(getDocumentIdentifier(document))}`
}

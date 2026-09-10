const ESCAPED_BLOCK_MARKERS = [
  /^( {0,3})\\(#{1,6})(?=[ \t]+|$)/,
  /^( {0,3})\\(>)(?=[ \t]+|$)/,
  /^( {0,3})\\([*+-])(?=[ \t]+)/,
  /^( {0,3}\d{1,9})\\([.)])(?=[ \t]+)/,
]

function restoreEscapedBlockMarker(line) {
  for (const pattern of ESCAPED_BLOCK_MARKERS) {
    if (pattern.test(line)) return line.replace(pattern, '$1$2')
  }
  return line
}

export function normalizeImportedMarkdown(markdown) {
  let fenceMarker = null

  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/)

      if (fenceMarker) {
        const closesFence = fence
          && fence[1][0] === fenceMarker[0]
          && fence[1].length >= fenceMarker.length
          && /^[ \t]*$/.test(line.slice(fence[0].length))
        if (closesFence) fenceMarker = null
        return line
      }

      if (fence) {
        fenceMarker = fence[1]
        return line
      }

      return restoreEscapedBlockMarker(line)
    })
    .join('\n')
}

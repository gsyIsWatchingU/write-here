const UTC_WITHOUT_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/

export function parseServerDateTime(value) {
  if (value instanceof Date || typeof value === 'number') return new Date(value)
  if (typeof value !== 'string') return new Date(NaN)

  const normalizedValue = UTC_WITHOUT_OFFSET_PATTERN.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value

  return new Date(normalizedValue)
}

export function formatServerDateTime(value, options) {
  if (!value) return ''

  const date = parseServerDateTime(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('zh-CN', options)
}

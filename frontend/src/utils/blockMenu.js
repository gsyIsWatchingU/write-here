export function getBlockMenuAnchor(selection) {
  const $from = selection?.$from
  if (!$from || $from.depth < 1) return null
  return $from
}

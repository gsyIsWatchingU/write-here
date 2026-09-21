// 全站导航项的唯一来源。
// 此前 4 个页面（Home/Problems/Community/Admin）各手写一份导航栏，
// 编号和入口互相漂移：社区页缺「题库」、题库页缺「文档管理」。
// 新增页面只在这里加一项，编号由 resolveNavItems 按可见顺序生成。
export const NAV_ITEMS = [
  { name: 'Home', label: '我的文档', path: '/' },
  { name: 'Problems', label: '题库', path: '/problems' },
  { name: 'Community', label: '社区', path: '/community' },
  { name: 'Admin', label: '文档管理', path: '/admin', adminOnly: true },
]

/**
 * 按当前用户权限算出可见导航项，并生成 `[01]` 形式的序号。
 *
 * 序号刻意不硬编码：硬编码正是这次漂移的直接来源（题库插入后
 * Home 改成 [01]~[04]，另外三个页面仍是旧的 [01]~[03]）。
 * 序号只对可见项递增，非管理员看到 [01][02][03]，管理员看到 [01][02][03][04]。
 */
export function resolveNavItems(user) {
  const isAdmin = Boolean(user?.isAdmin)
  return NAV_ITEMS
    .filter((item) => !item.adminOnly || isAdmin)
    .map((item, index) => ({ ...item, index: index + 1 }))
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV_ITEMS, resolveNavItems } from './navigation.js'

test('管理员能看到全部导航项，非管理员看不到文档管理', () => {
  const adminNames = resolveNavItems({ isAdmin: true }).map((item) => item.name)
  const userNames = resolveNavItems({ isAdmin: false }).map((item) => item.name)

  assert.deepEqual(adminNames, ['Home', 'Community', 'Admin'])
  assert.deepEqual(userNames, ['Home', 'Community'])
})

test('编号按可见项顺序自动生成，不随硬编码漂移', () => {
  const adminIndexes = resolveNavItems({ isAdmin: true }).map((item) => item.index)
  const userIndexes = resolveNavItems({ isAdmin: false }).map((item) => item.index)

  assert.deepEqual(adminIndexes, [1, 2, 3])
  assert.deepEqual(userIndexes, [1, 2])
})

test('每一项都带路由 name 与 path，供 active 判定与跳转使用', () => {
  for (const item of resolveNavItems({ isAdmin: true })) {
    assert.equal(typeof item.name, 'string')
    assert.ok(item.name.length > 0)
    assert.equal(typeof item.path, 'string')
    assert.ok(item.path.startsWith('/'))
  }
})

test('user 为空时按非管理员处理，不抛错', () => {
  assert.deepEqual(resolveNavItems(null).map((item) => item.name), ['Home', 'Community'])
  assert.deepEqual(resolveNavItems(undefined).map((item) => item.index), [1, 2])
})

test('导航项 path 唯一，避免两项指向同一路由', () => {
  const paths = NAV_ITEMS.map((item) => item.path)
  assert.equal(new Set(paths).size, paths.length)
})

test('导航项 name 与前端路由表保持一致', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const routerSource = readFileSync(
    fileURLToPath(new URL('../router/index.js', import.meta.url)),
    'utf8',
  )
  const declaredNames = [...routerSource.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(declaredNames.length > 0, '未能从路由表解析出任何 name')

  for (const item of NAV_ITEMS) {
    assert.ok(declaredNames.includes(item.name), `导航项 ${item.name} 在路由表中不存在`)
  }
})

test('导航项 path 与路由表声明的 path 一致', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const routerSource = readFileSync(
    fileURLToPath(new URL('../router/index.js', import.meta.url)),
    'utf8',
  )
  for (const item of NAV_ITEMS) {
    assert.ok(
      routerSource.includes(`path: '${item.path}'`),
      `导航项 ${item.name} 的 path ${item.path} 在路由表中不存在`,
    )
  }
})

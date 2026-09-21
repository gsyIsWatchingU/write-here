// 退出登录行为的回归测试。
// 背景：曾出现「点击退出没反应」——退出按钮看起来完全没作用。
// 实测（无头 Chrome + CDP 复现）确认有两条独立成因，这里各锁一组不变式：
//   1. 四个页面的 handleLogout 都 `await clearUser()` 之后才跳转，而 clearUser
//      内部 await 了 /logout 网络请求。后端卡住/离线时永远走不到 router.push，
//      表现就是点了没反应。
//   2. 即使跳到了 /login，Login 的 onMounted 还会调一次 /me；若服务端会话
//      尚未失效（/logout 失败、或 cookie 未及时清除），会被 setUser+replace('/')
//      弹回首页，看起来同样像「没反应」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = join(here, '..', '..')
const read = (rel) => readFileSync(join(frontendRoot, rel), 'utf8')

// 从源码里取出一个顶层函数的完整函数体（按行匹配到下一次顶格 `}` 为止）
function extractFunction(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, `未找到函数：${signature}`)
  const rest = source.slice(start)
  const end = rest.indexOf('\n}')
  assert.ok(end >= 0, `未找到函数结尾：${signature}`)
  return rest.slice(0, end + 2)
}

test('clearUser 先清本地凭据，再尝试通知服务端', () => {
  const body = extractFunction(read('src/utils/api.js'), 'export async function clearUser')
  // 去掉注释行再比较：注释里也提到了 /logout，直接 indexOf 会命中注释而非真实代码
  const code = body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

  const clearAt = code.indexOf("localStorage.removeItem('currentUser')")
  const fetchAt = code.indexOf('/logout')

  assert.ok(clearAt >= 0, 'clearUser 必须清除本地 currentUser')
  assert.ok(fetchAt >= 0, 'clearUser 应向服务端发 /logout')
  assert.ok(
    clearAt < fetchAt,
    '本地凭据必须先于 /logout 请求清除，否则请求失败时会残留登录态',
  )
})

test('clearUser 不因 /logout 失败而抛出', () => {
  const body = extractFunction(read('src/utils/api.js'), 'export async function clearUser')

  assert.ok(!/finally/.test(body), '不应依赖 finally —— 它不吞异常，反而会把失败抛给调用方')
  assert.ok(/catch\s*\(/.test(body), '必须 catch 网络失败，把退出降级为本地登出')
})

test('TopNav 的 handleLogout 不等网络请求', () => {
  const body = extractFunction(read('src/components/TopNav.vue'), 'function handleLogout')

  assert.ok(
    !/await\s+clearUser/.test(body),
    'handleLogout 不能 await clearUser —— 后端卡住会让退出按钮完全没反应',
  )
  assert.ok(/router\.push\('\/login'\)/.test(body), 'handleLogout 必须跳转登录页')
})

test('登录页对主动退出不再做自动跳回首页', () => {
  const source = read('src/views/Login.vue')

  assert.ok(
    /consumeLoggedOutFlag/.test(source),
    'Login 必须消费退出标记，否则会拿残留会话把用户弹回首页',
  )

  const mountStart = source.indexOf('onMounted(async () => {')
  assert.ok(mountStart >= 0, 'Login 应有 onMounted 自动登录逻辑')
  const guardAt = source.indexOf('consumeLoggedOutFlag()', mountStart)
  const meAt = source.indexOf('api.me()', mountStart)

  assert.ok(guardAt >= 0, 'onMounted 内必须检查退出标记')
  assert.ok(
    meAt < 0 || guardAt < meAt,
    '退出标记必须在调用 /me 之前判断，否则请求已发出、跳转已排队',
  )
})

test('退出标记在重新登录后被消费掉', () => {
  const body = extractFunction(read('src/utils/api.js'), 'export function setUser')
  assert.ok(
    /sessionStorage\.removeItem\(LOGOUT_FLAG\)/.test(body),
    'setUser 需清除退出标记，否则会粘住后续会话',
  )
})

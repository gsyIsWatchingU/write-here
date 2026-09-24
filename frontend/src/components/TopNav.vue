<template>
  <header class="topbar">
    <h1 class="logo brand-logo" @click="router.push('/')">
      <img src="/lumi-logo.png" alt="" aria-hidden="true">
      <span>Lumi Doc</span>
    </h1>
    <div class="topbar-center">
      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-btn"
        :class="{ active: isActive(item) }"
        :aria-current="isActive(item) ? 'page' : undefined"
        @click="go(item)"
      >
        [{{ String(item.index).padStart(2, '0') }}] {{ item.label }}
      </button>
    </div>
    <div class="topbar-right">
      <slot name="actions"></slot>
      <span v-if="user?.username" class="username">{{ user.username }}</span>
      <button class="ghost" @click="handleLogout">退出</button>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearUser, getUser } from '../utils/api'
import { resolveNavItems } from '../utils/navigation'

const router = useRouter()
const route = useRoute()
const user = ref(getUser())

// 导航项与编号由 utils/navigation.js 统一提供，页面不再各写一份。
const navItems = computed(() => resolveNavItems(user.value))

// 按路由 name 判定，而不是 route.path：旧写法混用了 path 比较、写死的
// active class 和完全不判定，Problems 页那个写死的 active 导致导航永远高亮
// 且点自己没有反应。
function isActive(item) {
  return route.name === item.name
}

function go(item) {
  if (isActive(item)) return
  router.push(item.path)
}

function handleLogout() {
  // 本地登出与跳转必须是同步的，不能 await /logout 网络请求 ——
  // 后端卡住或离线时，等待会让「退出」看起来完全没反应。
  // clearUser() 内部已保证本地凭据无条件清除，并把请求失败降级为警告。
  clearUser()
  router.push('/login')
}
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 24px;
  background: #fff;
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 100;
}
.logo {
  font-size: 20px;
  font-weight: 700;
  color: var(--primary);
  cursor: pointer;
  flex: none;
}
.topbar-center {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.nav-btn {
  padding: 6px 12px;
  /* 明确固定 border-width，避免与全局样式叠加时切换状态出现尺寸抖动 */
  border: 1px solid transparent;
  background: transparent;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius);
  /* 只过渡颜色相关属性，不用 all，避免布局属性被意外过渡 */
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.nav-btn:hover {
  background: var(--bg-gray);
  color: var(--text-primary);
}
.nav-btn.active {
  background: var(--primary);
  color: #fff;
}
/* 导航 tab 点击时不要位移，避免切换时看起来像抖动 */
.nav-btn:active {
  transform: none;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.username {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 桌面端：导航簇绝对定位固定在顶栏正中，位置只由容器宽度决定，
   不再等于「logo 宽度与右侧区域宽度之间的中间值」——各页面右侧宽度不同
   （“我的文档”比“社区/题库/文档管理”多两个动作按钮），flex 布局下
   切换页面时整排 tab 会横向位移，看起来像样式跳动。
   .topbar 本身是 position: sticky（已定位元素），即可作为绝对定位
   子元素的包含块，无需也不能改成 relative（会失去吸顶）。 */
@media (min-width: 761px) {
  .topbar-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }
}

@media (max-width: 760px) {
  .topbar {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 12px 14px;
  }
  .topbar-center {
    order: 3;
    width: 100%;
    gap: 6px;
    overflow-x: auto;
  }
  .nav-btn {
    padding: 6px 8px;
  }
  .username {
    display: none;
  }
}
</style>

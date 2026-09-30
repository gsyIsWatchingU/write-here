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
      <!-- 个人设置入口：昵称 / AI 模型接入 / MCP Token，全站可见 -->
      <button
        class="settings-btn"
        aria-label="个人设置"
        title="个人设置"
        :aria-expanded="showSettings"
        @click.stop="openSettings"
      >
        <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <span v-if="user?.username" class="username">{{ user.username }}</span>
      <button class="ghost" @click="handleLogout">退出</button>
    </div>

    <!-- 个人设置弹窗：昵称、AI 模型接入（API 地址 / Key / 模型）、MCP 接入 -->
    <div v-if="showSettings" class="modal-overlay" @click.self="closeSettings">
      <div class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div class="settings-modal-header">
          <h3 id="settings-modal-title">个人设置</h3>
          <button class="ghost small" @click="closeSettings">关闭</button>
        </div>

        <div v-if="settingsLoading" class="settings-loading">加载中...</div>
        <template v-else>
          <section class="settings-section">
            <h4>用户昵称</h4>
            <div class="settings-row">
              <input
                v-model.trim="nickname"
                maxlength="40"
                placeholder="显示在顶栏、协作与评论中的昵称"
                aria-label="用户昵称"
                @keyup.enter="saveNickname"
              >
              <button
                class="primary"
                :disabled="savingNickname || !nickname || nickname === originalNickname"
                @click="saveNickname"
              >
                {{ savingNickname ? '保存中...' : '保存' }}
              </button>
            </div>
            <p class="settings-help">昵称会显示在顶栏、协作文档与评论中；留空时默认取邮箱 @ 前的部分。</p>
          </section>

          <section class="settings-section">
            <h4>AI 模型接入</h4>
            <p class="settings-help">用于编辑器「AI 润色」。填写你自己的 API 地址与密钥后，润色将优先使用你的配置；留空则回退到站点配置。</p>
            <div class="settings-field">
              <label for="ai-base-url">API 地址</label>
              <input id="ai-base-url" v-model.trim="aiBaseUrl" placeholder="https://api.example.com/v1" maxlength="500">
            </div>
            <div class="settings-field">
              <label for="ai-api-key">API Key</label>
              <div class="settings-field-row">
                <input
                  id="ai-api-key"
                  v-model="aiApiKey"
                  type="password"
                  :placeholder="aiHasApiKey ? '已设置（留空保持不变，输入新值将替换）' : 'sk-...'"
                  autocomplete="off"
                  maxlength="4096"
                >
                <button
                  v-if="aiHasApiKey"
                  class="ghost small"
                  title="移除已保存的 API Key"
                  @click="removeAiApiKey"
                >移除</button>
              </div>
            </div>
            <div class="settings-field">
              <label for="ai-model">模型</label>
              <input id="ai-model" v-model.trim="aiModel" placeholder="例如 claude-sonnet-4-5" maxlength="120">
            </div>
            <div class="settings-row">
              <button class="primary" :disabled="savingAi" @click="saveAiSettings(false)">
                {{ savingAi ? '保存中...' : '保存 AI 设置' }}
              </button>
              <span v-if="aiSaveMsg" class="settings-msg">{{ aiSaveMsg }}</span>
            </div>
          </section>

          <section class="settings-section">
            <h4>MCP 接入</h4>
            <p class="settings-help">生成个人 Token 并配置 MCP 客户端，让 AI 通过 MCP 读取和编辑你的文档。</p>
            <McpTokensSection />
          </section>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearUser, getUser, setUser, api } from '../utils/api'
import { resolveNavItems } from '../utils/navigation'
import McpTokensSection from './McpTokensSection.vue'

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

// ==================== 个人设置弹窗 ====================
const showSettings = ref(false)
const settingsLoading = ref(false)
const nickname = ref('')
const originalNickname = ref('')
const savingNickname = ref(false)
const aiBaseUrl = ref('')
const aiApiKey = ref('')
const aiHasApiKey = ref(false)
const aiModel = ref('')
const savingAi = ref(false)
const aiSaveMsg = ref('')
let aiSaveMsgTimer = null

function flashAiMsg(text) {
  aiSaveMsg.value = text
  clearTimeout(aiSaveMsgTimer)
  aiSaveMsgTimer = setTimeout(() => { aiSaveMsg.value = '' }, 3000)
}

async function openSettings() {
  showSettings.value = true
  settingsLoading.value = true
  aiSaveMsg.value = ''
  try {
    const settings = await api.getSettings()
    nickname.value = settings.nickname || ''
    originalNickname.value = settings.nickname || ''
    aiBaseUrl.value = settings.ai.baseUrl || ''
    aiApiKey.value = ''
    aiHasApiKey.value = Boolean(settings.ai.hasApiKey)
    aiModel.value = settings.ai.model || ''
  } catch (e) {
    alert(e.message || '无法加载个人设置')
    showSettings.value = false
  } finally {
    settingsLoading.value = false
  }
}

function closeSettings() {
  showSettings.value = false
}

async function saveNickname() {
  const name = nickname.value.trim()
  if (!name || savingNickname.value || name === originalNickname.value) return
  savingNickname.value = true
  try {
    const res = await api.saveSettings({ nickname: name })
    originalNickname.value = res.nickname
    // 同步本地用户态：顶栏用户名立即刷新，且其它页面重新挂载时读到的也是新昵称
    const current = getUser() || {}
    setUser({ ...current, username: res.nickname })
    user.value = getUser()
  } catch (e) {
    alert(e.message || '昵称保存失败')
  } finally {
    savingNickname.value = false
  }
}

// clearKey：true 表示显式移除已保存的 Key；否则非空 apiKey 替换，空串保持原样
async function saveAiSettings(clearKey) {
  if (savingAi.value) return
  const patch = {
    ai: {
      baseUrl: aiBaseUrl.value,
      model: aiModel.value,
    },
  }
  if (clearKey) {
    patch.ai.clearApiKey = true
  } else if (aiApiKey.value.trim()) {
    patch.ai.apiKey = aiApiKey.value.trim()
  }
  savingAi.value = true
  try {
    const res = await api.saveSettings(patch)
    aiHasApiKey.value = Boolean(res.ai.hasApiKey)
    aiApiKey.value = ''
    flashAiMsg(clearKey ? '已移除 API Key' : 'AI 设置已保存')
  } catch (e) {
    alert(e.message || 'AI 设置保存失败')
  } finally {
    savingAi.value = false
  }
}

async function removeAiApiKey() {
  if (!confirm('确定移除已保存的 API Key 吗？移除后「AI 润色」将回退到站点配置。')) return
  await saveAiSettings(true)
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
/* 设置齿轮：纯图标按钮，风格与铃铛一致 */
.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  padding: 5px 0;
  color: var(--text-secondary);
}
.settings-btn:hover {
  color: var(--text-primary);
}
.settings-icon {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

/* 设置弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  padding: 32px;
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.settings-modal {
  width: 560px;
  max-height: min(86vh, 780px);
  overflow-y: auto;
}
.settings-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.settings-modal-header h3 {
  margin: 0;
}
.settings-modal-header button {
  flex: none;
  white-space: nowrap;
}
.settings-loading {
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
}
.settings-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.settings-section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.settings-section h4 {
  margin: 0;
}
.settings-help {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.settings-row input {
  flex: 1;
  min-width: 0;
}
.settings-field {
  margin-top: 10px;
}
.settings-field label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.settings-field input {
  width: 100%;
  box-sizing: border-box;
}
.settings-field-row {
  display: flex;
  gap: 8px;
}
.settings-field-row input {
  flex: 1;
  min-width: 0;
}
.settings-field-row .ghost.small {
  flex: none;
}
.settings-msg {
  font-size: 12px;
  color: var(--primary);
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
  .settings-modal {
    width: calc(100vw - 24px);
    max-width: none;
    padding: 20px 16px;
  }
  .settings-field-row {
    flex-wrap: wrap;
  }
}
</style>

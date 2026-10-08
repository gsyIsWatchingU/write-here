<template>
  <div class="home-page">
    <TopNav>
      <template #actions>
        <button
          ref="bellBtnRef"
          class="bell-btn"
          aria-label="消息与协作请求"
          :aria-expanded="showBellPanel"
          title="消息与协作请求"
          @click.stop="toggleBellPanel"
        >
          <svg class="bell-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 10a6 6 0 0 1 12 0c0 4.6 1.6 6.2 2.6 7H3.4C4.4 16.2 6 14.6 6 10z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
          <span v-if="badgeCount > 0" class="bell-badge">{{ badgeCount > 99 ? '99+' : badgeCount }}</span>
        </button>
      </template>
    </TopNav>
    <main class="main-content">
      <div class="toolbar">
        <h2>我的文档</h2>
        <div class="toolbar-actions">
          <div class="search-box">
            <input v-model.trim="searchQuery" class="search-input" placeholder="搜索文档标题或内容..." @input="handleSearchInput" @keyup.escape="clearSearch" />
            <button v-if="searchQuery" class="search-clear" @click="clearSearch" aria-label="清除搜索">×</button>
          </div>
          <button class="ghost" @click="openMcpModal">[MCP] AI 接入</button>
          <button class="primary" @click="createNewDoc">+ 新建文档</button>
        </div>
      </div>
      <div v-if="loading && !searchQuery" class="empty">加载中...</div>
      <div v-else-if="searchQuery && searchLoading" class="empty">搜索中...</div>
      <div v-else-if="searchQuery && searchResults.length === 0" class="empty">
        <p>没有找到与 "{{ searchQuery }}" 相关的文档</p>
      </div>
      <div v-else-if="!searchQuery && docs.length === 0" class="empty">
        <p>还没有文档，点击上方按钮创建第一篇文档</p>
      </div>
      <div v-else class="doc-grid">
        <div
          v-for="doc in (searchQuery ? searchResults : docs)"
          :key="doc.id"
          class="doc-card"
          :class="{ deleting: isDeleting(doc.id) }"
          @click="openDoc(doc)"
        >
          <div class="doc-card-body">
            <h3 class="doc-title">{{ doc.title }}</h3>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <span class="doc-time">{{ formatTime(doc.lastViewedAt || doc.updatedAt) }}</span>
            <div class="doc-card-actions">
              <button class="card-action-btn share-action" type="button" title="分享文档" aria-label="分享文档" @click.stop="openShare(doc)">
                <svg class="card-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
                </svg>
                <span>分享</span>
              </button>
              <button class="card-action-btn delete-action" type="button" title="删除文档" aria-label="删除文档" @click.stop="handleDelete(doc.id)">
                <svg class="card-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                </svg>
                <span>删除</span>
              </button>
            </div>
          </div>
          <div v-if="isDeleting(doc.id)" class="doc-card-deleting-overlay">
            <span>删除中...</span>
          </div>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="toolbar secondary">
        <h2>参与协作的文档</h2>
      </div>
      <div v-if="loadingCollab" class="empty">加载中...</div>
      <div v-else-if="collabDocs.length === 0" class="empty">
        <p>暂无参与协作的文档</p>
      </div>
      <div v-else class="doc-grid">
        <div v-for="doc in collabDocs" :key="doc.id" class="doc-card" @click="openDoc(doc)">
          <div class="doc-card-body">
            <div class="doc-title-row">
              <h3 class="doc-title">{{ doc.title }}</h3>
              <span class="doc-badge">协作</span>
            </div>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <span class="doc-time">{{ formatTime(doc.lastViewedAt || doc.updatedAt) }}</span>
            <span class="doc-author">作者：{{ doc.username }}</span>
          </div>
        </div>
      </div>
    </main>

    <!-- 分享弹窗 -->
    <div v-if="shareModal" class="modal-overlay" @click.self="shareModal = null">
      <div class="modal">
        <h3>分享文档：{{ shareModal.title }}</h3>
        <div v-if="shareLink" class="share-link-box">
          <p>分享链接：</p>
          <div class="share-link-row">
            <input :value="shareLink" readonly ref="shareLinkInput" />
            <button class="primary" @click="copyLink">复制</button>
          </div>
          <div class="share-options">
            <label>
              <span>权限：</span>
              <select v-model="sharePermission" @change="handleCreateShare">
                <option value="read">只读</option>
                <option value="edit">可编辑</option>
              </select>
            </label>
          </div>
          <button class="danger" @click="handleDeleteShare" style="margin-top: 12px;">取消分享</button>
        </div>
        <div v-else>
          <div class="share-options">
            <label>
              <span>权限：</span>
              <select v-model="sharePermission">
                <option value="read">只读</option>
                <option value="edit">可编辑</option>
              </select>
            </label>
          </div>
          <button class="primary" @click="handleCreateShare" style="margin-top: 16px;">生成分享链接</button>
        </div>
        <button class="ghost" @click="shareModal = null" style="margin-top: 12px;">关闭</button>
      </div>
    </div>

    <!-- MCP 接入弹窗：Token 管理内容统一由 McpTokensSection 提供（个人设置弹窗复用同一组件） -->
    <div v-if="showMcpModal" class="modal-overlay" @click.self="closeMcpModal">
      <div class="modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcp-modal-title">
        <div class="mcp-modal-header">
          <div>
            <h3 id="mcp-modal-title">AI / MCP 接入</h3>
          </div>
          <button class="ghost small" aria-label="关闭 MCP 接入弹窗" @click="closeMcpModal">关闭</button>
        </div>

        <McpTokensSection />
      </div>
    </div>

    <!-- 铃铛面板：消息 + 协作请求 -->
    <div v-if="showBellPanel" ref="bellDropdownRef" class="bell-dropdown" @click.stop>
      <div class="bell-tabs" role="tablist">
        <button
          class="bell-tab"
          :class="{ active: activeTab === 'messages' }"
          role="tab"
          :aria-selected="activeTab === 'messages'"
          @click="switchTab('messages')"
        >
          消息
          <span v-if="messageUnreadCount > 0" class="tab-count">{{ messageUnreadCount > 99 ? '99+' : messageUnreadCount }}</span>
        </button>
        <button
          class="bell-tab"
          :class="{ active: activeTab === 'collab' }"
          role="tab"
          :aria-selected="activeTab === 'collab'"
          @click="switchTab('collab')"
        >
          协作请求
          <span v-if="pendingCollabCount > 0" class="tab-count">{{ pendingCollabCount > 99 ? '99+' : pendingCollabCount }}</span>
        </button>
      </div>

      <template v-if="activeTab === 'messages'">
        <div class="bell-pane-header">
          <span>{{ messageUnreadCount }} 条未读</span>
          <div class="bell-pane-actions">
            <button class="ghost small" @click="markAllAsRead">全部已读</button>
            <button class="ghost small" @click="clearReadNotifications">清理已读</button>
          </div>
        </div>
        <div class="notification-list">
          <div v-if="notifications.length === 0" class="empty-notifications">
            <p>暂无通知</p>
          </div>
          <div v-else v-for="notification in notifications" :key="notification.id" class="notification-item" :class="{ unread: !notification.isRead, actionable: notification.docId }" @click="openNotification(notification)">
            <div class="notification-content">
              <span class="notification-type">{{ notificationTypeLabel(notification.type) }}</span>
              <p>{{ notification.message }}</p>
              <blockquote v-if="notification.quoteText" class="notification-quote">{{ notification.quoteText }}</blockquote>
              <span class="notification-time">{{ formatTime(notification.createdAt) }}</span>
            </div>
            <button v-if="!notification.isRead" class="icon-btn small" title="标记已读" @click.stop="markAsRead(notification.id)">✓</button>
            <span v-else-if="notification.docId" class="notification-arrow">→</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="bell-pane-header">
          <span>{{ pendingCollabCount }} 条待处理</span>
          <div class="bell-pane-actions">
            <button class="ghost small" @click="loadCollabRequests">刷新</button>
          </div>
        </div>
        <div class="collab-requests-list">
          <div v-if="collabRequests.length === 0" class="empty-requests">
            <p>暂无协作请求</p>
          </div>
          <div v-else v-for="request in collabRequests" :key="request.id" class="collab-request-item">
            <div class="collab-request-content">
              <p><strong>{{ request.username }}</strong> 申请协作文档：<br>{{ request.title }}</p>
              <span class="collab-request-time">{{ formatTime(request.createdAt) }}</span>
            </div>
            <div class="collab-request-actions">
              <button class="icon-btn small accept-btn" @click="respondToCollaboration(request.id, 'approved')">✓</button>
              <button class="icon-btn small reject-btn" @click="respondToCollaboration(request.id, 'rejected')">✗</button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api, getUser, clearUser, getWebSocketUrl } from '../utils/api'
import { formatServerDateTime } from '../utils/dateTime'
import { getDocumentPath } from '../utils/documentIdentity'
import TopNav from '../components/TopNav.vue'
import McpTokensSection from '../components/McpTokensSection.vue'

const router = useRouter()
const user = ref(getUser())
const bellBtnRef = ref(null)
const bellDropdownRef = ref(null)

const docs = ref([])
const loading = ref(true)
const searchQuery = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
let searchDebounceTimer = null
const collabDocs = ref([])
const loadingCollab = ref(true)
// 正在删除中的文档 id 集合：只有对应卡片显示"删除中..."，其余卡片保持可操作
const deletingIds = ref([])
const shareModal = ref(null)
const shareLink = ref('')
const sharePermission = ref('read')
const showBellPanel = ref(false)
const activeTab = ref('messages')
const notifications = ref([])
const collabRequests = ref([])
const showMcpModal = ref(false)

let ws = null

// 角标口径：一条协作申请事件会同时产生「collaboration_request 通知」和「待处理请求」，
// 两边都算就是同一事件计两次。约定：collaboration_request 类型的通知不进消息未读数，
// 由待处理请求数独立代表它；批准/拒绝后待处理数下降，通知本身已处理不再计数。
const pendingCollabCount = computed(() => collabRequests.value.length)
const messageUnreadCount = computed(() =>
  notifications.value.filter(n => !n.isRead && n.type !== 'collaboration_request').length
)
const badgeCount = computed(() => messageUnreadCount.value + pendingCollabCount.value)

onMounted(() => {
  loadDocs()
  loadCollabDocs()
  loadNotifications()
  loadCollabRequests()
  setupWebSocket()
  window.addEventListener('click', handleGlobalClick)
  // 预加载编辑器组件，减少点击文档后的加载等待
  import('../views/Editor.vue')
})

onUnmounted(() => {
  closeWebSocket()
  window.removeEventListener('click', handleGlobalClick)
})

function handleGlobalClick(e) {
  const t = e.target
  const inBellBtn = bellBtnRef.value?.contains?.(t)
  const inBellDropdown = bellDropdownRef.value?.contains?.(t)

  if (showBellPanel.value && !inBellBtn && !inBellDropdown) {
    showBellPanel.value = false
  }
}

// ==================== WebSocket 实时通知 ====================
// 指数退避重连：1s → 2s → 4s → 8s → 16s，封顶 30s，加少量抖动
// 避免多标签页同一时刻集体重连打爆服务端；连接成功后归零。
const WS_BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
const WS_HEARTBEAT_INTERVAL = 30000
const WS_PONG_TIMEOUT = 10000
let wsReconnectAttempts = 0
let wsReconnectTimer = null
let wsHeartbeatTimer = null
let wsPongTimer = null
let wsManualClose = false

function setupWebSocket() {
  if (!user.value) return
  wsManualClose = false
  connectWebSocket()
}

function connectWebSocket() {
  clearTimeout(wsReconnectTimer)
  ws = new WebSocket(`${getWebSocketUrl('/notifications')}?userId=${user.value.id}`)

  ws.onopen = () => {
    // 重连成功意味着断线期间可能漏推：全量拉一次对账，而不是指望服务端补发
    const wasReconnect = wsReconnectAttempts > 0
    wsReconnectAttempts = 0
    startHeartbeat()
    if (wasReconnect) {
      loadNotifications()
      loadCollabRequests()
    }
  }

  ws.onmessage = (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }
    if (data.type === 'pong') return
    if (data.type === 'notification') {
      const existingIndex = notifications.value.findIndex(item => Number(item.id) === Number(data.data.id))
      if (existingIndex >= 0) notifications.value.splice(existingIndex, 1)
      notifications.value.unshift(data.data)
      // 协作申请同时存在于服务端 pending 列表：重新拉取对账，不做本地 ++（会双重计数）
      if (data.data?.type === 'collaboration_request') {
        loadCollabRequests()
      }
    }
  }

  ws.onclose = () => {
    stopHeartbeat()
    if (wsManualClose) return
    scheduleReconnect()
  }

  ws.onerror = () => {
    // 出错后 onclose 必然跟随，重连统一收敛在 onclose 里
  }
}

function scheduleReconnect() {
  clearTimeout(wsReconnectTimer)
  const base = WS_BACKOFF_STEPS[Math.min(wsReconnectAttempts, WS_BACKOFF_STEPS.length - 1)]
  wsReconnectAttempts++
  const delay = Math.round(base * (1 + Math.random() * 0.2))
  wsReconnectTimer = setTimeout(connectWebSocket, delay)
}

function startHeartbeat() {
  stopHeartbeat()
  wsHeartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
    // 一个心跳周期没等到 pong 就判定链路已死：摘掉 onclose 防止双重调度，
    // 强制关闭并立即进入退避重连
    clearTimeout(wsPongTimer)
    wsPongTimer = setTimeout(() => {
      if (!ws) return
      ws.onclose = null
      try { ws.close() } catch { /* 已关闭则忽略 */ }
      scheduleReconnect()
    }, WS_PONG_TIMEOUT)
  }, WS_HEARTBEAT_INTERVAL)
}

function stopHeartbeat() {
  clearInterval(wsHeartbeatTimer)
  clearTimeout(wsPongTimer)
  wsHeartbeatTimer = null
  wsPongTimer = null
}

function closeWebSocket() {
  wsManualClose = true
  stopHeartbeat()
  clearTimeout(wsReconnectTimer)
  if (ws) ws.close()
  ws = null
}

async function loadDocs() {
  loading.value = true
  try {
    docs.value = await api.getDocs(user.value.id)
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

async function loadCollabDocs() {
  loadingCollab.value = true
  try {
    collabDocs.value = await api.getMyCollaborationDocs(user.value.id)
  } catch (e) {
    console.error(e)
    collabDocs.value = []
  }
  loadingCollab.value = false
}

function handleSearchInput() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  const q = searchQuery.value.trim()
  if (!q) { searchResults.value = []; searchLoading.value = false; return }
  searchLoading.value = true
  searchDebounceTimer = setTimeout(async () => {
    try { searchResults.value = await api.searchDocs(user.value.id, q) }
    catch (e) { console.error(e); searchResults.value = [] }
    finally { searchLoading.value = false }
  }, 250)
}

function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
  searchLoading.value = false
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
}

async function createNewDoc() {
  try {
    const doc = await api.createDoc(user.value.id, '无标题文档', '<p></p>')
    router.push(getDocumentPath(doc))
  } catch (e) {
    alert(e.message)
  }
}

function openDoc(doc) {
  router.push(getDocumentPath(doc))
}

function isDeleting(id) {
  return deletingIds.value.includes(String(id))
}

async function handleDelete(id) {
  if (!confirm('确定要删除这篇文档吗？')) return
  if (isDeleting(id)) return
  deletingIds.value.push(String(id))
  try {
    await api.deleteDoc(id, user.value.id)
    // 本地先行移除被删卡片，避免整表刷新出现"全部消失"的加载中间态
    docs.value = docs.value.filter(d => String(d.id) !== String(id))
    searchResults.value = searchResults.value.filter(d => String(d.id) !== String(id))
    // 静默刷新列表以服务端为准（不置全局 loading，网格不会变"加载中..."）
    try {
      const fresh = await api.getDocs(user.value.id)
      if (fresh) docs.value = fresh
    } catch (e) {
      console.error(e)
    }
  } catch (e) {
    alert(e.message)
  } finally {
    deletingIds.value = deletingIds.value.filter(did => did !== String(id))
  }
}

async function handleLogout() {
  await clearUser()
  router.push('/login')
}

async function openShare(doc) {
  shareModal.value = doc
  shareLink.value = ''
  sharePermission.value = 'read'
  try {
    const shares = await api.getDocShares(doc.id, user.value.id)
    if (shares && shares.length > 0) {
      shareLink.value = `${window.location.origin}/share/${shares[0].token}`
      sharePermission.value = shares[0].permission
    }
  } catch (e) {
    // 没有分享
  }
}

async function handleCreateShare() {
  try {
    const share = await api.createShare(shareModal.value.id, user.value.id, sharePermission.value)
    shareLink.value = `${window.location.origin}/share/${share.token}`
  } catch (e) {
    alert(e.message)
  }
}

async function handleDeleteShare() {
  try {
    await api.deleteShare(shareModal.value.id, user.value.id)
    shareLink.value = ''
  } catch (e) {
    alert(e.message)
  }
}

function copyLink() {
  navigator.clipboard.writeText(shareLink.value)
  alert('链接已复制')
}

async function openMcpModal() {
  showMcpModal.value = true
}

function closeMcpModal() {
  showMcpModal.value = false
}

function stripHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html || ''
  const text = tmp.textContent || tmp.innerText || ''
  return text.length > 120 ? text.substring(0, 120) + '...' : text
}

function formatTime(t) {
  return formatServerDateTime(t)
}

// 通知相关函数
async function loadNotifications() {
  try {
    notifications.value = await api.getNotifications(user.value.id)
  } catch (e) {
    console.error(e)
  }
}

function toggleBellPanel() {
  showBellPanel.value = !showBellPanel.value
  if (showBellPanel.value) {
    // 打开时按当前 tab 拉最新数据；不清零计数——
    // 角标 = 未读消息 + 待处理请求，都以服务端数据为准，处理完才减少
    if (activeTab.value === 'messages') loadNotifications()
    else loadCollabRequests()
  }
}

function switchTab(tab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  if (tab === 'messages') loadNotifications()
  else loadCollabRequests()
}

async function markAsRead(notificationId) {
  try {
    await api.markNotificationRead(notificationId, user.value.id)
    // 更新本地通知状态
    const notification = notifications.value.find(n => n.id === notificationId)
    if (notification) {
      notification.isRead = 1
    }
  } catch (e) {
    console.error(e)
  }
}

async function markAllAsRead() {
  try {
    await api.markAllNotificationsRead(user.value.id)
    notifications.value.forEach(notification => { notification.isRead = 1 })
  } catch (e) {
    console.error(e)
  }
}

async function clearReadNotifications() {
  try {
    await api.deleteReadNotifications(user.value.id)
    notifications.value = notifications.value.filter(notification => !notification.isRead)
  } catch (e) {
    console.error(e)
  }
}

async function openNotification(notification) {
  if (!notification.isRead) await markAsRead(notification.id)
  if (!notification.docId) return
  showBellPanel.value = false
  const query = notification.commentId ? { comment: notification.commentId } : undefined
  try {
    const doc = await api.getDoc(notification.docId, user.value.id)
    router.push({ path: getDocumentPath(doc), query })
  } catch (error) {
    console.error(error)
  }
}

function notificationTypeLabel(type) {
  return ({
    comment: '评论', reply: '回复', mention: '@提及', comment_like: '评论点赞',
    comment_resolved: '评论已解决', comment_reopened: '评论重新打开',
    like: '文档点赞', collaboration_request: '协作申请', collaboration_response: '协作结果',
    collaboration_removed: '协作变更'
  })[type] || '系统'
}

// 协作请求相关函数
async function loadCollabRequests() {
  try {
    collabRequests.value = await api.getCollaborationRequests(user.value.id)
  } catch (e) {
    console.error(e)
  }
}

async function respondToCollaboration(requestId, status) {
  try {
    await api.respondToCollaboration(requestId, user.value.id, status)
    // 重新加载协作请求
    await loadCollabRequests()
  } catch (e) {
    alert(e.message)
  }
}
</script>

<style scoped>
.home-page {
  min-height: 100vh;
  background: var(--bg-gray);
}
/* 铃铛按钮：纯图标 + 右上角红色数字角标 */
.bell-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  padding: 5px 0;
}
.bell-icon {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
.bell-badge {
  position: absolute;
  top: -6px;
  right: -7px;
  background: #ff4757;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 10px;
  min-width: 15px;
  text-align: center;
  box-sizing: border-box;
}
.username {
  font-size: 14px;
  color: var(--text-secondary);
}
/* 单个铃铛下拉面板：顶部两个 tab，下方是各自列表 */
.bell-dropdown {
  position: absolute;
  top: 60px;
  right: 24px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  width: 360px;
  max-height: 420px;
  overflow-y: auto;
  z-index: 1000;
}
.bell-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 1;
}
.bell-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}
.bell-tab:hover {
  background: var(--bg-gray);
}
.bell-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}
.tab-count {
  background: #ff4757;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 8px;
  min-width: 14px;
  text-align: center;
}
.bell-pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
}
.bell-pane-header > span {
  color: var(--text-muted);
  font-size: 11px;
}
.bell-pane-actions {
  display: flex;
  gap: 4px;
}
.bell-pane-header .ghost.small {
  font-size: 12px;
  padding: 4px 8px;
}
.notification-list {
  padding: 8px 0;
}
.empty-notifications {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-muted);
}
.notification-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.2s;
}
.notification-item:hover {
  background: var(--bg-gray);
}
.notification-item.actionable {
  cursor: pointer;
}
.notification-item.unread {
  background: #f8f9fa;
}
.notification-content {
  flex: 1;
  margin-right: 12px;
}
.notification-content p {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--text-primary);
}
.notification-quote {
  max-height: 58px;
  margin: 7px 0;
  padding: 5px 8px;
  overflow: hidden;
  color: var(--text-secondary);
  background: var(--surface-hover);
  border-left: 3px solid var(--primary);
  font-size: 12px;
  line-height: 1.5;
}
.notification-type {
  display: inline-block;
  margin-bottom: 5px;
  padding: 1px 5px;
  color: var(--text-primary);
  background: var(--primary);
  border: 1px solid var(--border);
  font-size: 10px;
}
.notification-arrow {
  color: var(--text-muted);
}
.notification-time {
  font-size: 12px;
  color: var(--text-muted);
}
.icon-btn.small {
  width: 24px;
  height: 24px;
  font-size: 12px;
}
.collab-requests-list {
  padding: 8px 0;
}
.empty-requests {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-muted);
}
.collab-request-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.2s;
}
.collab-request-item:hover {
  background: var(--bg-gray);
}
.collab-request-content {
  flex: 1;
  margin-right: 12px;
}
.collab-request-content p {
  margin: 0 0 4px 0;
  font-size: 14px;
  color: var(--text-primary);
}
.collab-request-time {
  font-size: 12px;
  color: var(--text-muted);
}
.collab-request-actions {
  display: flex;
  gap: 4px;
}
.accept-btn {
  color: #27ae60;
}
.reject-btn {
  color: #e74c3c;
}
.main-content {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.toolbar.secondary {
  margin-top: 8px;
}
.toolbar h2 {
  font-size: 20px;
}
.section-divider {
  height: 1px;
  background: var(--border);
  margin: 28px 0;
}
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 60px 0;
}
.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.doc-card {
  position: relative;
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 160px;
}
.doc-card.deleting {
  pointer-events: none;
  cursor: default;
}
.doc-card-deleting-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
}
.doc-card-deleting-overlay::before {
  content: '';
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: doc-card-deleting-spin 0.8s linear infinite;
}
@keyframes doc-card-deleting-spin {
  to { transform: rotate(360deg); }
}
.doc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.doc-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.doc-title-row .doc-title {
  margin-bottom: 0;
  flex: 1;
  min-width: 0;
}
.doc-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e6f7ff;
  color: var(--primary);
  border: 1px solid rgba(0,0,0,0.04);
  flex: none;
}
.doc-preview {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.doc-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.doc-author {
  font-size: 12px;
  color: var(--text-muted);
}
.doc-time {
  font-size: 12px;
  color: var(--text-muted);
}
.doc-card-actions {
  display: flex;
  gap: 4px;
}
.card-action-btn {
  min-height: 34px;
  padding: 5px 8px;
  gap: 5px;
  font-size: 12px;
  line-height: 1;
}
.card-action-icon {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
.share-action:hover {
  background: var(--primary);
}
.delete-action {
  color: var(--danger);
  border-color: var(--danger);
}
.delete-action:hover {
  color: var(--danger);
  background: var(--danger-hover);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
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
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.modal h3 {
  margin-bottom: 16px;
}
.share-link-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.share-link-row input {
  flex: 1;
  font-size: 13px;
}
.share-options {
  margin-top: 12px;
}
.share-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.share-options select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.mcp-modal {
  width: 680px;
  max-height: min(86vh, 780px);
  overflow-y: auto;
}
.mcp-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.mcp-modal-header h3 {
  margin: 0;
}
.mcp-modal-header button {
  flex: none;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .bell-dropdown {
    right: 12px;
    width: min(360px, calc(100vw - 24px));
  }
  .toolbar-actions {
    gap: 6px;
  }
  .toolbar-actions button {
    padding-inline: 9px;
  }
  .mcp-modal {
    width: calc(100vw - 24px);
    max-width: none;
    padding: 20px 16px;
  }
}

.search-box { position: relative; display: flex; align-items: center; }
.search-input { width: 240px; padding: 6px 28px 6px 12px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
.search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 120, 255, 0.1); }
.search-clear { position: absolute; right: 6px; width: 20px; height: 20px; border: none; background: var(--bg-gray); border-radius: 50%; font-size: 14px; line-height: 1; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; }
.search-clear:hover { background: var(--border); color: var(--text-primary); }
</style>

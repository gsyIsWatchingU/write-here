<template>
  <div class="bell-wrapper">
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, getUser, getWebSocketUrl } from '../utils/api'
import { formatServerDateTime } from '../utils/dateTime'
import { getDocumentPath } from '../utils/documentIdentity'

const router = useRouter()
const user = getUser()

const bellBtnRef = ref(null)
const bellDropdownRef = ref(null)
const showBellPanel = ref(false)
const activeTab = ref('messages')
const notifications = ref([])
const collabRequests = ref([])

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
  if (!user) return
  loadNotifications()
  loadCollabRequests()
  setupWebSocket()
  window.addEventListener('click', handleGlobalClick)
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
  if (!user) return
  wsManualClose = false
  connectWebSocket()
}

function connectWebSocket() {
  clearTimeout(wsReconnectTimer)
  ws = new WebSocket(`${getWebSocketUrl('/notifications')}?userId=${user.id}`)

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

function formatTime(t) {
  return formatServerDateTime(t)
}

// 通知相关函数
async function loadNotifications() {
  try {
    notifications.value = await api.getNotifications(user.id)
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
    await api.markNotificationRead(notificationId, user.id)
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
    await api.markAllNotificationsRead(user.id)
    notifications.value.forEach(notification => { notification.isRead = 1 })
  } catch (e) {
    console.error(e)
  }
}

async function clearReadNotifications() {
  try {
    await api.deleteReadNotifications(user.id)
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
    const doc = await api.getDoc(notification.docId, user.id)
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
    collabRequests.value = await api.getCollaborationRequests(user.id)
  } catch (e) {
    console.error(e)
  }
}

async function respondToCollaboration(requestId, status) {
  try {
    await api.respondToCollaboration(requestId, user.id, status)
    // 重新加载协作请求
    await loadCollabRequests()
  } catch (e) {
    alert(e.message)
  }
}
</script>

<style scoped>
.bell-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* 铃铛按钮：纯图标 + 右上角红色数字角标 */
.bell-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  padding: 5px 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
}
.bell-btn:hover {
  color: var(--text-primary);
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

/* 单个铃铛下拉面板：顶部两个 tab，下方是各自列表 */
.bell-dropdown {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
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

@media (max-width: 760px) {
  .bell-dropdown {
    position: fixed;
    top: auto;
    bottom: 16px;
    right: 16px;
    left: 16px;
    width: auto;
  }
}
</style>

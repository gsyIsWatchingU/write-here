<template>
  <div class="home-page">
    <header class="topbar">
      <h1 class="logo" @click="router.push('/')">WriteHere</h1>
      <div class="topbar-center">
        <button class="nav-btn" :class="{ active: isHomeActive }" @click="router.push('/')">我的文档</button>
        <button class="nav-btn" :class="{ active: isCommunityActive }" @click="router.push('/community')">社区</button>
        <button v-if="user?.isAdmin" class="nav-btn" :class="{ active: isAdminActive }" @click="router.push('/admin')">文档管理</button>
      </div>
      <div class="topbar-right">
        <button ref="notificationBtnRef" class="icon-btn notification-btn" @click.stop="toggleNotifications">
          <span class="notification-icon">🔔</span>
          <span v-if="unreadCount > 0" class="notification-badge">{{ unreadCount }}</span>
        </button>
        <button ref="collabBtnRef" class="icon-btn collaboration-btn" @click.stop="toggleCollabRequests">
          <span class="collaboration-icon">👥</span>
          <span v-if="collabUnreadCount > 0" class="notification-badge collab-badge">{{ collabUnreadCount }}</span>
        </button>
        <span class="username">{{ user?.username }}</span>
        <button class="ghost" @click="handleLogout">退出</button>
      </div>
    </header>
    <main class="main-content">
      <div class="toolbar">
        <h2>我的文档</h2>
        <button class="primary" @click="createNewDoc">+ 新建文档</button>
      </div>
      <div v-if="loading" class="empty">加载中...</div>
      <div v-else-if="docs.length === 0" class="empty">
        <p>还没有文档，点击上方按钮创建第一篇文档</p>
      </div>
      <div v-else class="doc-grid">
        <div v-for="doc in docs" :key="doc.id" class="doc-card" @click="openDoc(doc.id)">
          <div class="doc-card-body">
            <h3 class="doc-title">{{ doc.title }}</h3>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <span class="doc-time">{{ formatTime(doc.updatedAt) }}</span>
            <div class="doc-card-actions">
              <button class="icon-btn" title="分享" @click.stop="openShare(doc)">&#128279;</button>
              <button class="icon-btn" title="删除" @click.stop="handleDelete(doc.id)">&#128465;</button>
            </div>
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
        <div v-for="doc in collabDocs" :key="doc.id" class="doc-card" @click="openDoc(doc.id)">
          <div class="doc-card-body">
            <div class="doc-title-row">
              <h3 class="doc-title">{{ doc.title }}</h3>
              <span class="doc-badge">协作</span>
            </div>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <span class="doc-time">{{ formatTime(doc.updatedAt) }}</span>
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

    <!-- 通知列表 -->
    <div v-if="showNotifications" ref="notificationDropdownRef" class="notification-dropdown" @click.stop>
      <div class="notification-header">
        <h3>通知</h3>
        <button class="ghost small" @click="markAllAsRead">全部已读</button>
      </div>
      <div class="notification-list">
        <div v-if="notifications.length === 0" class="empty-notifications">
          <p>暂无通知</p>
        </div>
        <div v-else v-for="notification in notifications" :key="notification.id" class="notification-item" :class="{ unread: !notification.isRead }">
          <div class="notification-content">
            <p>{{ notification.message }}</p>
            <span class="notification-time">{{ formatTime(notification.createdAt) }}</span>
          </div>
          <button v-if="!notification.isRead" class="icon-btn small" @click="markAsRead(notification.id)">✓</button>
        </div>
      </div>
    </div>

    <!-- 协作请求管理 -->
    <div v-if="showCollabRequests" ref="collabDropdownRef" class="collab-requests-dropdown" @click.stop>
      <div class="collab-requests-header">
        <h3>协作请求</h3>
        <button class="ghost small" @click="loadCollabRequests">刷新</button>
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, getUser, clearUser } from '../utils/api'

const router = useRouter()
const route = useRoute()
const user = ref(getUser())
const notificationBtnRef = ref(null)
const collabBtnRef = ref(null)
const notificationDropdownRef = ref(null)
const collabDropdownRef = ref(null)

const isHomeActive = computed(() => {
  return route.path === '/'
})

const isCommunityActive = computed(() => {
  return route.path === '/community'
})

const isAdminActive = computed(() => {
  return route.path === '/admin'
})
const docs = ref([])
const loading = ref(true)
const collabDocs = ref([])
const loadingCollab = ref(true)
const shareModal = ref(null)
const shareLink = ref('')
const sharePermission = ref('read')
const showNotifications = ref(false)
const notifications = ref([])
const unreadCount = ref(0)
const showCollabRequests = ref(false)
const collabRequests = ref([])
const collabUnreadCount = ref(0)
let ws = null

onMounted(() => {
  loadDocs()
  loadCollabDocs()
  loadNotifications()
  loadCollabRequests()
  setupWebSocket()
  window.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  if (ws) {
    ws.close()
  }
  window.removeEventListener('click', handleGlobalClick)
})

function handleGlobalClick(e) {
  const t = e.target
  const inNotificationBtn = notificationBtnRef.value?.contains?.(t)
  const inNotificationDropdown = notificationDropdownRef.value?.contains?.(t)
  const inCollabBtn = collabBtnRef.value?.contains?.(t)
  const inCollabDropdown = collabDropdownRef.value?.contains?.(t)

  if (showNotifications.value && !inNotificationBtn && !inNotificationDropdown) {
    showNotifications.value = false
  }
  if (showCollabRequests.value && !inCollabBtn && !inCollabDropdown) {
    showCollabRequests.value = false
  }
}

function setupWebSocket() {
  if (!user.value) return
  
  ws = new WebSocket(`ws://localhost:3210/notifications?userId=${user.value.id}`)
  
  ws.onopen = () => {
    console.log('WebSocket 连接已建立')
  }
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === 'notification') {
      // 收到新通知
      notifications.value.unshift(data.data)
      unreadCount.value++
      if (data.data?.type === 'collaboration_request') {
        collabUnreadCount.value++
      }
    }
  }
  
  ws.onclose = () => {
    console.log('WebSocket 连接已关闭')
  }
  
  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error)
  }
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

async function createNewDoc() {
  try {
    const doc = await api.createDoc(user.value.id, '无标题文档', '<p></p>')
    router.push(`/doc/${doc.id}`)
  } catch (e) {
    alert(e.message)
  }
}

function openDoc(id) {
  router.push(`/doc/${id}`)
}

async function handleDelete(id) {
  if (!confirm('确定要删除这篇文档吗？')) return
  try {
    await api.deleteDoc(id, user.value.id)
    loadDocs()
  } catch (e) {
    alert(e.message)
  }
}

function handleLogout() {
  clearUser()
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

function stripHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html || ''
  const text = tmp.textContent || tmp.innerText || ''
  return text.length > 120 ? text.substring(0, 120) + '...' : text
}

function formatTime(t) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN')
}

// 通知相关函数
async function loadNotifications() {
  try {
    const data = await api.getNotifications(user.value.id)
    notifications.value = data
    unreadCount.value = data.filter(n => !n.isRead).length
  } catch (e) {
    console.error(e)
  }
}

function toggleNotifications() {
  showNotifications.value = !showNotifications.value
  if (showNotifications.value) {
    // 打开通知时加载最新通知
    loadNotifications()
  }
}

async function markAsRead(notificationId) {
  try {
    await api.markNotificationRead(notificationId, user.value.id)
    // 更新本地通知状态
    const notification = notifications.value.find(n => n.id === notificationId)
    if (notification) {
      notification.isRead = 1
      unreadCount.value--
    }
  } catch (e) {
    console.error(e)
  }
}

async function markAllAsRead() {
  try {
    const unreadNotifications = notifications.value.filter(n => !n.isRead)
    for (const notification of unreadNotifications) {
      await api.markNotificationRead(notification.id, user.value.id)
      notification.isRead = 1
    }
    unreadCount.value = 0
  } catch (e) {
    console.error(e)
  }
}

// 协作请求相关函数
async function loadCollabRequests() {
  try {
    collabRequests.value = await api.getCollaborationRequests(user.value.id)
    collabUnreadCount.value = collabRequests.value.length
  } catch (e) {
    console.error(e)
  }
}

function toggleCollabRequests() {
  showCollabRequests.value = !showCollabRequests.value
  if (showCollabRequests.value) {
    loadCollabRequests()
    collabUnreadCount.value = 0
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
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
}
.topbar-center {
  display: flex;
  align-items: center;
  gap: 16px;
}
.nav-btn {
  padding: 6px 12px;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius);
  transition: all 0.2s;
}
.nav-btn:hover {
  background: var(--bg-gray);
  color: var(--text-primary);
}
.nav-btn.active {
  background: var(--primary);
  color: #fff;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.notification-btn {
  position: relative;
}
.notification-icon {
  font-size: 18px;
}
.notification-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #ff4757;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 16px;
  text-align: center;
}
.username {
  font-size: 14px;
  color: var(--text-secondary);
}
.notification-dropdown {
  position: absolute;
  top: 60px;
  right: 24px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
}
.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.notification-header h3 {
  margin: 0;
  font-size: 16px;
}
.notification-header .ghost.small {
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
.notification-time {
  font-size: 12px;
  color: var(--text-muted);
}
.icon-btn.small {
  width: 24px;
  height: 24px;
  font-size: 12px;
}
.collaboration-btn {
  position: relative;
}
.collab-badge {
  top: -6px;
  right: -6px;
}
.collaboration-icon {
  font-size: 18px;
}
.collab-requests-dropdown {
  position: absolute;
  top: 60px;
  right: 80px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  width: 360px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
}
.collab-requests-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}
.collab-requests-header h3 {
  margin: 0;
  font-size: 16px;
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
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
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
</style>

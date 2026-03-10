<template>
  <div class="home-page">
    <header class="topbar">
      <h1 class="logo" @click="router.push('/')">WriteHere</h1>
      <div class="topbar-right">
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, getUser, clearUser } from '../utils/api'

const router = useRouter()
const user = ref(getUser())
const docs = ref([])
const loading = ref(true)
const shareModal = ref(null)
const shareLink = ref('')
const sharePermission = ref('read')

onMounted(() => {
  loadDocs()
})

async function loadDocs() {
  loading.value = true
  try {
    docs.value = await api.getDocs(user.value.id)
  } catch (e) {
    console.error(e)
  }
  loading.value = false
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
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.username {
  font-size: 14px;
  color: var(--text-secondary);
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
.toolbar h2 {
  font-size: 20px;
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

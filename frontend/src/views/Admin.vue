<template>
  <div class="admin-page">
    <header class="topbar">
      <h1 class="logo" @click="router.push('/')">WriteHere</h1>
      <div class="topbar-center">
        <button class="nav-btn" @click="router.push('/')">我的文档</button>
        <button class="nav-btn" @click="router.push('/community')">社区</button>
        <button class="nav-btn active" @click="router.push('/admin')">文档管理</button>
      </div>
      <div class="topbar-right">
        <span class="username">{{ user?.username }}</span>
        <button class="ghost" @click="handleLogout">退出</button>
      </div>
    </header>
    <main class="main-content">
      <div class="toolbar">
        <h2>文档管理</h2>
      </div>
      <div v-if="loading" class="empty">加载中...</div>
      <div v-else-if="docs.length === 0" class="empty">
        <p>暂无文档</p>
      </div>
      <div v-else class="doc-grid">
        <div v-for="doc in docs" :key="doc.id" class="doc-card">
          <div class="doc-card-body">
            <div class="doc-header">
              <h3 class="doc-title">{{ doc.title }}</h3>
              <div class="doc-meta">
                <span class="doc-author">作者：{{ doc.username }}</span>
                <span class="doc-visibility" :class="{ 'public': doc.visibility === 'public' }">
                  {{ doc.visibility === 'public' ? '公开' : '私密' }}
                </span>
              </div>
            </div>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <span class="doc-time">{{ formatTime(doc.updatedAt) }}</span>
            <div class="doc-card-actions">
              <button class="icon-btn" title="查看" @click="openDoc(doc.id)">&#128065;</button>
            </div>
          </div>
        </div>
      </div>
    </main>
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

onMounted(() => {
  if (!user.value?.isAdmin) {
    router.push('/')
    return
  }
  loadDocs()
})

async function loadDocs() {
  loading.value = true
  try {
    docs.value = await api.getAdminDocs(user.value.id)
  } catch (e) {
    console.error(e)
    router.push('/')
  }
  loading.value = false
}

function openDoc(id) {
  router.push(`/doc/${id}`)
}

function handleLogout() {
  clearUser()
  router.push('/login')
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
.admin-page {
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
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 180px;
}
.doc-header {
  margin-bottom: 8px;
}
.doc-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
}
.doc-visibility {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-gray);
  font-size: 10px;
}
.doc-visibility.public {
  background: #e8f5e8;
  color: #2e7d32;
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
.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--bg-gray);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.2s;
}
.icon-btn:hover {
  background: var(--primary);
  color: #fff;
}
</style>
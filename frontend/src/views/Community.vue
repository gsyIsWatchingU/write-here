<template>
  <div class="community-page">
    <header class="topbar">
      <h1 class="logo" @click="router.push('/')">WriteHere</h1>
      <div class="topbar-center">
        <button class="nav-btn" :class="{ active: isHomeActive }" @click="router.push('/')">我的文档</button>
        <button class="nav-btn" :class="{ active: isCommunityActive }" @click="router.push('/community')">社区</button>
        <button v-if="user?.isAdmin" class="nav-btn" :class="{ active: isAdminActive }" @click="router.push('/admin')">文档管理</button>
      </div>
      <div class="topbar-right">
        <span class="username">{{ user?.username }}</span>
        <button class="ghost" @click="handleLogout">退出</button>
      </div>
    </header>
    <main class="main-content">
      <div class="toolbar">
        <h2>社区文档</h2>
        <div class="sort-options">
          <button 
            v-for="option in sortOptions" 
            :key="option.value"
            :class="['sort-btn', { active: sortBy === option.value }]"
            @click="handleSort(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div v-if="loading" class="empty">加载中...</div>
      <div v-else-if="docs.length === 0" class="empty">
        <p>社区还没有公开文档</p>
      </div>
      <div v-else class="doc-grid">
        <div v-for="doc in docs" :key="doc.id" class="doc-card" @click="openDoc(doc.id)">
          <div class="doc-card-body">
            <div class="doc-header">
              <h3 class="doc-title">{{ doc.title }}</h3>
              <span class="doc-author">作者：{{ doc.username }}</span>
            </div>
            <p class="doc-preview">{{ stripHtml(doc.content) }}</p>
          </div>
          <div class="doc-card-footer">
            <div class="doc-info">
              <span class="doc-time">{{ formatTime(doc.updatedAt) }}</span>
              <span class="doc-likes">
                <button class="like-btn" @click.stop="handleLike(doc.id, $event)">
                  <span :class="['like-icon', { liked: likedDocs[doc.id] }]">
                    {{ likedDocs[doc.id] ? '❤' : '🤍' }}
                  </span>
                  {{ doc.likes }}
                </button>
              </span>
            </div>
            <div class="doc-actions">
              <button
                v-if="doc.userId !== user?.id && collabAccess[doc.id] === false"
                class="collab-btn"
                @click.stop="requestCollaboration(doc.id)"
              >
                申请协作
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api, getUser, clearUser } from '../utils/api'

const router = useRouter()
const route = useRoute()
const user = ref(getUser())

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
const sortBy = ref('综合')
const likedDocs = ref({})
const collabAccess = ref({})

const sortOptions = [
  { label: '综合', value: '综合' },
  { label: '最新', value: '最新' },
  { label: '最热', value: '最热' }
]

onMounted(() => {
  loadDocs()
})

async function loadDocs() {
  loading.value = true
  try {
    docs.value = await api.getCommunityDocs(sortBy.value)
    collabAccess.value = {}
    // 检查用户点赞状态
    for (const doc of docs.value) {
      const status = await api.checkLikeStatus(doc.id, user.value.id)
      likedDocs.value[doc.id] = status.liked
    }

    // 检查协作权限（有权限则不显示“申请协作”）
    await Promise.all(
      docs.value.map(async (doc) => {
        if (!user.value || doc.userId === user.value.id) {
          collabAccess.value[doc.id] = true
          return
        }
        try {
          const access = await api.checkCollaborationAccess(doc.id, user.value.id)
          collabAccess.value[doc.id] = !!access.hasAccess
        } catch (e) {
          // 无权限/无记录都视为未获协作权限
          collabAccess.value[doc.id] = false
        }
      })
    )

    // 对没有协作权限检查结果的默认允许申请（兜底）
    for (const doc of docs.value) {
      if (collabAccess.value[doc.id] === undefined) collabAccess.value[doc.id] = false
    }
  } catch (e) {
    console.error(e)
  }
  loading.value = false
}

function handleSort(value) {
  sortBy.value = value
  loadDocs()
}

function openDoc(id) {
  router.push(`/doc/${id}`)
}

async function handleLike(docId, event) {
  event.stopPropagation()
  try {
    const result = await api.toggleLike(docId, user.value.id)
    likedDocs.value[docId] = result.liked
    // 更新点赞数
    const doc = docs.value.find(d => d.id === docId)
    if (doc) {
      doc.likes += result.liked ? 1 : -1
    }
  } catch (e) {
    console.error(e)
  }
}

async function requestCollaboration(docId) {
  try {
    await api.requestCollaboration(docId, user.value.id)
    alert('协作请求已发送，等待作者批准')
  } catch (e) {
    alert(e.message)
  }
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
.community-page {
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
.sort-options {
  display: flex;
  gap: 8px;
}
.sort-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius);
  transition: all 0.2s;
}
.sort-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.sort-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
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
  min-height: 180px;
}
.doc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
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
.doc-author {
  font-size: 12px;
  color: var(--text-muted);
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
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.doc-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.doc-time {
  font-size: 12px;
  color: var(--text-muted);
}
.doc-likes {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.like-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  transition: all 0.2s;
}
.like-btn:hover {
  color: var(--primary);
}
.like-icon {
  font-size: 14px;
  transition: all 0.2s;
}
.like-icon.liked {
  color: #ff4757;
}
.doc-actions {
  margin-top: 8px;
}
.collab-btn {
  padding: 4px 12px;
  border: 1px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.2s;
}
.collab-btn:hover {
  background: var(--primary);
  color: #fff;
}
</style>
<template>
  <div class="problems-page">
    <header class="topbar">
      <h1 class="brand-logo" @click="router.push('/')">
        <img src="/horizon-docs.svg" alt="" aria-hidden="true">
        <span>Horizon Docs</span>
      </h1>
      <nav class="topbar-center">
        <button class="nav-btn" @click="router.push('/')">[01] 我的文档</button>
        <button class="nav-btn active">[02] 题库</button>
        <button class="nav-btn" @click="router.push('/community')">[03] 社区</button>
      </nav>
      <div class="topbar-right">
        <span class="username">{{ user?.username }}</span>
        <button class="ghost" @click="logout">退出</button>
      </div>
    </header>

    <main class="main-content">
      <section class="hero">
        <div>
          <p class="eyebrow">PROBLEM CONTENT SOURCE</p>
          <h2>算法题库</h2>
          <p>在这里维护题面；测试用例和判题配置留在 Algorithm Lab。</p>
        </div>
        <button class="primary" :disabled="creating" @click="createProblem">
          {{ creating ? '创建中...' : '+ 新建题目' }}
        </button>
      </section>

      <p v-if="notice" class="notice" :class="{ error: noticeError }">{{ notice }}</p>
      <div v-if="loading" class="empty">加载中...</div>
      <div v-else-if="problems.length === 0" class="empty">还没有题目，先创建第一道题。</div>
      <div v-else class="problem-grid">
        <article v-for="problem in problems" :key="problem.id" class="problem-card">
          <div class="problem-card-main" @click="openProblem(problem.id)">
            <div class="problem-title-row">
              <h3>{{ problem.title }}</h3>
              <span class="status" :class="problem.publishStatus">
                {{ problem.publishStatus === 'published' ? `已发布 v${problem.publishedVersion}` : '草稿' }}
              </span>
            </div>
            <p>{{ stripHtml(problem.content) || '暂无题面内容' }}</p>
            <time>{{ formatTime(problem.updatedAt) }}</time>
          </div>
          <div class="problem-actions">
            <button class="ghost" @click="openProblem(problem.id)">编辑题面</button>
            <button v-if="problem.publishStatus !== 'published'" class="primary" @click="publish(problem.id)">发布</button>
            <template v-else>
              <button class="primary" @click="publish(problem.id)">发布新版本</button>
              <button class="ghost" @click="copyIntegration(problem)">复制关联链接</button>
              <button class="ghost danger-text" @click="unpublish(problem.id)">取消发布</button>
            </template>
          </div>
        </article>
      </div>
    </main>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, clearUser, getUser } from '../utils/api'
import { formatServerDateTime } from '../utils/dateTime'

const router = useRouter()
const user = ref(getUser())
const problems = ref([])
const loading = ref(true)
const creating = ref(false)
const notice = ref('')
const noticeError = ref(false)

function showNotice(message, error = false) {
  notice.value = message
  noticeError.value = error
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 3200)
}

async function loadProblems() {
  loading.value = true
  try {
    problems.value = await api.getProblems()
  } catch (error) {
    if (error.message.includes('登录已过期')) {
      clearUser()
      router.push('/login')
      return
    }
    showNotice(error.message, true)
  } finally {
    loading.value = false
  }
}

async function createProblem() {
  creating.value = true
  try {
    const problem = await api.createProblem()
    router.push(`/doc/${problem.id}?from=problems`)
  } catch (error) {
    showNotice(error.message, true)
  } finally {
    creating.value = false
  }
}

function openProblem(id) {
  router.push(`/doc/${id}?from=problems`)
}

async function publish(id) {
  try {
    await api.publishProblem(id)
    await loadProblems()
    showNotice('发布成功，Algorithm Lab 将读取这个版本。')
  } catch (error) {
    showNotice(error.message, true)
  }
}

async function unpublish(id) {
  try {
    await api.unpublishProblem(id)
    await loadProblems()
    showNotice('已取消发布，算法训练网站将停止显示题面。')
  } catch (error) {
    showNotice(error.message, true)
  }
}

async function copyIntegration(problem) {
  const url = new URL(`/embed/problems/${problem.id}`, window.location.origin)
  url.hash = new URLSearchParams({ token: problem.embedToken }).toString()
  try {
    await navigator.clipboard.writeText(url.toString())
    showNotice('关联链接已复制，请粘贴到 Algorithm Lab。')
  } catch {
    showNotice(`请复制：${url}`, true)
  }
}

function stripHtml(html) {
  const element = document.createElement('div')
  element.innerHTML = html || ''
  return element.textContent?.trim().slice(0, 140) || ''
}

function formatTime(value) {
  return formatServerDateTime(value)
}

function logout() {
  clearUser()
  router.push('/login')
}

onMounted(loadProblems)
</script>

<style scoped>
.problems-page { min-height: 100vh; background: var(--bg-gray); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 24px; background: #fff; border-bottom: 2px solid var(--text-primary); }
.brand-logo { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 18px; }
.brand-logo img { width: 26px; height: 26px; }
.topbar-center, .topbar-right { display: flex; align-items: center; gap: 10px; }
.main-content { max-width: 1440px; margin: 0 auto; padding: 34px 24px 60px; }
.hero { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 26px; padding: 26px; background: #fff; border: 2px solid var(--text-primary); }
.hero h2 { margin: 4px 0 8px; font-size: 28px; }
.hero p { color: var(--text-muted); }
.eyebrow { color: var(--primary) !important; font: 700 12px/1.4 monospace; letter-spacing: .12em; }
.problem-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
.problem-card { display: flex; min-height: 220px; flex-direction: column; justify-content: space-between; background: #fff; border: 2px solid var(--text-primary); }
.problem-card-main { flex: 1; padding: 20px; cursor: pointer; }
.problem-title-row { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.problem-title-row h3 { font-size: 17px; }
.status { flex: none; padding: 3px 8px; border: 1px solid var(--border); font-size: 12px; }
.status.published { background: var(--primary); color: #fff; border-color: var(--primary); }
.problem-card-main p { margin: 18px 0; color: var(--text-muted); line-height: 1.6; }
.problem-card-main time { font-size: 12px; color: var(--text-muted); }
.problem-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
.notice { margin-bottom: 18px; padding: 12px 14px; background: #edf6ef; border: 1px solid var(--primary); }
.notice.error { background: #fff0f0; border-color: var(--danger); color: var(--danger); }
.danger-text { color: var(--danger); }
@media (max-width: 760px) {
  .topbar { align-items: flex-start; flex-wrap: wrap; padding: 12px 14px; }
  .topbar-center { order: 3; width: 100%; overflow-x: auto; }
  .username { display: none; }
  .main-content { padding: 20px 14px 40px; }
  .hero { align-items: stretch; flex-direction: column; }
  .problem-grid { grid-template-columns: 1fr; }
}
</style>

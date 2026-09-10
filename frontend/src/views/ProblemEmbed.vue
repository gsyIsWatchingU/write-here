<template>
  <main ref="root" class="embed-page">
    <div v-if="loading" class="state">题面加载中...</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <article v-else class="editor-content" v-html="problem.content"></article>
  </main>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../utils/api'

const route = useRoute()
const root = ref(null)
const loading = ref(true)
const error = ref('')
const problem = ref({ content: '' })
let resizeObserver = null

function reportHeight() {
  const height = Math.ceil(root.value?.getBoundingClientRect().height || 260)
  window.parent.postMessage({
    type: 'write-here:problem-height',
    sourceId: String(route.params.id),
    height
  }, '*')
}

onMounted(async () => {
  try {
    const token = new URLSearchParams(route.hash.replace(/^#/, '')).get('token') || ''
    const data = await api.getProblemContent(route.params.id, token)
    problem.value = data.problem
  } catch (caught) {
    error.value = caught.message || '题面加载失败'
  } finally {
    loading.value = false
    await nextTick()
    resizeObserver = new ResizeObserver(reportHeight)
    resizeObserver.observe(root.value)
    reportHeight()
  }
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
:global(html), :global(body), :global(#app) { min-height: 0; margin: 0; background: #fff; }
.embed-page { min-height: 260px; padding: 2px 4px 18px; color: #171c18; font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace; }
.state { padding: 42px 12px; text-align: center; color: #5b665e; }
.state.error { color: #a93f36; }
.editor-content :deep(h1) { margin: 0 0 18px; font-size: 24px; }
.editor-content :deep(h2) { margin: 24px 0 10px; font-size: 18px; }
.editor-content :deep(h3) { margin: 20px 0 8px; font-size: 16px; }
.editor-content :deep(p) { margin: 0 0 12px; line-height: 1.75; color: #5b665e; }
.editor-content :deep(ul), .editor-content :deep(ol) { margin: 0 0 14px; padding-left: 24px; line-height: 1.7; }
.editor-content :deep(table) { width: 100%; margin: 16px 0; border-collapse: collapse; }
.editor-content :deep(th), .editor-content :deep(td) { padding: 8px 12px; border: 1px solid #c4ccc3; text-align: left; }
.editor-content :deep(th) { background: #f4f5ef; }
.editor-content :deep(pre) { overflow-x: auto; margin: 14px 0; padding: 14px; background: #171c18; color: #f4f5ef; border: 2px solid #171c18; }
.editor-content :deep(code) { padding: 1px 4px; background: #e2ebe0; }
.editor-content :deep(pre code) { padding: 0; background: transparent; color: inherit; }
.editor-content :deep(blockquote) { margin: 14px 0; padding-left: 14px; border-left: 4px solid #97b39b; color: #5b665e; }
.editor-content :deep(img) { max-width: 100%; height: auto; }
.editor-content :deep(a) { color: #466b4d; text-decoration: underline; }
@media (max-width: 520px) { .embed-page { padding-inline: 0; } }
</style>

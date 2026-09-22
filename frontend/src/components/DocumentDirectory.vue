<template>
  <aside class="document-directory" :class="{ open }" aria-label="文档目录">
    <div class="directory-header">
      <div>
        <strong>文档目录</strong>
        <span>{{ documents.length + collaborationDocuments.length }} 篇</span>
      </div>
      <button type="button" class="directory-close" title="收拢文档目录" aria-label="收拢文档目录" @click="$emit('close')">‹</button>
    </div>

    <div class="directory-actions">
      <label class="directory-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="keyword" type="search" placeholder="搜索文档" aria-label="搜索文档">
      </label>
      <button type="button" class="directory-create" @click="$emit('create')">+ 新建文档</button>
    </div>

    <div class="directory-scroll">
      <section class="directory-section">
        <h2>我的文档 <span>{{ filteredDocuments.length }}</span></h2>
        <div v-if="loading" class="directory-empty">加载中...</div>
        <div v-else-if="filteredDocuments.length === 0" class="directory-empty">暂无匹配文档</div>
        <button
          v-for="document in filteredDocuments"
          :key="document.id"
          type="button"
          class="document-entry"
          :data-document-id="document.id"
          :class="{
            active: isActive(document.id),
            dragging: isDragging(document.id),
            'drop-before': isDropTarget(document.id, 'before'),
            'drop-after': isDropTarget(document.id, 'after'),
          }"
          :draggable="canReorder"
          :title="canReorder ? `拖动调整顺序 · ${document.title || '无标题文档'}` : (document.title || '无标题文档')"
          @click="selectDocument(document.id)"
          @dragstart="handleDragStart($event, document.id)"
          @dragover.prevent="handleDragOver($event, document.id)"
          @drop.prevent="handleDrop(document.id)"
          @dragend="resetDrag"
        >
          <span class="drag-handle" aria-hidden="true">⋮⋮</span>
          <span class="document-icon" aria-hidden="true">▤</span>
          <span class="document-copy">
            <strong>{{ document.title || '无标题文档' }}</strong>
            <small>{{ formatUpdatedAt(document.updatedAt) }}</small>
          </span>
        </button>
      </section>

      <section v-if="filteredCollaborationDocuments.length > 0" class="directory-section collaboration-section">
        <h2>与我协作 <span>{{ filteredCollaborationDocuments.length }}</span></h2>
        <button
          v-for="document in filteredCollaborationDocuments"
          :key="document.id"
          type="button"
          class="document-entry"
          :class="{ active: isActive(document.id) }"
          :title="document.title || '无标题文档'"
          @click="$emit('select', document.id)"
        >
          <span class="drag-handle placeholder" aria-hidden="true">⋮⋮</span>
          <span class="document-icon collaboration-icon" aria-hidden="true">◇</span>
          <span class="document-copy">
            <strong>{{ document.title || '无标题文档' }}</strong>
            <small>{{ document.username ? `作者：${document.username}` : '协作文档' }}</small>
          </span>
        </button>
      </section>
    </div>

    <button type="button" class="directory-home" @click="$emit('home')">全部文档 / 工作台 →</button>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
import { filterDocumentDirectory, reorderDocumentDirectory } from '../utils/documentDirectory.js'
import { formatServerDateTime } from '../utils/dateTime.js'

const props = defineProps({
  documents: { type: Array, default: () => [] },
  collaborationDocuments: { type: Array, default: () => [] },
  activeDocumentId: { type: [String, Number], default: null },
  loading: { type: Boolean, default: false },
  open: { type: Boolean, default: true },
})

const emit = defineEmits(['close', 'create', 'select', 'home', 'reorder'])

const keyword = ref('')
const draggedId = ref(null)
const dropTargetId = ref(null)
const dropPlacement = ref('before')
let suppressClickUntil = 0
const filteredDocuments = computed(() => filterDocumentDirectory(props.documents, keyword.value))
const filteredCollaborationDocuments = computed(() => filterDocumentDirectory(props.collaborationDocuments, keyword.value))
const canReorder = computed(() => !keyword.value.trim() && props.documents.length > 1)

function isActive(id) {
  return String(id) === String(props.activeDocumentId)
}

function formatUpdatedAt(value) {
  return formatServerDateTime(value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) || '刚刚更新'
}

function isDragging(id) {
  return String(id) === String(draggedId.value)
}

function isDropTarget(id, placement) {
  return String(id) === String(dropTargetId.value) && dropPlacement.value === placement
}

function selectDocument(id) {
  if (Date.now() < suppressClickUntil) return
  emit('select', id)
}

function handleDragStart(event, id) {
  if (!canReorder.value) {
    event.preventDefault()
    return
  }
  draggedId.value = id
  suppressClickUntil = Date.now() + 500
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(id))
}

function handleDragOver(event, targetId) {
  if (draggedId.value == null || String(draggedId.value) === String(targetId)) {
    dropTargetId.value = null
    return
  }
  const bounds = event.currentTarget.getBoundingClientRect()
  dropTargetId.value = targetId
  dropPlacement.value = event.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before'
  event.dataTransfer.dropEffect = 'move'
}

function handleDrop(targetId) {
  if (draggedId.value == null || String(draggedId.value) === String(targetId)) {
    resetDrag()
    return
  }
  const reordered = reorderDocumentDirectory(
    props.documents,
    draggedId.value,
    targetId,
    dropPlacement.value
  )
  if (reordered !== props.documents) emit('reorder', reordered.map(document => document.id))
  resetDrag()
}

function resetDrag() {
  if (draggedId.value != null) suppressClickUntil = Date.now() + 300
  draggedId.value = null
  dropTargetId.value = null
  dropPlacement.value = 'before'
}
</script>

<style scoped>
.document-directory {
  position: fixed;
  top: calc(var(--editor-header-height, 120px) + 16px);
  bottom: 24px;
  left: 24px;
  z-index: 90;
  display: flex;
  width: 256px;
  min-height: 0;
  flex-direction: column;
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 5px 5px 0 var(--primary);
  transform: translateX(calc(-100% - 34px));
  transition: transform .2s ease;
}
.document-directory.open { transform: translateX(0); }
.directory-header {
  display: flex;
  min-height: 50px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
  border-bottom: 2px solid var(--border);
}
.directory-header > div { display: flex; min-width: 0; flex-direction: column; }
.directory-header strong { font-size: 15px; }
.directory-header span { color: var(--text-muted); font-size: 11px; }
.directory-close {
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.directory-close:hover { color: var(--text); background: var(--surface-hover); border-color: var(--border); }
.directory-actions { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border-soft); }
.directory-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 9px;
  background: var(--bg-gray);
  border: 1px solid var(--border-soft);
}
.directory-search:focus-within { border-color: var(--border); outline: 2px solid var(--primary); outline-offset: 1px; }
.directory-search span { color: var(--text-muted); font-size: 18px; }
.directory-search input { width: 100%; min-width: 0; padding: 0; background: transparent; border: 0; outline: 0; font-family: inherit; }
.directory-create {
  min-height: 34px;
  color: var(--text);
  background: var(--primary);
  border: 1px solid var(--border);
  border-radius: 0;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
}
.directory-create:hover { background: var(--primary-strong); }
.directory-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.directory-section h2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  padding: 8px 6px 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.directory-section h2 span { color: var(--text-muted); font-weight: 400; }
.collaboration-section { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border-soft); }
.document-entry {
  display: flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  margin: 2px 0;
  padding: 6px 8px;
  color: var(--text-secondary);
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  cursor: pointer;
}
.document-entry:hover { color: var(--text); background: var(--surface-hover); border-color: var(--border-soft); }
.document-entry.active { color: var(--text); background: var(--primary); border-color: var(--border); }
.document-entry[draggable="true"] { cursor: grab; }
.document-entry.dragging { opacity: .45; cursor: grabbing; }
.document-entry.drop-before { box-shadow: inset 0 3px 0 var(--primary-strong); }
.document-entry.drop-after { box-shadow: inset 0 -3px 0 var(--primary-strong); }
.drag-handle {
  width: 10px;
  flex: none;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  letter-spacing: -5px;
  line-height: 1;
  cursor: grab;
}
.drag-handle.placeholder { visibility: hidden; }
.document-icon { display: grid; width: 25px; height: 25px; flex: none; place-items: center; border: 1px solid currentColor; font-size: 14px; }
.collaboration-icon { background: var(--bg); }
.document-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.document-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.document-copy small { overflow: hidden; color: var(--text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.document-entry.active small { color: var(--text-secondary); }
.directory-empty { padding: 18px 8px; color: var(--text-muted); text-align: center; font-size: 12px; }
.directory-home {
  min-height: 42px;
  padding: 8px 12px;
  color: var(--text-secondary);
  text-align: left;
  background: var(--bg-gray);
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
  font-family: inherit;
  cursor: pointer;
}
.directory-home:hover { color: var(--text); background: var(--primary); }
@media (max-width: 1200px) {
  .document-directory {
    inset: 0 auto 0 0;
    z-index: 230;
    width: min(84vw, 320px);
    box-shadow: 6px 0 0 rgba(0, 0, 0, .16);
    transform: translateX(-105%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .document-directory { transition: none; }
}
</style>

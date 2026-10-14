<template>
  <div class="comment-item">
    <div class="comment-avatar">{{ comment.username?.slice(0, 1)?.toUpperCase() }}</div>
    <div class="comment-body">
      <div class="comment-meta">
        <strong>{{ comment.username }}</strong>
        <span>{{ formatTime(comment.createdAt) }}</span>
        <span v-if="isEdited" class="edited-badge">已编辑</span>
        <span v-if="comment.isResolved" class="resolved-badge">已解决</span>
      </div>

      <!-- 查看模式 -->
      <p v-if="!editing">{{ comment.content }}</p>

      <!-- 编辑模式 -->
      <div v-else class="edit-area">
        <textarea
          ref="editInput"
          v-model="editContent"
          rows="3"
          maxlength="2000"
          @keydown.ctrl.enter="saveEdit"
        ></textarea>
        <div class="edit-actions">
          <button class="text-action" @click="cancelEdit">取消</button>
          <button class="text-action primary-action" :disabled="!editContent.trim()" @click="saveEdit">保存</button>
        </div>
      </div>

      <div v-if="!editing" class="comment-actions">
        <button :class="['text-action', { active: comment.liked }]" @click="$emit('like', comment)">
          {{ comment.liked ? '♥' : '♡' }} 赞{{ comment.likeCount ? ` ${comment.likeCount}` : '' }}
        </button>
        <button v-if="canEdit" class="text-action" @click="startEdit">编辑</button>
        <button class="text-action" @click="$emit('reply', comment)">回复</button>
        <button v-if="canResolve" class="text-action" @click="$emit('resolve', comment)">
          {{ comment.isResolved ? '重新打开' : '解决' }}
        </button>
        <button v-if="canRemove" class="text-action danger-text" @click="$emit('remove', comment)">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { formatServerDateTime } from '../utils/dateTime'

const props = defineProps({
  comment: { type: Object, required: true },
  currentUserId: { type: [Number, String], default: null },
  ownerId: { type: [Number, String], required: true },
  canResolve: { type: Boolean, default: false }
})

const emit = defineEmits(['like', 'reply', 'remove', 'resolve', 'update'])

const editing = ref(false)
const editContent = ref('')
const editInput = ref(null)

const canEdit = computed(() => props.currentUserId
  && Number(props.currentUserId) === Number(props.comment.userId))

const canRemove = computed(() => props.currentUserId && (
  Number(props.currentUserId) === Number(props.comment.userId)
  || Number(props.currentUserId) === Number(props.ownerId)
))

// 评论有 updatedAt 且与 createdAt 不同步时显示「已编辑」标记
const isEdited = computed(() => {
  if (!props.comment.updatedAt) return false
  return props.comment.updatedAt !== props.comment.createdAt
})

function startEdit() {
  editContent.value = props.comment.content
  editing.value = true
  nextTick(() => editInput.value?.focus())
}

function cancelEdit() {
  editing.value = false
  editContent.value = ''
}

function saveEdit() {
  const content = editContent.value.trim()
  if (!content) return
  emit('update', { id: props.comment.id, content })
  editing.value = false
  editContent.value = ''
}

function formatTime(value) {
  return formatServerDateTime(value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.comment-item { display: flex; gap: 8px; padding: 4px 0; }
.comment-avatar { width: 24px; height: 24px; display: grid; place-items: center; flex: none; color: var(--text); background: var(--primary); border: 1px solid var(--border); font-size: 11px; font-weight: 800; }
.comment-body { flex: 1; min-width: 0; }
.comment-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 11.5px; }
.comment-meta span { color: var(--text-muted); }
.comment-meta .resolved-badge { padding: 0 5px; color: var(--text); background: var(--primary); border: 1px solid var(--border); font-size: 10px; }
.comment-meta .edited-badge { font-size: 10px; }
p { margin: 3px 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); font-size: 13.5px; line-height: 1.5; }
.comment-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.text-action { min-height: auto; padding: 0; color: var(--text-muted); background: none; border: 0; font-size: 11.5px; cursor: pointer; }
.text-action:hover, .text-action.active { color: var(--primary-strong); background: none; }
.text-action.danger-text:hover { color: #b42318; }
.text-action.primary-action { color: var(--primary-strong); font-weight: 700; }

.edit-area { margin: 3px 0; }
.edit-area textarea { width: 100%; padding: 4px 6px; resize: vertical; border: 2px solid var(--border); background: var(--bg); font: inherit; font-size: 13.5px; line-height: 1.5; outline: none; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>

<template>
  <div class="comment-item">
    <div class="comment-avatar">{{ comment.username?.slice(0, 1)?.toUpperCase() }}</div>
    <div class="comment-body">
      <div class="comment-meta">
        <strong>{{ comment.username }}</strong>
        <span>{{ formatTime(comment.createdAt) }}</span>
        <span v-if="comment.isResolved" class="resolved-badge">已解决</span>
      </div>
      <p>{{ comment.content }}</p>
      <div class="comment-actions">
        <button :class="['text-action', { active: comment.liked }]" @click="$emit('like', comment)">
          {{ comment.liked ? '♥' : '♡' }} 赞{{ comment.likeCount ? ` ${comment.likeCount}` : '' }}
        </button>
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
import { computed } from 'vue'

const props = defineProps({
  comment: { type: Object, required: true },
  currentUserId: { type: [Number, String], default: null },
  ownerId: { type: [Number, String], required: true },
  canResolve: { type: Boolean, default: false }
})

defineEmits(['like', 'reply', 'remove', 'resolve'])

const canRemove = computed(() => props.currentUserId && (
  Number(props.currentUserId) === Number(props.comment.userId)
  || Number(props.currentUserId) === Number(props.ownerId)
))

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.comment-item { display: flex; gap: 10px; padding: 7px 0; }
.comment-avatar { width: 28px; height: 28px; display: grid; place-items: center; flex: none; color: var(--text); background: var(--primary); border: 1px solid var(--border); font-size: 12px; font-weight: 800; }
.comment-body { flex: 1; min-width: 0; }
.comment-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; }
.comment-meta span { color: var(--text-muted); }
.comment-meta .resolved-badge { padding: 1px 6px; color: var(--text); background: var(--primary); border: 1px solid var(--border); }
p { margin: 7px 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); font-size: 14px; line-height: 1.65; }
.comment-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.text-action { min-height: auto; padding: 0; color: var(--text-muted); background: none; border: 0; font-size: 12px; }
.text-action:hover, .text-action.active { color: var(--primary-strong); background: none; }
.text-action.danger-text:hover { color: #b42318; }
</style>

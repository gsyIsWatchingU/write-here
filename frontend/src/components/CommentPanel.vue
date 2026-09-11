<template>
  <section class="comments-section">
    <div class="comments-header">
      <div>
        <span class="eyebrow">DISCUSSION</span>
        <h2>评论 <span>{{ threads.length }}</span></h2>
      </div>
      <label class="resolved-toggle">
        <input v-model="showResolved" type="checkbox" />
        显示已解决
      </label>
    </div>

    <div v-if="user" class="comment-composer" :class="{ anchored: pendingAnchor }">
      <div v-if="pendingAnchor" class="selected-quote">
        <span>评论原文</span>
        <blockquote>{{ pendingAnchor.quoteText }}</blockquote>
        <button class="text-action" type="button" @click="cancelPendingAnchor">改为全文评论</button>
      </div>
      <textarea
        ref="commentInput"
        v-model="commentContent"
        rows="3"
        maxlength="2000"
        :placeholder="pendingAnchor ? '评论选中的内容，输入 @用户名 可提及对方' : '评论整篇文档，输入 @用户名 可提及对方'"
        @keydown.ctrl.enter="addComment()"
      ></textarea>
      <div class="composer-footer">
        <span>{{ commentContent.length }}/2000 · Ctrl + Enter</span>
        <button class="primary" :disabled="submitting || !commentContent.trim()" @click="addComment()">
          {{ submitting ? '发布中...' : '发布' }}
        </button>
      </div>
    </div>
    <div v-else class="login-prompt">
      <span>登录后参与讨论</span>
      <button class="primary" @click="router.push('/login')">去登录</button>
    </div>

    <div v-if="loading" class="comment-empty">加载评论中...</div>
    <div v-else-if="visibleThreads.length === 0" class="comment-empty">
      {{ showResolved ? '暂无评论' : '暂无未解决评论' }}
    </div>

    <article
      v-for="thread in visibleThreads"
      v-else
      :id="`comment-${thread.id}`"
      :key="thread.id"
      class="comment-thread"
      :class="{
        resolved: thread.isResolved,
        focused: Number(activeCommentId) === Number(thread.id),
        orphaned: thread.anchorStatus === 'orphaned',
      }"
      @click="focusThread(thread.id, true)"
    >
      <div v-if="thread.quoteText" class="thread-quote">
        <span>{{ thread.anchorStatus === 'orphaned' ? '原文已删除或发生较大修改' : '评论原文' }}</span>
        <blockquote>{{ thread.quoteText }}</blockquote>
      </div>

      <CommentItem
        :comment="thread"
        :current-user-id="user?.id"
        :owner-id="ownerId"
        :can-resolve="canResolve(thread)"
        @like="toggleLike"
        @reply="startReply"
        @remove="removeComment"
        @resolve="toggleResolved"
      />

      <div v-if="repliesFor(thread.id).length" class="reply-list">
        <CommentItem
          v-for="reply in repliesFor(thread.id)"
          :key="reply.id"
          :comment="reply"
          :current-user-id="user?.id"
          :owner-id="ownerId"
          @like="toggleLike"
          @reply="startReply"
          @remove="removeComment"
        />
      </div>

      <div v-if="replyingTo === thread.id" class="reply-composer" @click.stop>
        <textarea
          ref="replyInput"
          v-model="replyContent"
          rows="2"
          maxlength="2000"
          :placeholder="`回复 ${replyTargetName}`"
          @keydown.ctrl.enter="addComment(thread.id)"
        ></textarea>
        <div class="reply-actions">
          <button class="ghost small" @click="cancelReply">取消</button>
          <button class="primary small" :disabled="submitting || !replyContent.trim()" @click="addComment(thread.id)">回复</button>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, getUser } from '../utils/api'
import {
  commentAnchorPluginKey,
  createCommentAnchorPlugin,
  isAnchoredComment,
  mapCommentAnchor,
  refreshCommentDecorations,
  resolveCommentAnchor,
} from '../utils/commentAnchors'
import CommentItem from './CommentItem.vue'

const props = defineProps({
  docId: { type: [Number, String], required: true },
  ownerId: { type: [Number, String], required: true },
  shareToken: { type: String, default: '' },
  focusedCommentId: { type: [Number, String], default: null },
  editor: { type: Object, default: null },
  pendingAnchor: { type: Object, default: null },
  canPersistAnchors: { type: Boolean, default: false },
  documentReady: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'anchor-created', 'anchor-cancelled', 'count-change'])
const router = useRouter()
const user = getUser()
const comments = ref([])
const commentContent = ref('')
const replyContent = ref('')
const replyingTo = ref(null)
const replyTargetName = ref('')
const replyTargetUserId = ref(null)
const replyInput = ref(null)
const commentInput = ref(null)
const showResolved = ref(false)
const loading = ref(true)
const submitting = ref(false)
const activeCommentId = ref(null)
let anchorPluginRegistered = false
let anchorSaveTimer = null
const dirtyAnchors = new Map()

const threads = computed(() => comments.value.filter(comment => !comment.parentId))
const visibleThreads = computed(() => threads.value.filter(thread => showResolved.value || !thread.isResolved))

function refreshDecorations() {
  refreshCommentDecorations(props.editor, threads.value, activeCommentId.value, showResolved.value)
}

function threadForComment(commentId) {
  const comment = comments.value.find(item => Number(item.id) === Number(commentId))
  if (!comment) return null
  return comment.parentId
    ? comments.value.find(item => Number(item.id) === Number(comment.parentId)) || null
    : comment
}

function setupAnchorPlugin() {
  if (!props.editor || anchorPluginRegistered) return
  props.editor.registerPlugin(createCommentAnchorPlugin(commentId => {
    emit('open')
    focusThread(commentId, false)
  }))
  anchorPluginRegistered = true
  refreshDecorations()
}

onMounted(async () => {
  setupAnchorPlugin()
  props.editor?.on('transaction', handleEditorTransaction)
  await loadComments()
  if (props.focusedCommentId) focusThread(props.focusedCommentId, true)
})

onBeforeUnmount(() => {
  if (anchorSaveTimer) clearTimeout(anchorSaveTimer)
  if (dirtyAnchors.size) flushAnchorUpdates()
  props.editor?.off('transaction', handleEditorTransaction)
  if (anchorPluginRegistered) props.editor?.unregisterPlugin(commentAnchorPluginKey)
})

watch(() => props.editor, () => {
  setupAnchorPlugin()
  refreshDecorations()
})

watch(() => props.pendingAnchor, anchor => {
  if (anchor) nextTick(() => commentInput.value?.focus())
})

watch(() => props.focusedCommentId, commentId => {
  if (commentId) focusThread(commentId, true)
})

watch(() => props.documentReady, ready => {
  if (ready) reconcileAnchors()
})

watch(showResolved, refreshDecorations)
watch(threads, value => emit('count-change', value.length))

async function loadComments() {
  loading.value = true
  try {
    comments.value = await api.getDocComments(props.docId, user?.id, props.shareToken)
    if (props.documentReady) reconcileAnchors()
    emit('count-change', threads.value.length)
  } catch (error) {
    console.error('加载评论失败:', error)
  } finally {
    loading.value = false
    refreshDecorations()
  }
}

function reconcileAnchors() {
  if (!props.editor || !props.documentReady) return
  let changed = false
  comments.value = comments.value.map(comment => {
    if (!isAnchoredComment(comment)) return comment
    const resolved = resolveCommentAnchor(props.editor.state.doc, comment)
    if (
      resolved.anchorFrom !== comment.anchorFrom
      || resolved.anchorTo !== comment.anchorTo
      || resolved.anchorStatus !== comment.anchorStatus
    ) {
      changed = true
      queueAnchorUpdate(resolved)
    }
    return resolved
  })
  if (changed) scheduleAnchorSync()
  refreshDecorations()
}

function handleEditorTransaction({ transaction }) {
  if (!transaction.docChanged || !props.documentReady || !comments.value.length) return
  let changed = false
  comments.value = comments.value.map(comment => {
    if (!isAnchoredComment(comment)) return comment
    const mapped = comment.anchorStatus === 'orphaned'
      ? resolveCommentAnchor(transaction.doc, comment)
      : mapCommentAnchor(comment, transaction)
    if (
      mapped.anchorFrom !== comment.anchorFrom
      || mapped.anchorTo !== comment.anchorTo
      || mapped.quoteText !== comment.quoteText
      || mapped.anchorStatus !== comment.anchorStatus
    ) {
      changed = true
      queueAnchorUpdate(mapped)
    }
    return mapped
  })
  if (changed) scheduleAnchorSync()
  refreshDecorations()
}

function queueAnchorUpdate(comment) {
  if (!props.canPersistAnchors) return
  dirtyAnchors.set(comment.id, {
    id: comment.id,
    from: Number(comment.anchorFrom),
    to: Number(comment.anchorTo),
    quoteText: comment.quoteText,
    quotePrefix: comment.quotePrefix || '',
    quoteSuffix: comment.quoteSuffix || '',
    status: comment.anchorStatus,
  })
}

function scheduleAnchorSync() {
  if (!props.canPersistAnchors || !dirtyAnchors.size) return
  if (anchorSaveTimer) clearTimeout(anchorSaveTimer)
  anchorSaveTimer = setTimeout(flushAnchorUpdates, 900)
}

async function flushAnchorUpdates() {
  if (!props.canPersistAnchors || !dirtyAnchors.size || !user) return
  if (anchorSaveTimer) clearTimeout(anchorSaveTimer)
  anchorSaveTimer = null
  const anchors = [...dirtyAnchors.values()]
  dirtyAnchors.clear()
  try {
    await api.updateCommentAnchors(props.docId, user.id, anchors, props.shareToken)
  } catch (error) {
    anchors.forEach(anchor => dirtyAnchors.set(anchor.id, anchor))
    console.error('同步评论锚点失败:', error)
  }
}

function repliesFor(threadId) {
  return comments.value.filter(comment => Number(comment.parentId) === Number(threadId))
}

function canResolve(thread) {
  return user && (Number(user.id) === Number(props.ownerId) || Number(user.id) === Number(thread.userId))
}

async function addComment(parentId = null) {
  const content = parentId ? replyContent.value.trim() : commentContent.value.trim()
  if (!user || !content || submitting.value) return
  submitting.value = true
  try {
    const comment = await api.addComment(
      props.docId,
      user.id,
      content,
      parentId,
      props.shareToken,
      parentId ? null : props.pendingAnchor,
      parentId ? replyTargetUserId.value : null,
    )
    if (parentId) {
      comments.value.push(comment)
      cancelReply()
    } else {
      comments.value.unshift(comment)
      commentContent.value = ''
      if (props.pendingAnchor) emit('anchor-created', comment)
      activeCommentId.value = comment.id
    }
    refreshDecorations()
  } catch (error) {
    alert(error.message)
  } finally {
    submitting.value = false
  }
}

function cancelPendingAnchor() {
  emit('anchor-cancelled')
  nextTick(() => commentInput.value?.focus())
}

function startReply(comment) {
  const rootId = comment.parentId || comment.id
  replyingTo.value = Number(rootId)
  replyTargetName.value = `@${comment.username}`
  replyTargetUserId.value = comment.userId
  replyContent.value = `@${comment.username} `
  nextTick(() => replyInput.value?.[0]?.focus?.() || replyInput.value?.focus?.())
}

function cancelReply() {
  replyingTo.value = null
  replyTargetName.value = ''
  replyTargetUserId.value = null
  replyContent.value = ''
}

async function toggleLike(comment) {
  if (!user) return router.push('/login')
  try {
    const result = await api.toggleCommentLike(comment.id, user.id, props.shareToken)
    comment.liked = result.liked
    comment.likeCount = result.likeCount
  } catch (error) {
    alert(error.message)
  }
}

async function toggleResolved(thread) {
  try {
    const result = await api.resolveComment(thread.id, user.id, !thread.isResolved)
    thread.isResolved = result.isResolved
    refreshDecorations()
  } catch (error) {
    alert(error.message)
  }
}

async function removeComment(comment) {
  if (!confirm('确定删除这条评论吗？')) return
  try {
    await api.deleteComment(comment.id, user.id)
    comments.value = comments.value.filter(item => item.id !== comment.id && item.parentId !== comment.id)
    if (Number(activeCommentId.value) === Number(comment.id)) activeCommentId.value = null
    refreshDecorations()
  } catch (error) {
    alert(error.message)
  }
}

function focusThread(commentId, scrollText) {
  const thread = threadForComment(commentId)
  if (!thread) return
  if (thread.isResolved) showResolved.value = true
  activeCommentId.value = thread.id
  emit('open')
  refreshDecorations()
  nextTick(() => {
    document.getElementById(`comment-${thread.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    if (!scrollText || thread.anchorStatus !== 'active') return
    const anchor = props.editor?.view?.dom?.querySelector(`[data-comment-anchor-id="${thread.id}"]`)
    anchor?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}
</script>

<style scoped>
.comments-section { width: 100%; min-width: 0; }
.comments-header, .composer-footer, .reply-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.comments-header { position: sticky; top: 0; z-index: 2; padding: 2px 2px 13px; background: var(--bg); border-bottom: 1px solid var(--border-soft); }
.eyebrow { color: var(--text-muted); font-size: 10px; letter-spacing: .14em; }
h2 { margin: 2px 0 0; font-size: 17px; } h2 span { color: var(--text-muted); font-weight: 400; }
.resolved-toggle { display: flex; flex: none; gap: 6px; align-items: center; color: var(--text-secondary); font-size: 11px; white-space: nowrap; }
.resolved-toggle input { width: 14px; height: 14px; padding: 0; accent-color: var(--primary-strong); }
.comment-composer { margin-top: 16px; padding: 12px; background: var(--bg-gray); border: 1px solid var(--border-soft); }
.comment-composer:focus-within { border-color: var(--border); outline: 2px solid var(--primary); outline-offset: 2px; }
.comment-composer.anchored { border-left: 3px solid var(--primary-strong); }
textarea { width: 100%; min-height: 76px; padding: 2px 0; resize: vertical; border: 0; background: transparent; line-height: 1.65; outline: none; }
.composer-footer { margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border-soft); }
.composer-footer span { color: var(--text-muted); font-size: 10px; }
.composer-footer .primary { min-height: 34px; padding: 6px 12px; }
.selected-quote, .thread-quote { margin-bottom: 9px; }
.selected-quote > span, .thread-quote > span { color: var(--primary-strong); font-size: 10px; }
blockquote { max-height: 82px; margin: 5px 0; padding: 6px 9px; overflow: hidden; color: var(--text-secondary); background: var(--bg); border-left: 3px solid var(--primary); font-size: 12px; line-height: 1.55; }
.thread-quote blockquote { background: var(--surface-hover); }
.text-action { min-height: auto; padding: 0; color: var(--text-muted); background: none; border: 0; font-size: 11px; }
.comment-thread { margin-top: 12px; padding: 12px; border: 1px solid var(--border); background: var(--bg); cursor: pointer; }
.comment-thread:hover { border-color: var(--primary-strong); }
.comment-thread.resolved { opacity: .62; }
.comment-thread.focused { outline: 3px solid var(--primary); }
.comment-thread.orphaned { border-style: dashed; }
.reply-list { margin: 10px 0 0 18px; padding-left: 10px; border-left: 2px solid var(--primary); }
.reply-composer { margin: 10px 0 0 18px; padding: 9px; background: var(--surface-hover); border: 1px solid var(--border); }
.reply-actions { justify-content: flex-end; margin-top: 7px; }
.comment-empty { margin-top: 12px; padding: 26px 12px; text-align: center; color: var(--text-muted); border-top: 1px solid var(--border-soft); }
.login-prompt { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 16px; padding: 16px 12px; color: var(--text-muted); background: var(--bg-gray); border: 1px solid var(--border-soft); }
@media (max-width: 760px) { .reply-list, .reply-composer { margin-left: 8px; } }
</style>

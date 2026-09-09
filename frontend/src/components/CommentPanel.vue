<template>
  <section class="comments-section" :id="focusedCommentId ? `comment-${focusedCommentId}` : undefined">
    <div class="comments-header">
      <div>
        <span class="eyebrow">DISCUSSION</span>
        <h2>评论 <span>{{ comments.length }}</span></h2>
      </div>
      <label class="resolved-toggle">
        <input v-model="showResolved" type="checkbox" />
        显示已解决
      </label>
    </div>

    <div v-if="user" class="comment-composer">
      <textarea
        v-model="commentContent"
        rows="3"
        maxlength="2000"
        placeholder="写下评论，输入 @用户名 可提及对方"
        @keydown.ctrl.enter="addComment()"
      ></textarea>
      <div class="composer-footer">
        <span>{{ commentContent.length }}/2000 · Ctrl + Enter 发布</span>
        <button class="primary" :disabled="submitting || !commentContent.trim()" @click="addComment()">
          {{ submitting ? '发布中...' : '发布评论' }}
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
      :class="{ resolved: thread.isResolved, focused: Number(focusedCommentId) === thread.id }"
    >
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

      <div v-if="replyingTo === thread.id" class="reply-composer">
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
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, getUser } from '../utils/api'
import CommentItem from './CommentItem.vue'

const props = defineProps({
  docId: { type: [Number, String], required: true },
  ownerId: { type: [Number, String], required: true },
  shareToken: { type: String, default: '' },
  focusedCommentId: { type: [Number, String], default: null }
})

const router = useRouter()
const user = getUser()
const comments = ref([])
const commentContent = ref('')
const replyContent = ref('')
const replyingTo = ref(null)
const replyTargetName = ref('')
const replyInput = ref(null)
const showResolved = ref(false)
const loading = ref(true)
const submitting = ref(false)

const threads = computed(() => comments.value.filter(comment => !comment.parentId))
const visibleThreads = computed(() => threads.value.filter(thread => showResolved.value || !thread.isResolved))

onMounted(async () => {
  await loadComments()
  if (props.focusedCommentId) {
    showResolved.value = true
    await nextTick()
    document.getElementById(`comment-${props.focusedCommentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})

async function loadComments() {
  loading.value = true
  try {
    comments.value = await api.getDocComments(props.docId, user?.id, props.shareToken)
  } catch (error) {
    console.error('加载评论失败:', error)
  } finally {
    loading.value = false
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
    const comment = await api.addComment(props.docId, user.id, content, parentId, props.shareToken)
    if (parentId) {
      comments.value.push(comment)
      cancelReply()
    } else {
      comments.value.unshift(comment)
      commentContent.value = ''
    }
  } catch (error) {
    alert(error.message)
  } finally {
    submitting.value = false
  }
}

function startReply(comment) {
  const rootId = comment.parentId || comment.id
  replyingTo.value = Number(rootId)
  replyTargetName.value = `@${comment.username}`
  replyContent.value = `@${comment.username} `
  nextTick(() => replyInput.value?.[0]?.focus?.() || replyInput.value?.focus?.())
}

function cancelReply() {
  replyingTo.value = null
  replyTargetName.value = ''
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
  } catch (error) {
    alert(error.message)
  }
}

async function removeComment(comment) {
  if (!confirm('确定删除这条评论吗？')) return
  try {
    await api.deleteComment(comment.id, user.id)
    comments.value = comments.value.filter(item => item.id !== comment.id && item.parentId !== comment.id)
  } catch (error) {
    alert(error.message)
  }
}
</script>

<style scoped>
.comments-section { width: 100%; margin-top: 20px; padding: 24px; background: var(--bg); border: 2px solid var(--border); box-shadow: 5px 5px 0 var(--primary); }
.comments-header, .composer-footer, .reply-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.eyebrow { color: var(--text-muted); font-size: 11px; letter-spacing: .14em; }
h2 { margin: 3px 0 0; font-size: 18px; } h2 span { color: var(--text-muted); font-weight: 400; }
.resolved-toggle { display: flex; gap: 7px; align-items: center; color: var(--text-secondary); font-size: 12px; }
.comment-composer { margin: 20px 0; padding: 12px; background: var(--surface-hover); border: 1px solid var(--border); }
textarea { width: 100%; resize: vertical; border: 0; background: transparent; line-height: 1.65; outline: none; }
.composer-footer { margin-top: 8px; } .composer-footer span { color: var(--text-muted); font-size: 11px; }
.comment-thread { margin-top: 14px; padding: 16px; border: 1px solid var(--border); background: var(--bg); }
.comment-thread.resolved { opacity: .62; } .comment-thread.focused { outline: 3px solid var(--primary); }
.reply-list { margin: 12px 0 0 30px; padding-left: 14px; border-left: 2px solid var(--primary); }
.reply-composer { margin: 12px 0 0 30px; padding: 10px; background: var(--surface-hover); border: 1px solid var(--border); }
.reply-actions { justify-content: flex-end; margin-top: 8px; }
.comment-empty, .login-prompt { padding: 26px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border); }
.login-prompt { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 18px 0; }
@media (max-width: 760px) { .comments-section { padding: 16px; } .comments-header { align-items: flex-start; } .reply-list, .reply-composer { margin-left: 12px; } .composer-footer { align-items: flex-end; } .composer-footer span { max-width: 150px; } }
</style>

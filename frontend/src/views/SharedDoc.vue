<template>
  <div class="shared-page">
    <header class="topbar">
      <h1 class="logo">WriteHere</h1>
      <span class="badge" v-if="permission">{{ permission === 'edit' ? '协同编辑' : '只读' }}</span>
    </header>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-page">
      <p>{{ error }}</p>
      <button class="primary" @click="$router.push('/login')">去登录</button>
    </div>
    <template v-else>
      <EditorToolbar v-if="editor && permission === 'edit'" :editor="editor" />
      <div class="editor-wrapper">
        <div class="doc-header">
          <h1>{{ docTitle }}</h1>
        </div>
        <editor-content :editor="editor" class="editor-content" />
      </div>
      
      <!-- 评论区域 -->
      <div class="comments-section">
        <h2>评论</h2>
        
        <!-- 评论输入框 -->
        <div v-if="user" class="comment-input">
          <textarea v-model="commentContent" placeholder="写下你的评论..." rows="3"></textarea>
          <button class="primary" @click="addComment" :disabled="!commentContent.trim()">发布评论</button>
        </div>
        <div v-else class="login-prompt">
          <p>登录后才能评论</p>
          <button class="primary" @click="$router.push('/login')">去登录</button>
        </div>
        
        <!-- 评论列表 -->
        <div class="comments-list">
          <div v-if="loadingComments" class="loading-comments">加载评论中...</div>
          <div v-else-if="comments.length === 0" class="no-comments">暂无评论，快来发表第一条评论吧！</div>
          <div v-else v-for="comment in comments" :key="comment.id" class="comment-item">
            <div class="comment-header">
              <span class="comment-author">{{ comment.username }}</span>
              <span class="comment-time">{{ formatTime(comment.createdAt) }}</span>
              <button v-if="user && (comment.userId === user.id || docOwnerId === user.id)" 
                      class="delete-comment-btn" @click="deleteComment(comment.id)">
                删除
              </button>
            </div>
            <div class="comment-content">{{ comment.content }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror'
import EditorToolbar from '../components/EditorToolbar.vue'
import { api, getUser } from '../utils/api'

const route = useRoute()
const token = route.params.token

const loading = ref(true)
const error = ref('')
const docTitle = ref('')
const permission = ref('')
const docId = ref(null)
const docOwnerId = ref(null)
const user = ref(getUser())
const comments = ref([])
const loadingComments = ref(false)
const commentContent = ref('')

const lowlight = createLowlight(common)

let ydoc = null
let provider = null

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false, codeBlock: false }),
    Image.configure({ inline: true }),
    Link.configure({ openOnClick: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Underline,
    CodeBlockLowlight.configure({ lowlight }),
    TextStyle,
    Color,
    HorizontalRule,
    Subscript,
    Superscript,
  ],
  editable: false,
})

onMounted(async () => {
  try {
    const share = await api.getShare(token)
    docTitle.value = share.doc.title
    permission.value = share.permission
    docId.value = share.doc.id
    docOwnerId.value = share.doc.ownerId

    if (permission.value === 'edit') {
      // 协同编辑模式
      editor.value.setEditable(true)
      ydoc = new Y.Doc()
      const wsUrl = 'wss://write-here-backend.onrender.com/ws'
      provider = new WebsocketProvider(wsUrl, `doc-${share.doc.id}`, ydoc)
      const yXmlFragment = ydoc.getXmlFragment('prosemirror')

      const user = getUser()
      provider.awareness.setLocalStateField('user', {
        name: user?.username || '匿名用户',
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
      })

      const view = editor.value.view
      const syncPlugin = ySyncPlugin(yXmlFragment)
      const cursorPlugin = yCursorPlugin(provider.awareness)
      const undoPlugin = yUndoPlugin()
      const newState = view.state.reconfigure({
        plugins: [...view.state.plugins, syncPlugin, cursorPlugin, undoPlugin]
      })
      view.updateState(newState)

      provider.on('sync', (isSynced) => {
        if (isSynced && yXmlFragment.length === 0 && share.doc.content) {
          editor.value.commands.setContent(share.doc.content)
        }
      })
    } else {
      // 只读模式
      editor.value.commands.setContent(share.doc.content)
    }

    // 加载评论
    await loadComments()
  } catch (e) {
    error.value = e.message || '分享链接无效或已过期'
  }
  loading.value = false
})

// 加载评论
async function loadComments() {
  if (!docId.value) return
  loadingComments.value = true
  try {
    comments.value = await api.getDocComments(docId.value)
  } catch (e) {
    console.error('加载评论失败:', e)
  }
  loadingComments.value = false
}

// 添加评论
async function addComment() {
  if (!commentContent.value.trim() || !user.value || !docId.value) return
  try {
    const comment = await api.addComment(docId.value, user.value.id, commentContent.value.trim())
    comments.value.unshift(comment)
    commentContent.value = ''
  } catch (e) {
    alert(e.message)
  }
}

// 删除评论
async function deleteComment(commentId) {
  if (!confirm('确定要删除这条评论吗？')) return
  try {
    await api.deleteComment(commentId, user.value.id)
    comments.value = comments.value.filter(c => c.id !== commentId)
  } catch (e) {
    alert(e.message)
  }
}

onBeforeUnmount(() => {
  provider?.destroy()
  ydoc?.destroy()
  editor.value?.destroy()
})
</script>

<style scoped>
.shared-page {
  min-height: 100vh;
  background: var(--bg-gray);
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  background: #fff;
  box-shadow: var(--shadow);
}
.logo {
  font-size: 20px;
  font-weight: 700;
  color: var(--primary);
}
.badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 12px;
  background: #e6f7ff;
  color: var(--primary);
}
.loading, .error-page {
  text-align: center;
  padding: 80px 0;
  color: var(--text-muted);
}
.error-page button { margin-top: 16px; }
.editor-wrapper {
  max-width: 800px;
  margin: 24px auto;
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 40px 48px;
  min-height: calc(100vh - 160px);
}
.doc-header h1 {
  font-size: 28px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.editor-content :deep(.tiptap) { outline: none; }
.editor-content :deep(table) { border-collapse: collapse; width: 100%; margin: 16px 0; }
.editor-content :deep(th), .editor-content :deep(td) { border: 1px solid var(--border); padding: 8px 12px; }
.editor-content :deep(th) { background: var(--bg-gray); font-weight: 600; }
.editor-content :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 14px; }
.editor-content :deep(blockquote) { border-left: 3px solid var(--primary); padding-left: 16px; margin: 12px 0; color: var(--text-secondary); }
.editor-content :deep(img) { max-width: 100%; border-radius: 4px; }
.editor-content :deep(a) { color: var(--primary); }
.editor-content :deep(mark) { background: #ffeaa7; padding: 0 2px; border-radius: 2px; }
.editor-content :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

/* 评论区域样式 */
.comments-section {
  max-width: 800px;
  margin: 40px auto;
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 32px;
}
.comments-section h2 {
  font-size: 20px;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.comment-input {
  margin-bottom: 32px;
}
.comment-input textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  resize: vertical;
  margin-bottom: 12px;
}
.comment-input button {
  float: right;
}
.login-prompt {
  text-align: center;
  padding: 24px;
  background: var(--bg-gray);
  border-radius: var(--radius);
  margin-bottom: 32px;
}
.login-prompt p {
  margin-bottom: 12px;
  color: var(--text-secondary);
}
.comments-list {
  clear: both;
}
.loading-comments,
.no-comments {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 0;
}
.comment-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.comment-item:last-child {
  border-bottom: none;
}
.comment-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  gap: 12px;
}
.comment-author {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}
.comment-time {
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
}
.delete-comment-btn {
  font-size: 12px;
  color: #e74c3c;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius);
  transition: background-color 0.2s;
}
.delete-comment-btn:hover {
  background: rgba(231, 76, 60, 0.1);
}
.comment-content {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  word-break: break-word;
}
</style>

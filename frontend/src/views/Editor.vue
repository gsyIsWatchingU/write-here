<template>
  <div class="editor-page">
    <header class="editor-topbar">
      <div class="topbar-left">
        <button class="ghost" @click="goBack">&larr; 返回</button>
        <input
          v-model="docTitle"
          class="title-input"
          placeholder="无标题文档"
          :readonly="!canEdit"
          :class="{ readonly: !canEdit }"
          @blur="canEdit ? saveDoc() : null"
        />
      </div>
      <div class="topbar-right">
        <div v-if="collabUsers.length > 0" class="collab-avatars">
          <span
            v-for="u in collabUsers"
            :key="u.name"
            class="collab-avatar"
            :style="{ background: u.color }"
            :title="u.name"
          >{{ u.name[0] }}</span>
        </div>
        <span v-if="saveStatus" class="save-status">{{ saveStatus }}</span>
        <div v-if="isOwner" class="visibility-control">
          <label>
            <span>可见性：</span>
            <select v-model="visibility" @change="updateVisibility">
              <option value="private">私密</option>
              <option value="public">公开</option>
            </select>
          </label>
        </div>
        <button v-if="canEdit" class="primary" @click="saveDoc">保存</button>
        <button v-if="isOwner" class="ghost" @click="openShare">分享</button>
      </div>
    </header>

    <EditorToolbar v-if="editor && editorReady && canEdit" :editor="editor" />

    <div class="editor-main">
      <div class="editor-wrapper">
        <editor-content :editor="editor" class="editor-content" />
      </div>
      <div class="outline-panel">
        <h3>文档大纲</h3>
        <div class="outline-content">
          <div v-if="outline.length === 0" class="empty-outline">
            暂无大纲内容
          </div>
          <ul v-else class="outline-list">
            <li v-for="(item, index) in outline" :key="index" 
                :class="'outline-item level-' + item.level"
                @click="scrollToHeading(item.id)">
              {{ item.text }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 分享弹窗 -->
    <div v-if="showShareModal" class="modal-overlay" @click.self="showShareModal = false">
      <div class="modal">
        <h3>分享文档</h3>
        <div v-if="shareLink" class="share-link-box">
          <p>分享链接：</p>
          <div class="share-link-row">
            <input :value="shareLink" readonly />
            <button class="primary" @click="copyLink">复制</button>
          </div>
          <div class="share-options">
            <label>
              <span>权限：</span>
              <select v-model="sharePermission" @change="handleCreateShare">
                <option value="read">只读</option>
                <option value="edit">可编辑（协同）</option>
              </select>
            </label>
          </div>
          <button class="danger" @click="handleDeleteShare" style="margin-top:12px;">取消分享</button>
        </div>
        <div v-else>
          <div class="share-options">
            <label>
              <span>权限：</span>
              <select v-model="sharePermission">
                <option value="read">只读</option>
                <option value="edit">可编辑（协同）</option>
              </select>
            </label>
          </div>
          <button class="primary" @click="handleCreateShare" style="margin-top:16px;">生成分享链接</button>
        </div>
        <button class="ghost" @click="showShareModal = false" style="margin-top:12px;">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
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
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import EditorToolbar from '../components/EditorToolbar.vue'
import { api, getUser } from '../utils/api'

const route = useRoute()
const router = useRouter()
const user = getUser()
const docId = route.params.id

const docTitle = ref('')
const saveStatus = ref('')
const showShareModal = ref(false)
const shareLink = ref('')
const sharePermission = ref('read')
const collabUsers = ref([])
const editorReady = ref(false)
const outline = ref([])
const visibility = ref('private')
const isOwner = ref(false)
const canEdit = ref(false)

const lowlight = createLowlight(common)

// Yjs setup
const ydoc = new Y.Doc()
const wsUrl = 'wss://write-here-backend.onrender.com/ws'
const provider = new WebsocketProvider(wsUrl, `doc-${docId}`, ydoc)

// 用户颜色
const colors = ['#f44336','#e91e63','#9c27b0','#2196f3','#009688','#ff9800','#795548','#607d8b']
const userColor = colors[Math.floor(Math.random() * colors.length)]

provider.awareness.setLocalStateField('user', {
  name: user?.username || '匿名用户',
  color: userColor
})

// 监听协同用户
function updateCollabUsers() {
  const states = provider.awareness.getStates()
  const users = []
  states.forEach((state, clientId) => {
    if (clientId !== ydoc.clientID && state.user) {
      users.push(state.user)
    }
  })
  collabUsers.value = users
}
provider.awareness.on('change', updateCollabUsers)

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      history: false, // Collaboration 自带 undo 管理
      codeBlock: false,
    }),
    Placeholder.configure({ placeholder: '开始编写文档...' }),
    Image.configure({ inline: true }),
    Link.configure({ openOnClick: false }),
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
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider,
      user: {
        name: user?.username || '匿名用户',
        color: userColor,
      },
    }),
  ],
  editable: false,
  onCreate() {
    editorReady.value = true
    updateOutline()
  },
  onUpdate() {
    updateOutline()
  },
})

let saveTimer = null

// 生成文档大纲
function updateOutline() {
  if (!editor.value) return
  
  const newOutline = []
  let id = 0
  
  editor.value.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      newOutline.push({
        id: ++id,
        level: node.attrs.level,
        text: node.textContent,
        pos
      })
    }
  })
  
  outline.value = newOutline
}

// 滚动到指定标题
function scrollToHeading(id) {
  if (!editor.value) return
  
  const heading = outline.value.find(item => item.id === id)
  if (heading) {
    editor.value.commands.focus({
      at: heading.pos,
      scrollIntoView: true
    })
  }
}

// 加载文档
onMounted(async () => {
  try {
    const doc = await api.getDoc(docId, user.id)
    docTitle.value = doc.title
    visibility.value = doc.visibility || 'private'

    isOwner.value = doc.userId === user.id
    if (isOwner.value) {
      canEdit.value = true
    } else {
      const status = await api.getCollaborationStatus(docId, user.id)
      canEdit.value = status.status === 'approved'
    }

    if (editor.value) {
      editor.value.setEditable(!!canEdit.value)
    }

    // 等待 Yjs 同步完成，如果文档为空则从服务器加载
    provider.on('sync', (isSynced) => {
      if (isSynced) {
        const yXmlFragment = ydoc.getXmlFragment('default')
        if (yXmlFragment.length === 0 && doc.content && editor.value) {
          editor.value.commands.setContent(doc.content)
        }
      }
    })
  } catch (e) {
    alert('加载文档失败：' + e.message)
    router.push('/')
  }

  // 自动保存
  saveTimer = setInterval(() => {
    if (editor.value) {
      autoSave()
    }
  }, 32100)
})

// 更新文档可见性
async function updateVisibility() {
  if (!isOwner.value) return
  try {
    await api.updateDocVisibility(docId, user.id, visibility.value)
  } catch (e) {
    alert('更新可见性失败：' + e.message)
  }
}

onBeforeUnmount(() => {
  if (saveTimer) clearInterval(saveTimer)
  provider.awareness.off('change', updateCollabUsers)
  provider.destroy()
  ydoc.destroy()
})

async function autoSave() {
  await doSave(true)
}

async function saveDoc() {
  await doSave(false)
}

async function doSave(isAuto) {
  if (!canEdit.value) return
  if (!editor.value) return
  const content = editor.value.getHTML()
  const title = docTitle.value || '无标题文档'
  saveStatus.value = '保存中...'
  try {
    await api.updateDoc(docId, user.id, title, content)
    saveStatus.value = isAuto ? '已自动保存' : '已保存'
    setTimeout(() => { saveStatus.value = '' }, 2000)
  } catch (e) {
    saveStatus.value = '保存失败'
  }
}

function goBack() {
  if (!canEdit.value) return router.push('/')
  saveDoc().then(() => router.push('/'))
}

async function openShare() {
  showShareModal.value = true
  shareLink.value = ''
  sharePermission.value = 'read'
  try {
    const shares = await api.getDocShares(docId, user.id)
    if (shares && shares.length > 0) {
      shareLink.value = `${window.location.origin}/share/${shares[0].token}`
      sharePermission.value = shares[0].permission
    }
  } catch (e) {
    // 没有分享
  }
}

async function handleCreateShare() {
  try {
    const share = await api.createShare(docId, user.id, sharePermission.value)
    shareLink.value = `${window.location.origin}/share/${share.token}`
  } catch (e) {
    alert(e.message)
  }
}

async function handleDeleteShare() {
  try {
    await api.deleteShare(docId, user.id)
    shareLink.value = ''
  } catch (e) {
    alert(e.message)
  }
}

function copyLink() {
  navigator.clipboard.writeText(shareLink.value)
  alert('链接已复制')
}
</script>

<style scoped>
.editor-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-gray);
}
.editor-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #fff;
  box-shadow: var(--shadow);
  z-index: 100;
  position: sticky;
  top: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}
.title-input {
  border: none;
  font-size: 18px;
  font-weight: 600;
  padding: 6px 8px;
  background: transparent;
  width: 100%;
  max-width: 400px;
}
.title-input.readonly {
  cursor: default;
}
.title-input:focus {
  background: var(--bg-gray);
  border-radius: var(--radius);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.save-status {
  font-size: 12px;
  color: var(--text-muted);
}
.visibility-control {
  display: flex;
  align-items: center;
}
.visibility-control label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}
.visibility-control select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
}
.collab-avatars {
  display: flex;
  gap: 4px;
}
.collab-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.toolbar-menu {
  position: sticky;
  top: 56px;
  z-index: 99;
}
.editor-main {
  flex: 1;
  padding: 24px 320px 24px 24px;
  overflow-y: auto;
}
.editor-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}
.editor-content {
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 800px;
  min-height: calc(100vh - 240px);
  padding: 40px 48px;
}
.outline-panel {
  width: 280px;
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 16px;
  position: fixed;
  right: 24px;
  top: 120px;
  bottom: 24px;
  overflow-y: auto;
}
.outline-panel h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--text-primary);
}
.empty-outline {
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
  padding: 20px 0;
}
.outline-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.outline-item {
  padding: 6px 8px;
  margin: 2px 0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}
.outline-item:hover {
  background: var(--bg-gray);
}
.outline-item.level-1 {
  font-weight: 600;
  padding-left: 8px;
}
.outline-item.level-2 {
  padding-left: 16px;
}
.outline-item.level-3 {
  padding-left: 24px;
}
.outline-item.level-4 {
  padding-left: 32px;
}
.outline-item.level-5 {
  padding-left: 40px;
}
.outline-item.level-6 {
  padding-left: 48px;
}
.editor-content :deep(.tiptap) {
  outline: none;
  min-height: 400px;
}
.editor-content :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-muted);
  pointer-events: none;
  height: 0;
}
.editor-content :deep(table) { border-collapse: collapse; width: 100%; margin: 16px 0; }
.editor-content :deep(th), .editor-content :deep(td) { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.editor-content :deep(th) { background: var(--bg-gray); font-weight: 600; }
.editor-content :deep(ul[data-type="taskList"]) { list-style: none; padding-left: 0; }
.editor-content :deep(ul[data-type="taskList"] li) { display: flex; align-items: flex-start; gap: 8px; }
.editor-content :deep(ul[data-type="taskList"] li label) { margin-top: 4px; }
.editor-content :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 6px; overflow-x: auto; font-family: 'Fira Code', 'Consolas', monospace; font-size: 14px; }
.editor-content :deep(blockquote) { border-left: 3px solid var(--primary); padding-left: 16px; margin: 12px 0; color: var(--text-secondary); }
.editor-content :deep(img) { max-width: 100%; border-radius: 4px; }
.editor-content :deep(a) { color: var(--primary); text-decoration: underline; }
.editor-content :deep(mark) { background: #ffeaa7; padding: 0 2px; border-radius: 2px; }
.editor-content :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.editor-content :deep(.collaboration-cursor__caret) { position: relative; margin-left: -1px; margin-right: -1px; border-left: 1px solid; border-right: 1px solid; word-break: normal; pointer-events: none; }
.editor-content :deep(.collaboration-cursor__label) { position: absolute; top: -1.4em; left: -1px; font-size: 12px; font-weight: 600; line-height: normal; padding: 0.1rem 0.3rem; border-radius: 3px 3px 3px 0; color: #fff; white-space: nowrap; user-select: none; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; padding: 32px; border-radius: 12px; width: 440px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal h3 { margin-bottom: 16px; }
.share-link-row { display: flex; gap: 8px; margin-top: 8px; }
.share-link-row input { flex: 1; font-size: 13px; }
.share-options { margin-top: 12px; }
.share-options label { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.share-options select { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); }
</style>

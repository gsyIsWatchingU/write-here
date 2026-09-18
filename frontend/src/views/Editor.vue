<template>
  <div class="editor-page">
    <div class="editor-sticky-head">
      <header class="editor-topbar">
        <div class="topbar-left">
          <button class="ghost" @click="goBack">&larr; 返回</button>
          <input
            v-model="docTitle"
            class="title-input"
            :placeholder="docKind === 'problem' ? '无标题题目' : '无标题文档'"
            :readonly="!canEdit"
            :class="{ readonly: !canEdit }"
            @input="scheduleAutoSave"
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
          <input
            ref="markdownFileInput"
            class="file-input"
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            @change="handleMarkdownImport"
          />
          <button v-if="canEdit" class="ghost" @click="openMarkdownPicker">导入 MD</button>
          <div v-if="isOwner && docKind !== 'problem'" class="visibility-control">
            <label>
              <span>可见性：</span>
              <select v-model="visibility" @change="updateVisibility">
                <option value="private">私密</option>
                <option value="public">公开</option>
              </select>
            </label>
          </div>
          <button v-if="isOwner && docKind !== 'problem'" class="ghost" @click="openShare">分享</button>
        </div>
      </header>

      <EditorToolbar v-if="editor && editorReady && canEdit" :editor="editor" @applied="handleAiPolished" />
    </div>

    <div
      class="editor-main"
      :class="{
        'left-panel-collapsed': !documentPanelOpen || docKind !== 'document',
        'right-panel-collapsed': !sidePanelOpen,
      }"
    >
      <DocumentDirectory
        v-if="docKind === 'document'"
        :documents="directoryDocuments"
        :collaboration-documents="directoryCollaborationDocuments"
        :active-document-id="docId"
        :loading="directoryLoading"
        :open="documentPanelOpen"
        @close="documentPanelOpen = false"
        @create="createDocumentFromDirectory"
        @select="openDocumentFromDirectory"
        @reorder="reorderDocumentsFromDirectory"
        @home="goBack"
      />

      <button
        v-if="docKind === 'document' && !documentPanelOpen"
        type="button"
        class="panel-edge-trigger left-panel-reopen"
        title="展开文档目录"
        aria-label="展开文档目录"
        @click="documentPanelOpen = true"
      >›</button>

      <div class="document-column">
        <div v-if="docLoading" class="editor-skeleton">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line medium"></div>
        </div>
        <div class="editor-wrapper" v-show="!docLoading">
          <editor-content :editor="editor" class="editor-content" />
        </div>
      </div>

      <SelectionCommentButton
        v-if="editor && commentsReady"
        :editor="editor"
        :enabled="Boolean(user)"
        @comment="openSelectionComment"
      />

      <button
        v-if="!sidePanelOpen"
        type="button"
        class="panel-edge-trigger right-panel-reopen"
        title="展开大纲与评论"
        aria-label="展开大纲与评论"
        @click="openSidePanel(activeSideTab)"
      >‹</button>

      <aside class="outline-panel side-panel" :class="{ 'mobile-open': sidePanelOpen, 'panel-collapsed': !sidePanelOpen }">
        <div class="side-panel-tabs">
          <button
            type="button"
            class="side-panel-collapse"
            title="收拢大纲与评论"
            aria-label="收拢大纲与评论"
            @click="sidePanelOpen = false"
          >›</button>
          <button :class="{ active: activeSideTab === 'outline' }" @click="openSidePanel('outline')">大纲</button>
          <button :class="{ active: activeSideTab === 'comments' }" @click="openSidePanel('comments')">
            评论 <span v-if="commentCount">{{ commentCount }}</span>
          </button>
          <button type="button" class="side-panel-close" title="收拢面板" aria-label="收拢面板" @click="sidePanelOpen = false">×</button>
        </div>
        <div v-show="activeSideTab === 'outline'" class="outline-content">
          <div v-if="outline.length === 0" class="empty-outline">
            暂无大纲内容
          </div>
          <ul v-else class="outline-list">
            <li v-for="(item, index) in outline" :key="index" 
                :class="'outline-item level-' + item.level"
                :title="`H${item.level} · ${item.text}`"
                @click="scrollToHeading(item.id)">
              <span class="outline-level" aria-hidden="true">H{{ item.level }}</span>
              <span class="outline-text">{{ item.text }}</span>
            </li>
          </ul>
        </div>
        <CommentPanel
          v-if="commentsReady"
          v-show="activeSideTab === 'comments'"
          :doc-id="docId"
          :owner-id="docOwnerId"
          :focused-comment-id="route.query.comment"
          :editor="editor"
          :pending-anchor="pendingCommentAnchor"
          :can-persist-anchors="canEdit"
          :document-ready="contentReady"
          @open="openSidePanel('comments')"
          @anchor-created="pendingCommentAnchor = null"
          @anchor-cancelled="pendingCommentAnchor = null"
          @count-change="commentCount = $event"
        />
      </aside>

      <button v-if="!sidePanelOpen && !documentPanelOpen" class="mobile-side-trigger" @click="openSidePanel(activeSideTab)">
        大纲 / 评论<span v-if="commentCount"> · {{ commentCount }}</span>
      </button>
      <button
        v-if="docKind === 'document' && !documentPanelOpen && !sidePanelOpen"
        class="mobile-directory-trigger"
        @click="documentPanelOpen = true"
      >文档目录</button>
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
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
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
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { common, createLowlight } from 'lowlight'
import MarkdownIt from 'markdown-it'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import EditorToolbar from '../components/EditorToolbar.vue'
import DocumentDirectory from '../components/DocumentDirectory.vue'
import CommentPanel from '../components/CommentPanel.vue'
import SelectionCommentButton from '../components/SelectionCommentButton.vue'
import CodeBlockWithCopy from '../extensions/codeBlockWithCopy.js'
import { api, getUser, getWebSocketUrl } from '../utils/api'
import { normalizeImportedMarkdown } from '../utils/markdown'
import { handleCodeBlockTab } from '../utils/codeBlockIndent.js'
import { handleBackspaceDeleteEmptyLine } from '../utils/emptyLineBackspace.js'
import { insertParagraphInClickedGap } from '../utils/blockGapInsertion.js'
import { scrollToOutlineHeading } from '../utils/outlineNavigation.js'
import { getDocumentPath } from '../utils/documentIdentity.js'

const route = useRoute()
const router = useRouter()
const user = getUser()
const routeDocumentIdentifier = String(route.params.id)
const docId = ref(routeDocumentIdentifier)
const mobileMedia = window.matchMedia('(max-width: 760px)')

const docTitle = ref('')
const docKind = ref('document')
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
const docOwnerId = ref(null)
const commentsReady = ref(false)
const contentReady = ref(false)
const docLoading = ref(true)
const markdownFileInput = ref(null)
const activeSideTab = ref(route.query.comment ? 'comments' : 'outline')
const sidePanelOpen = ref(Boolean(route.query.comment) || !mobileMedia.matches)
const documentPanelOpen = ref(!mobileMedia.matches)
const pendingCommentAnchor = ref(null)
const commentCount = ref(0)
const userDocuments = ref([])
const collaborationDocuments = ref([])
const directoryLoading = ref(false)

const directoryDocuments = computed(() => userDocuments.value.map(document => (
  String(document.id) === String(docId.value)
    ? { ...document, title: docTitle.value || document.title }
    : document
)))
const directoryCollaborationDocuments = computed(() => collaborationDocuments.value.map(document => (
  String(document.id) === String(docId.value)
    ? { ...document, title: docTitle.value || document.title }
    : document
)))

const lowlight = createLowlight(common)
const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
})
const MAX_MARKDOWN_FILE_SIZE = 2 * 1024 * 1024

// Yjs setup
const ydoc = new Y.Doc()
const wsUrl = getWebSocketUrl('/ws')
const provider = new WebsocketProvider(wsUrl, `doc-${routeDocumentIdentifier}`, ydoc)

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
    CodeBlockWithCopy.configure({ lowlight }),
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
  editorProps: {
    handleKeyDown: (view, event) => (
      handleBackspaceDeleteEmptyLine(view, event) || handleCodeBlockTab(view, event)
    ),
    handleDOMEvents: {
      mousedown: insertParagraphInClickedGap,
    },
  },
  onCreate() {
    editorReady.value = true
    updateOutline()
  },
  onUpdate() {
    updateOutline()
    scheduleAutoSave()
  },
})

const AUTO_SAVE_DELAY = 800
let saveTimer = null
let saveInFlight = null
let documentLoaded = false
let lastSavedSnapshot = ''

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
  if (heading && scrollToOutlineHeading(editor.value, heading.pos) && mobileMedia.matches) {
    sidePanelOpen.value = false
  }
}

function openSidePanel(tab) {
  activeSideTab.value = tab
  sidePanelOpen.value = true
  if (mobileMedia.matches) documentPanelOpen.value = false
}

function openSelectionComment(anchor) {
  pendingCommentAnchor.value = anchor
  openSidePanel('comments')
}

watch(() => route.query.comment, commentId => {
  if (commentId) openSidePanel('comments')
})

function handleViewportChange(event) {
  sidePanelOpen.value = !event.matches
  documentPanelOpen.value = !event.matches
}

async function loadDocumentDirectory() {
  directoryLoading.value = true
  const [documentsResult, collaborationResult] = await Promise.allSettled([
    api.getDocs(user.id),
    api.getMyCollaborationDocs(user.id),
  ])
  userDocuments.value = documentsResult.status === 'fulfilled' ? documentsResult.value : []
  collaborationDocuments.value = collaborationResult.status === 'fulfilled' ? collaborationResult.value : []
  directoryLoading.value = false
}

async function canLeaveCurrentDocument() {
  if (!canEdit.value) return true
  const saved = await flushAutoSave()
  if (!saved) alert('当前文档保存失败，请稍后重试')
  return saved
}

async function openDocumentFromDirectory(id) {
  if (String(id) === String(docId.value)) {
    if (mobileMedia.matches) documentPanelOpen.value = false
    return
  }
  if (!await canLeaveCurrentDocument()) return
  const document = [...userDocuments.value, ...collaborationDocuments.value]
    .find(item => String(item.id) === String(id))
  window.location.assign(router.resolve(getDocumentPath(document || id)).href)
}

async function createDocumentFromDirectory() {
  if (!await canLeaveCurrentDocument()) return
  try {
    const document = await api.createDoc(user.id, '无标题文档', '<p></p>')
    window.location.assign(router.resolve(getDocumentPath(document)).href)
  } catch (error) {
    alert('新建文档失败：' + error.message)
  }
}

async function reorderDocumentsFromDirectory(documentIds) {
  const previousDocuments = [...userDocuments.value]
  const documentsById = new Map(previousDocuments.map(document => [String(document.id), document]))
  userDocuments.value = documentIds.map(id => documentsById.get(String(id))).filter(Boolean)
  try {
    await api.reorderDocs(user.id, documentIds)
  } catch (error) {
    userDocuments.value = previousDocuments
    alert('调整文档顺序失败：' + error.message)
  }
}

// 加载文档
onMounted(async () => {
  mobileMedia.addEventListener?.('change', handleViewportChange)
  // 延迟加载文档目录，不阻塞主内容加载
  setTimeout(loadDocumentDirectory, 200)
  try {
    const doc = await api.getDoc(routeDocumentIdentifier, user.id)
    docId.value = doc.id
    if (doc.publicId && routeDocumentIdentifier !== doc.publicId) {
      await router.replace({ path: getDocumentPath(doc), query: { ...route.query } })
    }
    docTitle.value = doc.title
    docKind.value = doc.kind || 'document'
    docOwnerId.value = doc.userId
    visibility.value = doc.visibility || 'private'

    isOwner.value = doc.userId === user.id
    if (isOwner.value) {
      canEdit.value = true
    } else {
      const status = await api.getCollaborationStatus(docId.value, user.id)
      canEdit.value = status.status === 'approved'
    }

    if (editor.value) {
      editor.value.setEditable(!!canEdit.value)
    }
    commentsReady.value = true

    lastSavedSnapshot = JSON.stringify({
      title: doc.title || '无标题文档',
      content: doc.content || ''
    })
    documentLoaded = true
    docLoading.value = false
    saveStatus.value = canEdit.value ? '已保存' : ''

    // 等待 Yjs 同步完成，如果文档为空则从服务器加载
    const handleProviderSync = (isSynced) => {
      if (isSynced) {
        const yXmlFragment = ydoc.getXmlFragment('default')
        if (yXmlFragment.length === 0 && doc.content && editor.value) {
          editor.value.commands.setContent(doc.content)
        }
        contentReady.value = true
        updateOutline()
      }
    }
    provider.on('sync', handleProviderSync)
    if (provider.synced) handleProviderSync(true)

    // Yjs 可能已先于接口完成同步，此处补一次差异检查。
    scheduleAutoSave()
  } catch (e) {
    alert('加载文档失败：' + e.message)
    router.push(route.query.from === 'problems' ? '/problems' : '/')
  }

})

// 更新文档可见性
async function updateVisibility() {
  if (!isOwner.value) return
  try {
    await api.updateDocVisibility(docId.value, user.id, visibility.value)
  } catch (e) {
    alert('更新可见性失败：' + e.message)
  }
}

onBeforeUnmount(() => {
  documentLoaded = false
  contentReady.value = false
  if (saveTimer) clearTimeout(saveTimer)
  mobileMedia.removeEventListener?.('change', handleViewportChange)
  provider.awareness.off('change', updateCollabUsers)
  provider.destroy()
  ydoc.destroy()
})

function getDocumentSnapshot() {
  if (!editor.value) return null
  return {
    title: docTitle.value || '无标题文档',
    content: editor.value.getHTML()
  }
}

function scheduleAutoSave() {
  if (!documentLoaded || !canEdit.value || !editor.value) return

  const snapshot = getDocumentSnapshot()
  if (!snapshot || JSON.stringify(snapshot) === lastSavedSnapshot) return

  saveStatus.value = '保存中...'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushAutoSave()
  }, AUTO_SAVE_DELAY)
}

async function flushAutoSave() {
  if (!documentLoaded || !canEdit.value || !editor.value) return true

  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  if (saveInFlight) {
    await saveInFlight
    return flushAutoSave()
  }

  const snapshot = getDocumentSnapshot()
  const serializedSnapshot = JSON.stringify(snapshot)
  if (serializedSnapshot === lastSavedSnapshot) {
    saveStatus.value = '已保存'
    return true
  }

  saveStatus.value = '保存中...'
  const request = api
    .updateDoc(docId.value, user.id, snapshot.title, snapshot.content)
    .then(() => true, () => false)
  saveInFlight = request
  const saved = await request
  if (saveInFlight === request) saveInFlight = null

  if (!saved) {
    saveStatus.value = '保存失败'
    return false
  }

  lastSavedSnapshot = serializedSnapshot

  if (JSON.stringify(getDocumentSnapshot()) !== serializedSnapshot) {
    return flushAutoSave()
  }

  saveStatus.value = '已保存'
  return true
}

async function goBack() {
  const returnPath = route.query.from === 'problems' || docKind.value === 'problem' ? '/problems' : '/'
  if (!canEdit.value) return router.push(returnPath)
  const saved = await flushAutoSave()
  if (saved) router.push(returnPath)
}

// AI 润色完成：正文已由组件替换，这里立即落盘，避免依赖自动保存定时器
async function handleAiPolished() {
  const saved = await flushAutoSave()
  if (!saved) alert('AI 润色已完成，但自动保存失败，请检查网络后重试')
}

function openMarkdownPicker() {
  markdownFileInput.value?.click()
}

async function handleMarkdownImport(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file || !editor.value || !canEdit.value) return

  try {
    if (!/\.(md|markdown)$/i.test(file.name)) {
      throw new Error('请选择 .md 或 .markdown 文件')
    }
    if (file.size > MAX_MARKDOWN_FILE_SIZE) {
      throw new Error('Markdown 文件不能超过 2 MB')
    }

    const hasContent = editor.value.getText().trim().length > 0
    if (hasContent && !window.confirm('导入会替换当前正文，是否继续？')) return

    const markdown = normalizeImportedMarkdown(await file.text())
    editor.value.commands.setContent(markdownParser.render(markdown))
    updateOutline()

    if (!docTitle.value.trim() || docTitle.value === '无标题文档') {
      docTitle.value = file.name.replace(/\.(md|markdown)$/i, '')
    }

    const saved = await flushAutoSave()
    if (!saved) throw new Error('内容已导入，但自动保存失败')
  } catch (error) {
    alert('导入失败：' + error.message)
  } finally {
    input.value = ''
  }
}

async function openShare() {
  showShareModal.value = true
  shareLink.value = ''
  sharePermission.value = 'read'
  try {
    const shares = await api.getDocShares(docId.value, user.id)
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
    const share = await api.createShare(docId.value, user.id, sharePermission.value)
    shareLink.value = `${window.location.origin}/share/${share.token}`
  } catch (e) {
    alert(e.message)
  }
}

async function handleDeleteShare() {
  try {
    await api.deleteShare(docId.value, user.id)
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
  /* 用 clip 代替 hidden：hidden 会让本页成为滚动容器，导致内部 sticky 吸顶失效。 */
  overflow-x: clip;
  background: var(--bg-gray);
}
.editor-sticky-head {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg);
}
.editor-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #fff;
  box-shadow: var(--shadow);
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
.editor-main {
  flex: 1;
  padding: 24px 400px 24px 304px;
  overflow-y: auto;
  transition: padding .2s ease;
}
.editor-main.left-panel-collapsed { padding-left: 24px; }
.editor-main.right-panel-collapsed { padding-right: 24px; }
.file-input {
  display: none;
}
.document-column {
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
}
.editor-wrapper {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}
.editor-skeleton {
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 1000px;
  min-height: calc(100vh - 240px);
  padding: 40px 48px;
}
.skeleton-line {
  height: 16px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 16px;
}
.skeleton-line.skeleton-title {
  height: 28px;
  width: 60%;
  margin-bottom: 24px;
}
.skeleton-line.short { width: 40%; }
.skeleton-line.medium { width: 75%; }
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.editor-content {
  background: #fff;
  border-radius: 8px;
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 1000px;
  min-height: calc(100vh - 240px);
  padding: 40px 48px;
}
.outline-panel {
  width: 360px;
  background: #fff;
  border-radius: 0;
  box-shadow: var(--shadow);
  padding: 14px;
  position: fixed;
  right: 24px;
  top: 120px;
  bottom: 24px;
  overflow-y: auto;
  z-index: 90;
  transition: transform .2s ease;
}
.side-panel-tabs {
  position: sticky;
  top: -14px;
  z-index: 4;
  display: grid;
  grid-template-columns: 32px 1fr 1fr;
  margin: -14px -14px 14px;
  background: var(--bg);
  border-bottom: 2px solid var(--border);
}
.side-panel-tabs button {
  min-height: 42px;
  padding: 8px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--border-soft);
  border-radius: 0;
  font-family: inherit;
  cursor: pointer;
}
.side-panel-tabs button.active {
  color: var(--text);
  background: var(--primary);
  font-weight: 700;
}
.side-panel-close,
.mobile-side-trigger,
.mobile-directory-trigger {
  display: none;
}
.side-panel-tabs .side-panel-collapse {
  padding: 0;
  color: var(--text);
  background: transparent;
  font-size: 23px;
  line-height: 1;
}
.side-panel-tabs .side-panel-collapse:hover { background: var(--bg-gray); }
.panel-edge-trigger {
  position: fixed;
  top: 120px;
  z-index: 95;
  display: grid;
  width: 32px;
  height: 42px;
  padding: 0;
  place-items: center;
  color: var(--text);
  background: var(--primary);
  border: 2px solid var(--border);
  border-radius: 0;
  font-family: inherit;
  font-size: 23px;
  line-height: 1;
  cursor: pointer;
}
.panel-edge-trigger:hover { background: var(--primary-strong); }
.left-panel-reopen { left: 0; }
.right-panel-reopen { right: 0; }
@media (min-width: 761px) {
  .outline-panel.side-panel.panel-collapsed {
    transform: translateX(calc(100% + 32px));
    pointer-events: none;
  }
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
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 8px;
  margin: 2px 0;
  color: var(--text-secondary);
  border-left: 3px solid transparent;
  border-radius: 0;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.45;
  transition: background-color 80ms steps(2, end), color 80ms steps(2, end);
}
.outline-item:hover {
  color: var(--text);
  background: var(--bg-gray);
}
.outline-level {
  width: 18px;
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.9;
}
.outline-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.outline-item.level-1 {
  color: var(--text);
  border-left-color: var(--border);
  font-size: 15px;
  font-weight: 700;
  padding-left: 8px;
}
.outline-item.level-2 {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  padding-left: 16px;
}
.outline-item.level-3 {
  font-weight: 600;
  padding-left: 24px;
}
.outline-item.level-4 {
  font-size: 12px;
  padding-left: 32px;
}
.outline-item.level-5 {
  font-size: 12px;
  padding-left: 40px;
}
.outline-item.level-6 {
  color: var(--text-muted);
  font-size: 12px;
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
@media (max-width: 760px) {
  .panel-edge-trigger { display: none; }
  .side-panel-tabs { grid-template-columns: 1fr 1fr; }
  .side-panel-tabs .side-panel-collapse { display: none; }
  .outline-panel.side-panel {
    position: fixed;
    inset: auto 0 0;
    z-index: 210;
    width: 100%;
    max-height: 72vh;
    margin: 0;
    padding: 14px;
    transform: translateY(105%);
    transition: transform .2s ease;
    border-top: 2px solid var(--border);
    box-shadow: 0 -5px 0 rgba(0, 0, 0, .12);
  }
  .outline-panel.side-panel.mobile-open { transform: translateY(0); }
  .editor-content :deep(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }
  .side-panel-close {
    position: absolute;
    top: 5px;
    right: 5px;
    z-index: 2;
    display: block;
    width: 32px;
    min-height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .mobile-side-trigger,
  .mobile-directory-trigger {
    position: fixed;
    bottom: 12px;
    z-index: 150;
    display: block;
    min-height: 38px;
    padding: 8px 12px;
    color: var(--text);
    background: var(--primary);
    border: 2px solid var(--border);
    border-radius: 0;
    box-shadow: 3px 3px 0 var(--border);
    font-family: inherit;
  }
  .mobile-side-trigger { right: 12px; }
  .mobile-directory-trigger { left: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .editor-main, .outline-panel.side-panel { transition: none; }
}
</style>

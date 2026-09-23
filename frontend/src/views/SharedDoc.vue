<template>
  <div class="shared-page">
    <header class="topbar">
      <h1 class="logo brand-logo">
        <img src="/lumi-logo.png" alt="" aria-hidden="true">
        <span>Lumi Doc</span>
      </h1>
      <span class="badge" v-if="permission">{{ permission === 'edit' ? '协同编辑' : '只读' }}</span>
    </header>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-page">
      <p>{{ error }}</p>
      <button class="primary" @click="$router.push('/login')">去登录</button>
    </div>
    <template v-else>
      <EditorToolbar
        v-if="editor && permission === 'edit'"
        :editor="editor"
        @image-status="reportImageStatus"
      />
      <div v-if="imageNotice" class="image-notice" :class="{ error: imageNoticeError }">{{ imageNotice }}</div>
      <div class="shared-layout" :class="{ 'right-panel-collapsed': !sidePanelOpen }">
        <div class="editor-wrapper">
          <div class="doc-header">
            <h1>{{ docTitle }}</h1>
          </div>
          <editor-content :editor="editor" class="editor-content" />
        </div>

        <SelectionCommentButton
          v-if="editor && docId"
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

        <aside class="shared-side-panel" :class="{ 'mobile-open': sidePanelOpen, 'panel-collapsed': !sidePanelOpen }">
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
            <div v-if="outline.length === 0" class="empty-outline">暂无大纲内容</div>
            <ul v-else class="outline-list">
              <li
                v-for="(item, index) in outline"
                :key="index"
                :class="`outline-item level-${item.level}`"
                :title="`H${item.level} · ${item.text}`"
                @click="scrollToHeading(item)"
              >
                <span class="outline-level" aria-hidden="true">H{{ item.level }}</span>
                <span class="outline-text">{{ item.text }}</span>
              </li>
            </ul>
          </div>
          <CommentPanel
            v-if="docId"
            v-show="activeSideTab === 'comments'"
            :doc-id="docId"
            :owner-id="docOwnerId"
            :share-token="token"
            :focused-comment-id="route.query.comment"
            :editor="editor"
            :pending-anchor="pendingCommentAnchor"
            :can-persist-anchors="permission === 'edit'"
            :document-ready="contentReady"
            @open="openSidePanel('comments')"
            @anchor-created="pendingCommentAnchor = null"
            @anchor-cancelled="pendingCommentAnchor = null"
            @count-change="commentCount = $event"
          />
        </aside>

        <button v-if="!sidePanelOpen" class="mobile-side-trigger" @click="openSidePanel(activeSideTab)">
          大纲 / 评论<span v-if="commentCount"> · {{ commentCount }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
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
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror'
import EditorToolbar from '../components/EditorToolbar.vue'
import CommentPanel from '../components/CommentPanel.vue'
import SelectionCommentButton from '../components/SelectionCommentButton.vue'
import CodeBlockWithCopy from '../extensions/codeBlockWithCopy.js'
import { DocImage, ImageGroup } from '../extensions/docImage.js'
import { api, getUser, getWebSocketUrl } from '../utils/api'
import { promoteInlineImages } from '../utils/legacyImageHtml.js'
import { insertUploadedImages } from '../utils/editorImages.js'
import { isImageFile } from '../utils/imageUpload.js'
import { handleCodeBlockTab } from '../utils/codeBlockIndent.js'
import { handleBackspaceDeleteEmptyLine } from '../utils/emptyLineBackspace.js'
import { insertParagraphInClickedGap } from '../utils/blockGapInsertion.js'
import { scrollToOutlineHeading } from '../utils/outlineNavigation.js'

const route = useRoute()
const token = route.params.token
const compactMedia = window.matchMedia('(max-width: 1000px)')

const loading = ref(true)
const error = ref('')
const docTitle = ref('')
const permission = ref('')
const docId = ref(null)
const docOwnerId = ref(null)
const user = ref(getUser())
const outline = ref([])
const contentReady = ref(false)
const activeSideTab = ref(route.query.comment ? 'comments' : 'outline')
const sidePanelOpen = ref(Boolean(route.query.comment) || !compactMedia.matches)
const pendingCommentAnchor = ref(null)
const commentCount = ref(0)
const imageNotice = ref('')
const imageNoticeError = ref(false)
let imageNoticeTimer = null

function reportImageStatus(status) {
  if (imageNoticeTimer) {
    clearTimeout(imageNoticeTimer)
    imageNoticeTimer = null
  }
  if (!status || status.type === 'empty') {
    imageNotice.value = ''
    return
  }
  imageNotice.value = status.text || ''
  imageNoticeError.value = status.type === 'error'
  if (status.type === 'pending') return
  imageNoticeTimer = setTimeout(() => {
    imageNotice.value = ''
    imageNoticeTimer = null
  }, 3200)
}

async function insertImageFiles(files) {
  await insertUploadedImages(editor.value, files, { onStatus: reportImageStatus })
}

const lowlight = createLowlight(common)

let ydoc = null
let provider = null

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false, codeBlock: false }),
    DocImage,
    ImageGroup,
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
    CodeBlockWithCopy.configure({ lowlight }),
    TextStyle,
    Color,
    HorizontalRule,
    Subscript,
    Superscript,
  ],
  editable: false,
  editorProps: {
    handleKeyDown: (view, event) => (
      handleBackspaceDeleteEmptyLine(view, event) || handleCodeBlockTab(view, event)
    ),
    handlePaste: (view, event) => {
      const files = Array.from(event.clipboardData?.files || [])
      if (!files.some(isImageFile)) return false
      event.preventDefault()
      insertImageFiles(files)
      return true
    },
    handleDrop: (view, event, _slice, moved) => {
      if (moved) return false
      const files = Array.from(event.dataTransfer?.files || [])
      if (!files.some(isImageFile)) return false
      event.preventDefault()
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (position) {
        view.dispatch(
          view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos)))
        )
      }
      insertImageFiles(files)
      return true
    },
    handleDOMEvents: {
      mousedown: insertParagraphInClickedGap,
    },
  },
  onUpdate: updateOutline,
})

function updateOutline() {
  if (!editor.value) return
  const nextOutline = []
  editor.value.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading') {
      nextOutline.push({ level: node.attrs.level, text: node.textContent, position })
    }
  })
  outline.value = nextOutline
}

function scrollToHeading(item) {
  if (scrollToOutlineHeading(editor.value, item.position) && compactMedia.matches) {
    sidePanelOpen.value = false
  }
}

function openSidePanel(tab) {
  activeSideTab.value = tab
  sidePanelOpen.value = true
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
}

onMounted(async () => {
  compactMedia.addEventListener?.('change', handleViewportChange)
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
      const wsUrl = getWebSocketUrl('/ws')
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
          editor.value.commands.setContent(promoteInlineImages(share.doc.content))
        }
        if (isSynced) {
          contentReady.value = true
          updateOutline()
        }
      })
    } else {
      // 只读模式
      editor.value.commands.setContent(promoteInlineImages(share.doc.content))
      contentReady.value = true
      updateOutline()
    }

  } catch (e) {
    error.value = e.message || '分享链接无效或已过期'
  }
  loading.value = false
})

onBeforeUnmount(() => {
  contentReady.value = false
  if (imageNoticeTimer) clearTimeout(imageNoticeTimer)
  compactMedia.removeEventListener?.('change', handleViewportChange)
  provider?.destroy()
  ydoc?.destroy()
  editor.value?.destroy()
})
</script>

<style scoped>
.shared-page {
  min-height: 100vh;
  overflow-x: hidden;
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
.shared-layout { padding: 24px 400px 40px 24px; transition: padding .2s ease; }
.shared-layout.right-panel-collapsed { padding-right: 24px; }
.loading, .error-page {
  text-align: center;
  padding: 80px 0;
  color: var(--text-muted);
}
.error-page button { margin-top: 16px; }
.editor-wrapper {
  max-width: 1000px;
  margin: 0 auto;
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
.editor-content :deep(.tiptap) { outline: none; overflow-wrap: anywhere; }
.doc-header h1 { overflow-wrap: anywhere; }
.editor-content :deep(table) { border-collapse: collapse; width: 100%; margin: 16px 0; }
.editor-content :deep(th), .editor-content :deep(td) { border: 1px solid var(--border); padding: 8px 12px; }
.editor-content :deep(th) { background: var(--bg-gray); font-weight: 600; }
.editor-content :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 14px; }
.editor-content :deep(blockquote) { border-left: 3px solid var(--primary); padding-left: 16px; margin: 12px 0; color: var(--text-secondary); }
.editor-content :deep(img) { max-width: 100%; border-radius: 4px; }
.editor-content :deep(a) { color: var(--primary); }
.editor-content :deep(mark) { background: #ffeaa7; padding: 0 2px; border-radius: 2px; }
.editor-content :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.shared-side-panel {
  position: fixed;
  top: 76px;
  right: 24px;
  bottom: 24px;
  width: 360px;
  padding: 14px;
  overflow-y: auto;
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 5px 5px 0 var(--primary);
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
.side-panel-tabs button.active { color: var(--text); background: var(--primary); font-weight: 700; }
.side-panel-close, .mobile-side-trigger { display: none; }
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
  top: 76px;
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
.right-panel-reopen { right: 0; }
@media (min-width: 1001px) {
  .shared-side-panel.panel-collapsed {
    transform: translateX(calc(100% + 32px));
    pointer-events: none;
  }
}
.empty-outline { padding: 24px 8px; color: var(--text-muted); text-align: center; }
.outline-list { margin: 0; padding: 0; list-style: none; }
.outline-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 2px 0;
  padding: 7px 8px;
  color: var(--text-secondary);
  border-left: 3px solid transparent;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.45;
  transition: background-color 80ms steps(2, end), color 80ms steps(2, end);
}
.outline-item:hover { color: var(--text); background: var(--surface-hover); }
.outline-level { width: 18px; flex: none; color: var(--text-muted); font-size: 10px; font-weight: 700; line-height: 1.9; }
.outline-text { min-width: 0; overflow-wrap: anywhere; }
.outline-item.level-1 { padding-left: 8px; color: var(--text); border-left-color: var(--border); font-size: 15px; font-weight: 700; }
.outline-item.level-2 { padding-left: 16px; color: var(--text); font-size: 14px; font-weight: 600; }
.outline-item.level-3 { padding-left: 24px; font-weight: 600; }
.outline-item.level-4 { padding-left: 32px; font-size: 12px; }
.outline-item.level-5 { padding-left: 40px; font-size: 12px; }
.outline-item.level-6 { padding-left: 48px; color: var(--text-muted); font-size: 12px; }
@media (max-width: 1000px) {
  .shared-layout, .shared-layout.right-panel-collapsed { padding: 12px 12px 72px; }
  .editor-wrapper { padding: 28px clamp(18px, 4vw, 48px); }
  .editor-content :deep(table) { display: block; max-width: 100%; overflow-x: auto; }
  .panel-edge-trigger { display: none; }
  .side-panel-tabs { grid-template-columns: 1fr 1fr 42px; }
  .side-panel-tabs .side-panel-collapse { display: none; }
  .shared-side-panel {
    inset: auto 0 0;
    z-index: 210;
    width: 100%;
    max-height: 72vh;
    padding: 14px;
    transform: translateY(105%);
    transition: transform .2s ease;
    box-shadow: 0 -5px 0 rgba(0, 0, 0, .12);
  }
  .shared-side-panel.mobile-open { transform: translateY(0); }
  .side-panel-close {
    display: block;
    width: 42px;
    min-height: 32px;
    padding: 0;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .mobile-side-trigger {
    position: fixed;
    right: 12px;
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
}
@media (prefers-reduced-motion: reduce) {
  .shared-layout, .shared-side-panel { transition: none; }
}

</style>

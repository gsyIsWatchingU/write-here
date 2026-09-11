<template>
  <div class="shared-page">
    <header class="topbar">
      <h1 class="logo brand-logo">
        <img src="/horizon-docs.svg" alt="" aria-hidden="true">
        <span>Horizon Docs</span>
      </h1>
      <span class="badge" v-if="permission">{{ permission === 'edit' ? '协同编辑' : '只读' }}</span>
    </header>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-page">
      <p>{{ error }}</p>
      <button class="primary" @click="$router.push('/login')">去登录</button>
    </div>
    <template v-else>
      <EditorToolbar v-if="editor && permission === 'edit'" :editor="editor" />
      <div class="shared-layout">
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

        <aside class="shared-side-panel" :class="{ 'mobile-open': sidePanelOpen }">
          <div class="side-panel-tabs">
            <button :class="{ active: activeSideTab === 'outline' }" @click="openSidePanel('outline')">大纲</button>
            <button :class="{ active: activeSideTab === 'comments' }" @click="openSidePanel('comments')">
              评论 <span v-if="commentCount">{{ commentCount }}</span>
            </button>
            <button class="side-panel-close" title="关闭侧栏" @click="sidePanelOpen = false">×</button>
          </div>
          <div v-show="activeSideTab === 'outline'" class="outline-content">
            <div v-if="outline.length === 0" class="empty-outline">暂无大纲内容</div>
            <ul v-else class="outline-list">
              <li
                v-for="(item, index) in outline"
                :key="index"
                :class="`outline-item level-${item.level}`"
                @click="scrollToHeading(item)"
              >{{ item.text }}</li>
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

        <button class="mobile-side-trigger" @click="openSidePanel(activeSideTab)">
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
import CommentPanel from '../components/CommentPanel.vue'
import SelectionCommentButton from '../components/SelectionCommentButton.vue'
import { api, getUser, getWebSocketUrl } from '../utils/api'
import { handleCodeBlockTab } from '../utils/codeBlockIndent.js'

const route = useRoute()
const token = route.params.token

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
const sidePanelOpen = ref(Boolean(route.query.comment))
const pendingCommentAnchor = ref(null)
const commentCount = ref(0)

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
  editorProps: {
    handleKeyDown: handleCodeBlockTab,
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
  editor.value?.commands.focus({ at: item.position, scrollIntoView: true })
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
          editor.value.commands.setContent(share.doc.content)
        }
        if (isSynced) {
          contentReady.value = true
          updateOutline()
        }
      })
    } else {
      // 只读模式
      editor.value.commands.setContent(share.doc.content)
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
.shared-layout { padding: 24px 400px 40px 24px; }
.loading, .error-page {
  text-align: center;
  padding: 80px 0;
  color: var(--text-muted);
}
.error-page button { margin-top: 16px; }
.editor-wrapper {
  max-width: 800px;
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
}
.side-panel-tabs {
  position: sticky;
  top: -14px;
  z-index: 4;
  display: grid;
  grid-template-columns: 1fr 1fr 34px;
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
.empty-outline { padding: 24px 8px; color: var(--text-muted); text-align: center; }
.outline-list { margin: 0; padding: 0; list-style: none; }
.outline-item { padding: 6px 8px; color: var(--text-secondary); cursor: pointer; }
.outline-item:hover { color: var(--text); background: var(--surface-hover); }
.outline-item.level-2 { padding-left: 16px; }
.outline-item.level-3 { padding-left: 24px; }
.outline-item.level-4 { padding-left: 32px; }
@media (max-width: 760px) {
  .shared-layout { padding: 12px 12px 56px; }
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
  .side-panel-close { display: block; }
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
  .shared-side-panel { transition: none; }
}

</style>

<template>
  <BubbleMenu
    :editor="editor"
    :should-show="shouldShow"
    :tippy-options="tippyOptions"
    :update-delay="80"
  >
    <div ref="menuRoot" class="selection-menu" @mousedown.prevent>
      <div v-if="canEdit" class="selection-block-control">
        <button
          class="selection-block-trigger"
          type="button"
          :aria-expanded="blockMenuOpen"
          title="转换选中文字所在的整块"
          @mousedown.prevent.stop="blockMenuOpen = !blockMenuOpen"
        >
          <span>{{ currentBlockLabel }}</span>
          <span aria-hidden="true">⌄</span>
        </button>

        <div v-if="blockMenuOpen" class="selection-block-panel" role="menu">
          <div class="selection-block-heading">
            <span>转换整块为</span>
            <span>{{ currentBlockLabel }}</span>
          </div>
          <button
            v-for="option in BLOCK_OPTIONS"
            :key="option.type"
            class="selection-block-option"
            :class="{ active: currentBlockType === option.type }"
            type="button"
            role="menuitem"
            @mousedown.prevent.stop="handleConvertBlock(option.type)"
          >
            <span class="selection-block-icon" aria-hidden="true">{{ option.icon }}</span>
            <span>{{ option.label }}</span>
            <span v-if="currentBlockType === option.type" class="selection-block-check" aria-hidden="true">✓</span>
          </button>
        </div>
      </div>

      <span v-if="canEdit" class="selection-divider" aria-hidden="true"></span>

      <div v-if="canEdit" class="selection-format-actions">
        <button
          class="selection-action"
          :class="{ active: isActive('bold') }"
          type="button"
          title="粗体"
          @mousedown.prevent.stop="toggleMark('bold')"
        ><strong>B</strong></button>
        <button
          class="selection-action"
          :class="{ active: isActive('italic') }"
          type="button"
          title="斜体"
          @mousedown.prevent.stop="toggleMark('italic')"
        ><em>I</em></button>
        <button
          class="selection-action"
          :class="{ active: isActive('underline') }"
          type="button"
          title="下划线"
          @mousedown.prevent.stop="toggleMark('underline')"
        ><u>U</u></button>
        <button
          class="selection-action"
          :class="{ active: isActive('strike') }"
          type="button"
          title="删除线"
          @mousedown.prevent.stop="toggleMark('strike')"
        ><s>S</s></button>
        <button
          class="selection-action"
          :class="{ active: isActive('highlight') }"
          type="button"
          title="高亮"
          @mousedown.prevent.stop="toggleMark('highlight')"
        ><span class="highlight-symbol">H</span></button>
        <button
          class="selection-action"
          :class="{ active: isActive('link') }"
          type="button"
          title="链接"
          @mousedown.prevent.stop="setLink"
        >↗</button>
      </div>

      <span v-if="canEdit && canComment" class="selection-divider" aria-hidden="true"></span>

      <button
        v-if="canComment"
        class="selection-comment-action"
        type="button"
        :disabled="!commentAnchor"
        :title="commentTitle"
        @mousedown.prevent.stop="createComment"
      >
        <span aria-hidden="true">▱</span>
        评论
      </button>
    </div>
  </BubbleMenu>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3'
import { contextForRange, readAnchorText } from '../utils/commentAnchors'
import {
  BLOCK_OPTIONS,
  convertBlock,
  getSelectionBlockType,
} from '../utils/editorBlocks'

const props = defineProps({
  editor: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  canComment: { type: Boolean, default: false },
})

const emit = defineEmits(['comment'])
const menuRoot = ref(null)
const blockMenuOpen = ref(false)
const currentBlockType = ref('paragraph')
const commentAnchor = ref(null)
const revision = ref(0)

const tippyOptions = {
  duration: 120,
  placement: 'top',
  maxWidth: 'none',
  interactive: true,
}

const currentBlockLabel = computed(() => {
  if (currentBlockType.value === 'mixed') return '多种块'
  return BLOCK_OPTIONS.find(option => option.type === currentBlockType.value)?.label || '正文'
})

const commentTitle = computed(() => (
  commentAnchor.value ? '评论选中文字' : '评论最多支持 500 个字符'
))

function readSelectionAnchor(editor = props.editor) {
  const selection = editor?.state?.selection
  if (!selection || selection.empty) return null

  const { from, to } = selection
  const quoteText = readAnchorText(editor.state.doc, from, to)
  if (!quoteText || quoteText.length > 500) return null

  return {
    from,
    to,
    quoteText,
    ...contextForRange(editor.state.doc, from, to),
    status: 'active',
  }
}

function refreshState() {
  revision.value += 1
  currentBlockType.value = getSelectionBlockType(props.editor)
  commentAnchor.value = readSelectionAnchor()
  if (props.editor.state.selection.empty) blockMenuOpen.value = false
}

function shouldShow({ editor, state, from, to }) {
  if ((!props.canEdit && !props.canComment) || from === to) return false
  const quoteText = readAnchorText(state.doc, from, to)
  if (!quoteText) return false

  currentBlockType.value = getSelectionBlockType(editor)
  commentAnchor.value = quoteText.length <= 500
    ? {
        from,
        to,
        quoteText,
        ...contextForRange(state.doc, from, to),
        status: 'active',
      }
    : null
  return true
}

function handleConvertBlock(type) {
  convertBlock(props.editor, type)
  currentBlockType.value = getSelectionBlockType(props.editor)
  blockMenuOpen.value = false
}

function isActive(type) {
  revision.value
  return props.editor.isActive(type)
}

function toggleMark(type) {
  const commands = {
    bold: 'toggleBold',
    italic: 'toggleItalic',
    underline: 'toggleUnderline',
    strike: 'toggleStrike',
    highlight: 'toggleHighlight',
  }
  const command = commands[type]
  if (command) props.editor.chain().focus()[command]().run()
}

function setLink() {
  const previousUrl = props.editor.getAttributes('link').href
  const url = prompt('请输入链接地址：', previousUrl)
  if (url === null) return
  if (url === '') {
    props.editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  props.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

function createComment() {
  const anchor = readSelectionAnchor() || commentAnchor.value
  if (!anchor) return
  blockMenuOpen.value = false
  emit('comment', { ...anchor })
}

function handleDocumentPointer(event) {
  if (!menuRoot.value?.contains(event.target)) blockMenuOpen.value = false
}

onMounted(() => {
  props.editor.on('selectionUpdate', refreshState)
  props.editor.on('transaction', refreshState)
  document.addEventListener('mousedown', handleDocumentPointer)
  refreshState()
})

onBeforeUnmount(() => {
  props.editor.off('selectionUpdate', refreshState)
  props.editor.off('transaction', refreshState)
  document.removeEventListener('mousedown', handleDocumentPointer)
})
</script>

<style scoped>
.selection-menu {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 38px;
  padding: 4px;
  color: var(--text);
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 4px 4px 0 var(--primary);
  font-family: inherit;
}

.selection-block-control {
  position: relative;
}

.selection-block-trigger,
.selection-action,
.selection-comment-action {
  min-height: 28px;
  padding: 4px 8px;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.selection-block-trigger,
.selection-comment-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.selection-block-trigger:hover,
.selection-block-trigger[aria-expanded='true'],
.selection-action:hover,
.selection-action.active,
.selection-comment-action:hover {
  background: var(--primary);
  border-color: var(--border);
}

.selection-format-actions {
  display: flex;
  align-items: center;
  gap: 1px;
}

.selection-action {
  width: 29px;
  padding: 4px;
  font-size: 13px;
}

.highlight-symbol {
  padding: 0 3px;
  background: var(--primary);
  border: 1px solid var(--border);
}

.selection-divider {
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: var(--border-soft);
}

.selection-comment-action:disabled {
  opacity: .42;
  cursor: not-allowed;
}

.selection-block-panel {
  position: absolute;
  z-index: 10;
  top: calc(100% + 8px);
  left: -6px;
  width: 220px;
  max-height: min(420px, 60vh);
  overflow-y: auto;
  padding: 8px;
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 5px 5px 0 var(--border);
}

.selection-block-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px 9px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
}

.selection-block-option {
  display: grid;
  grid-template-columns: 34px 1fr 18px;
  align-items: center;
  width: 100%;
  min-height: 36px;
  padding: 5px 8px;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.selection-block-option:hover,
.selection-block-option.active {
  background: var(--surface-hover);
  border-color: var(--border);
}

.selection-block-icon,
.selection-block-check {
  font-weight: 700;
}

.selection-block-check {
  color: var(--primary-strong);
  text-align: right;
}

@media (max-width: 760px) {
  .selection-menu {
    max-width: calc(100vw - 20px);
  }

  .selection-block-trigger,
  .selection-action,
  .selection-comment-action {
    flex: none;
  }

  .selection-block-panel {
    top: calc(100% + 8px);
    right: auto;
    bottom: auto;
    left: 0;
    width: min(300px, calc(100vw - 20px));
    max-height: min(360px, 48vh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .selection-block-trigger,
  .selection-action,
  .selection-comment-action,
  .selection-block-option {
    transition: none;
  }
}
</style>

<template>
  <Teleport to="body">
    <div
      v-show="visible"
      ref="menuRoot"
      class="block-menu"
      :style="positionStyle"
    >
      <button
        class="block-menu-trigger"
        :class="{ dragging }"
        type="button"
        draggable="true"
        :aria-expanded="open"
        aria-label="拖动整块或打开块操作"
        title="拖动整块；点击打开块操作"
        @click.stop="toggleMenu"
        @dragstart="startDrag"
        @dragend="finishDrag"
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>

      <div v-if="open" class="block-menu-panel" role="menu" @mousedown.prevent @click.stop>
        <div class="block-menu-heading">
          <span>转换为</span>
          <span class="block-menu-current">{{ currentBlockLabel }}</span>
        </div>
        <button
          v-for="option in blockOptions"
          :key="option.type"
          class="block-menu-option"
          :class="{ active: currentBlockType === option.type }"
          type="button"
          role="menuitem"
          @click="convertBlock(option.type)"
        >
          <span class="block-menu-icon" aria-hidden="true">{{ option.icon }}</span>
          <span>{{ option.label }}</span>
          <span v-if="currentBlockType === option.type" class="block-menu-check" aria-hidden="true">✓</span>
        </button>

        <div class="block-menu-divider"></div>
        <div class="block-menu-actions" aria-label="块操作">
          <button class="block-menu-option" type="button" @click="duplicateBlock">
            <span class="block-menu-icon" aria-hidden="true">⧉</span>
            <span>复制块</span>
          </button>
          <button class="block-menu-option" type="button" :disabled="!canMoveUp" @click="moveBlock(-1)">
            <span class="block-menu-icon" aria-hidden="true">↑</span>
            <span>上移</span>
          </button>
          <button class="block-menu-option" type="button" :disabled="!canMoveDown" @click="moveBlock(1)">
            <span class="block-menu-icon" aria-hidden="true">↓</span>
            <span>下移</span>
          </button>
          <button class="block-menu-option danger" type="button" @click="deleteBlock">
            <span class="block-menu-icon" aria-hidden="true">×</span>
            <span>删除块</span>
          </button>
        </div>
      </div>

      <div
        v-if="dragging && dropInsertionIndex !== null"
        class="block-drop-indicator"
        :style="dropIndicatorStyle"
        aria-hidden="true"
      ></div>
    </div>
  </Teleport>
</template>

<script setup>
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getBlockInsertionIndex,
  getBlockMenuAnchor,
  getBlockMoveTargetIndex,
  moveTopLevelBlock,
} from '../utils/blockMenu.js'

const props = defineProps({
  editor: { type: Object, required: true },
})

const blockOptions = [
  { type: 'paragraph', label: '正文', icon: '¶' },
  { type: 'heading-1', label: '标题 1', icon: 'H1' },
  { type: 'heading-2', label: '标题 2', icon: 'H2' },
  { type: 'heading-3', label: '标题 3', icon: 'H3' },
  { type: 'heading-4', label: '标题 4', icon: 'H4' },
  { type: 'bullet-list', label: '项目符号列表', icon: '•' },
  { type: 'ordered-list', label: '编号列表', icon: '1.' },
  { type: 'task-list', label: '待办事项', icon: '☑' },
  { type: 'blockquote', label: '引用', icon: '❞' },
  { type: 'code-block', label: '代码块', icon: '</>' },
]

const menuRoot = ref(null)
const visible = ref(false)
const open = ref(false)
const top = ref(0)
const left = ref(0)
const currentBlockType = ref('paragraph')
const canMoveUp = ref(false)
const canMoveDown = ref(false)
const dragging = ref(false)
const dropInsertionIndex = ref(null)
const dropTop = ref(0)
const dropLeft = ref(0)
const dropWidth = ref(0)
let animationFrame = null
let targetBlockRange = null
let highlightedRangeKey = ''
let draggedBlock = null
let draggedElement = null
let dragGhost = null

const blockHighlightPluginKey = new PluginKey('blockConversionHighlight')
const blockHighlightPlugin = new Plugin({
  key: blockHighlightPluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, decorations) {
      const targetRange = transaction.getMeta(blockHighlightPluginKey)
      if (targetRange === undefined) return decorations.map(transaction.mapping, transaction.doc)
      if (!targetRange) return DecorationSet.empty

      const node = transaction.doc.nodeAt(targetRange.from)
      if (!node || targetRange.to !== targetRange.from + node.nodeSize) return DecorationSet.empty

      return DecorationSet.create(transaction.doc, [
        Decoration.node(targetRange.from, targetRange.to, {
          class: 'block-conversion-target',
          'data-block-conversion-target': 'true',
        }),
      ])
    },
  },
  props: {
    decorations(state) {
      return blockHighlightPluginKey.getState(state)
    },
  },
})

const positionStyle = computed(() => ({
  top: `${top.value}px`,
  left: `${left.value}px`,
}))

const dropIndicatorStyle = computed(() => ({
  top: `${dropTop.value}px`,
  left: `${dropLeft.value}px`,
  width: `${dropWidth.value}px`,
}))

const currentBlockLabel = computed(() => (
  blockOptions.find((option) => option.type === currentBlockType.value)?.label || '正文'
))

function syncTargetHighlight() {
  const targetRange = open.value ? targetBlockRange : null
  const nextRangeKey = targetRange ? `${targetRange.from}:${targetRange.to}` : ''
  if (nextRangeKey === highlightedRangeKey) return

  highlightedRangeKey = nextRangeKey
  const editor = props.editor
  if (!editor?.view || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(blockHighlightPluginKey, targetRange))
}

function setTargetBlockRange(range) {
  if (
    targetBlockRange?.from === range?.from
    && targetBlockRange?.to === range?.to
  ) {
    syncTargetHighlight()
    return
  }

  targetBlockRange = range
  syncTargetHighlight()
}

function setOpen(value) {
  open.value = value
  syncTargetHighlight()
}

function toggleMenu() {
  setOpen(!open.value)
}

function hideMenu() {
  visible.value = false
  setOpen(false)
  setTargetBlockRange(null)
}

function getCurrentBlockType() {
  for (let level = 1; level <= 4; level += 1) {
    if (props.editor.isActive('heading', { level })) return `heading-${level}`
  }
  if (props.editor.isActive('taskList')) return 'task-list'
  if (props.editor.isActive('bulletList')) return 'bullet-list'
  if (props.editor.isActive('orderedList')) return 'ordered-list'
  if (props.editor.isActive('blockquote')) return 'blockquote'
  if (props.editor.isActive('codeBlock')) return 'code-block'
  return 'paragraph'
}

function getCurrentBlock() {
  const $from = getBlockMenuAnchor(props.editor.state.selection)
  if (!$from) return null

  const index = $from.index(0)
  const position = $from.before(1)
  const node = props.editor.state.doc.child(index)
  return { index, position, node }
}

function getTopLevelBlockElement(editor, currentBlock) {
  const element = editor.view.nodeDOM(currentBlock.position)
  return element instanceof HTMLElement ? element : null
}

function updatePosition() {
  if (dragging.value) return
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = requestAnimationFrame(() => {
    animationFrame = null
    if (dragging.value) return
    const editor = props.editor
    if (!editor?.view || editor.isDestroyed || !editor.isFocused || !editor.isEditable) {
      hideMenu()
      return
    }

    const currentBlock = getCurrentBlock()
    if (!currentBlock) {
      hideMenu()
      return
    }

    const blockElement = getTopLevelBlockElement(editor, currentBlock)
    if (!blockElement) {
      hideMenu()
      return
    }

    const blockRect = blockElement.getBoundingClientRect()
    const topOffset = Math.min(10, Math.max(0, (blockRect.height - 30) / 2))
    top.value = blockRect.top + topOffset
    left.value = Math.max(4, blockRect.left - 38)
    setTargetBlockRange({
      from: currentBlock.position,
      to: currentBlock.position + currentBlock.node.nodeSize,
    })
    currentBlockType.value = getCurrentBlockType()
    canMoveUp.value = currentBlock.index > 0
    canMoveDown.value = currentBlock.index < editor.state.doc.childCount - 1
    visible.value = true
  })
}

function unwrapCurrentList(chain) {
  if (props.editor.isActive('taskList')) chain.toggleTaskList()
  else if (props.editor.isActive('bulletList')) chain.toggleBulletList()
  else if (props.editor.isActive('orderedList')) chain.toggleOrderedList()
  return chain
}

function convertBlock(type) {
  let chain = props.editor.chain().focus()

  if (type === 'paragraph') {
    chain = unwrapCurrentList(chain)
    chain.setParagraph().run()
  } else if (type.startsWith('heading-')) {
    chain = unwrapCurrentList(chain)
    chain.setHeading({ level: Number(type.split('-')[1]) }).run()
  } else if (type === 'bullet-list') {
    if (!props.editor.isActive('bulletList')) chain.toggleBulletList().run()
  } else if (type === 'ordered-list') {
    if (!props.editor.isActive('orderedList')) chain.toggleOrderedList().run()
  } else if (type === 'task-list') {
    if (!props.editor.isActive('taskList')) chain.toggleTaskList().run()
  } else if (type === 'blockquote') {
    chain = unwrapCurrentList(chain)
    if (!props.editor.isActive('blockquote')) chain.toggleBlockquote().run()
  } else if (type === 'code-block') {
    chain = unwrapCurrentList(chain)
    chain.setCodeBlock().run()
  }

  currentBlockType.value = getCurrentBlockType()
  setOpen(false)
  nextTick(updatePosition)
}

function focusTransactionBlock(transaction, position) {
  const resolvedPosition = Math.min(position + 1, transaction.doc.content.size)
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(resolvedPosition)))
  transaction.scrollIntoView()
}

function duplicateBlock() {
  const currentBlock = getCurrentBlock()
  if (!currentBlock) return

  const insertPosition = currentBlock.position + currentBlock.node.nodeSize
  const transaction = props.editor.state.tr.insert(
    insertPosition,
    currentBlock.node.copy(currentBlock.node.content),
  )
  focusTransactionBlock(transaction, insertPosition)
  props.editor.view.dispatch(transaction)
  props.editor.commands.focus()
  setOpen(false)
  nextTick(updatePosition)
}

function moveBlock(direction) {
  const currentBlock = getCurrentBlock()
  if (!currentBlock) return

  const { doc } = props.editor.state
  const targetIndex = currentBlock.index + direction
  if (targetIndex < 0 || targetIndex >= doc.childCount) return

  const transaction = props.editor.state.tr
  const currentEnd = currentBlock.position + currentBlock.node.nodeSize
  let insertPosition

  if (direction < 0) {
    const previousNode = doc.child(targetIndex)
    insertPosition = currentBlock.position - previousNode.nodeSize
    transaction.delete(currentBlock.position, currentEnd)
    transaction.insert(insertPosition, currentBlock.node)
  } else {
    const nextNode = doc.child(targetIndex)
    insertPosition = currentBlock.position + nextNode.nodeSize
    transaction.delete(currentBlock.position, currentEnd)
    transaction.insert(insertPosition, currentBlock.node)
  }

  focusTransactionBlock(transaction, insertPosition)
  props.editor.view.dispatch(transaction)
  props.editor.commands.focus()
  setOpen(false)
  nextTick(updatePosition)
}

function deleteBlock() {
  const currentBlock = getCurrentBlock()
  if (!currentBlock) return

  const transaction = props.editor.state.tr
  const currentEnd = currentBlock.position + currentBlock.node.nodeSize
  if (props.editor.state.doc.childCount === 1) {
    const paragraph = props.editor.schema.nodes.paragraph.create()
    transaction.replaceWith(currentBlock.position, currentEnd, paragraph)
    focusTransactionBlock(transaction, currentBlock.position)
  } else {
    transaction.delete(currentBlock.position, currentEnd)
    const nextPosition = Math.min(currentBlock.position, transaction.doc.content.size)
    focusTransactionBlock(transaction, Math.max(0, nextPosition - 1))
  }

  props.editor.view.dispatch(transaction)
  props.editor.commands.focus()
  setOpen(false)
  nextTick(updatePosition)
}

function getTopLevelBlockEntries() {
  const editor = props.editor
  const entries = []

  editor.state.doc.forEach((node, position, index) => {
    const element = editor.view.nodeDOM(position)
    if (!(element instanceof HTMLElement)) return
    entries.push({ index, node, position, element, rect: element.getBoundingClientRect() })
  })

  return entries
}

function createDragGhost(label) {
  const ghost = document.createElement('div')
  ghost.className = 'block-drag-ghost'
  ghost.textContent = `拖动${label}`
  document.body.appendChild(ghost)
  return ghost
}

function startDrag(event) {
  const currentBlock = getCurrentBlock()
  if (!currentBlock || !event.dataTransfer) {
    event.preventDefault()
    return
  }

  const element = getTopLevelBlockElement(props.editor, currentBlock)
  if (!element) {
    event.preventDefault()
    return
  }

  draggedBlock = currentBlock
  draggedElement = element
  draggedElement.classList.add('is-block-dragging')
  dragging.value = true
  setOpen(false)

  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-write-here-block', String(currentBlock.index))
  dragGhost = createDragGhost(currentBlockLabel.value)
  event.dataTransfer.setDragImage(dragGhost, 16, 16)
}

function isWithinEditor(event) {
  const editorRect = props.editor.view.dom.getBoundingClientRect()
  return event.clientX >= editorRect.left - 48
    && event.clientX <= editorRect.right + 48
    && event.clientY >= editorRect.top - 20
    && event.clientY <= editorRect.bottom + 20
}

function handleDragOver(event) {
  if (!dragging.value || !draggedBlock) return

  if (!isWithinEditor(event)) {
    dropInsertionIndex.value = null
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const entries = getTopLevelBlockEntries()
  if (!entries.length) return

  const insertionIndex = getBlockInsertionIndex(entries.map((entry) => entry.rect), event.clientY)
  const targetIndex = getBlockMoveTargetIndex(
    draggedBlock.index,
    insertionIndex,
    entries.length,
  )

  if (targetIndex === null) {
    dropInsertionIndex.value = null
    return
  }

  event.dataTransfer.dropEffect = 'move'
  const boundaryY = insertionIndex < entries.length
    ? entries[insertionIndex].rect.top
    : entries[entries.length - 1].rect.bottom
  const contentLeft = Math.min(...entries.map((entry) => entry.rect.left))
  const contentRight = Math.max(...entries.map((entry) => entry.rect.right))

  dropInsertionIndex.value = insertionIndex
  dropTop.value = boundaryY - 1
  dropLeft.value = contentLeft
  dropWidth.value = Math.max(24, contentRight - contentLeft)
}

function handleDrop(event) {
  if (!dragging.value || !draggedBlock) return

  event.preventDefault()
  event.stopPropagation()
  if (!isWithinEditor(event) || dropInsertionIndex.value === null) {
    finishDrag()
    return
  }
  const { doc } = props.editor.state
  if (draggedBlock.index >= doc.childCount) {
    finishDrag()
    return
  }
  const sourceNode = doc.child(draggedBlock.index)
  const targetIndex = getBlockMoveTargetIndex(
    draggedBlock.index,
    dropInsertionIndex.value,
    doc.childCount,
  )

  if (targetIndex === null || !sourceNode?.eq(draggedBlock.node)) {
    finishDrag()
    return
  }

  const move = moveTopLevelBlock(props.editor.state.tr, draggedBlock.index, targetIndex)
  if (!move) {
    finishDrag()
    return
  }

  focusTransactionBlock(move.transaction, move.insertPosition)
  props.editor.view.dispatch(move.transaction)
  props.editor.commands.focus()
  finishDrag()
  nextTick(updatePosition)
}

function finishDrag() {
  draggedElement?.classList.remove('is-block-dragging')
  dragGhost?.remove()
  draggedBlock = null
  draggedElement = null
  dragGhost = null
  dragging.value = false
  dropInsertionIndex.value = null
}

function handleDocumentClick(event) {
  if (!menuRoot.value?.contains(event.target)) setOpen(false)
}

function handleBlur() {
  if (dragging.value) return
  requestAnimationFrame(() => {
    if (!menuRoot.value?.contains(document.activeElement)) {
      hideMenu()
    }
  })
}

onMounted(() => {
  props.editor.registerPlugin(blockHighlightPlugin)
  props.editor.on('selectionUpdate', updatePosition)
  props.editor.on('focus', updatePosition)
  props.editor.on('transaction', updatePosition)
  props.editor.on('blur', handleBlur)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('dragover', handleDragOver, true)
  document.addEventListener('drop', handleDrop, true)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  nextTick(updatePosition)
})

onBeforeUnmount(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  setTargetBlockRange(null)
  props.editor.off('selectionUpdate', updatePosition)
  props.editor.off('focus', updatePosition)
  props.editor.off('transaction', updatePosition)
  props.editor.off('blur', handleBlur)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('dragover', handleDragOver, true)
  document.removeEventListener('drop', handleDrop, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  finishDrag()
  if (!props.editor.isDestroyed) props.editor.unregisterPlugin(blockHighlightPluginKey)
})
</script>

<style scoped>
.block-menu {
  position: fixed;
  z-index: 120;
}

.block-menu-trigger {
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  color: var(--text-muted);
  background: var(--bg);
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: grab;
}

.block-menu-trigger.dragging {
  cursor: grabbing;
}

.block-menu-trigger:hover,
.block-menu-trigger[aria-expanded='true'] {
  color: var(--text);
  background: var(--surface-hover);
  border-color: var(--border);
}

.block-menu-panel {
  position: absolute;
  top: 34px;
  left: 0;
  width: 220px;
  max-height: min(420px, 70vh);
  overflow-y: auto;
  padding: 8px;
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 5px 5px 0 var(--border);
}

.block-menu-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px 9px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
}

.block-menu-current {
  color: var(--primary-strong);
}

.block-menu-option {
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

.block-menu-option:hover,
.block-menu-option.active {
  background: var(--surface-hover);
  border-color: var(--border);
}

.block-menu-icon {
  font-weight: 700;
}

.block-menu-check {
  color: var(--primary-strong);
  font-weight: 700;
  text-align: right;
}

.block-menu-divider {
  height: 1px;
  margin: 8px 0;
  background: var(--border-soft);
}

.block-menu-option:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.block-menu-option.danger {
  color: var(--danger);
}

.block-menu-option.danger:hover {
  background: var(--danger-hover);
}

.block-drop-indicator {
  position: fixed;
  z-index: 125;
  height: 3px;
  pointer-events: none;
  background: var(--primary-strong);
  box-shadow: 0 0 0 1px var(--bg);
}

:global(.block-drag-ghost) {
  position: fixed;
  top: -1000px;
  left: -1000px;
  padding: 7px 10px;
  color: var(--text);
  background: var(--primary);
  border: 2px solid var(--border);
  font: 700 12px/1.2 var(--font-mono);
  white-space: nowrap;
}

:global(#app .editor-content .is-block-dragging) {
  opacity: 0.42;
}

:global(#app .editor-content .block-conversion-target) {
  background: var(--primary-hover) !important;
  outline: 2px solid var(--primary-strong);
  outline-offset: 2px;
  transition: background-color 80ms steps(2, end), outline-color 80ms steps(2, end);
}

@media (max-width: 760px) {
  .block-menu-panel {
    left: -2px;
    width: min(220px, calc(100vw - 24px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .block-menu-trigger,
  .block-menu-option,
  :global(#app .editor-content .block-conversion-target) {
    transition: none;
  }
}
</style>

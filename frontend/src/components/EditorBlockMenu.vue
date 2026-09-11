<template>
  <Teleport to="body">
    <div
      v-show="visible"
      ref="menuRoot"
      class="block-menu"
      :style="positionStyle"
      @mouseenter="setHovered(true)"
      @mouseleave="setHovered(false)"
    >
      <button
        class="block-menu-trigger"
        type="button"
        :aria-expanded="open"
        aria-label="打开当前块操作"
        title="当前块操作"
        @mousedown.prevent
        @focus="setHovered(true)"
        @blur="setHovered(false)"
        @click.stop="toggleMenu"
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
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { BLOCK_OPTIONS, convertBlock as applyBlockConversion, getCurrentBlockType } from '../utils/editorBlocks'

const props = defineProps({
  editor: { type: Object, required: true },
})

const blockOptions = BLOCK_OPTIONS

const menuRoot = ref(null)
const visible = ref(false)
const open = ref(false)
const top = ref(0)
const left = ref(0)
const currentBlockType = ref('paragraph')
const hovered = ref(false)
let animationFrame = null
let targetBlockRange = null
let highlightedRangeKey = ''

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

const currentBlockLabel = computed(() => (
  blockOptions.find((option) => option.type === currentBlockType.value)?.label || '正文'
))

function syncTargetHighlight() {
  const targetRange = hovered.value || open.value ? targetBlockRange : null
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

function setHovered(value) {
  hovered.value = value
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
  hovered.value = false
  setOpen(false)
  setTargetBlockRange(null)
}

function getTargetTextBlock(editor, $from) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (!node.isTextblock) continue

    const from = $from.before(depth)
    const element = editor.view.nodeDOM(from)
    if (element instanceof HTMLElement) {
      return { element, from, to: from + node.nodeSize }
    }
  }

  return null
}

function updatePosition() {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = requestAnimationFrame(() => {
    animationFrame = null
    const editor = props.editor
    if (!editor?.view || editor.isDestroyed || !editor.isFocused || !editor.isEditable) {
      hideMenu()
      return
    }

    const { $from, empty } = editor.state.selection
    if (!empty) {
      hideMenu()
      return
    }
    if ($from.depth < 1) {
      hideMenu()
      return
    }

    const targetBlock = getTargetTextBlock(editor, $from)
    if (!targetBlock) {
      hideMenu()
      return
    }

    const blockRect = targetBlock.element.getBoundingClientRect()
    const cursorRect = editor.view.coordsAtPos($from.pos)
    const cursorHeight = Math.max(1, cursorRect.bottom - cursorRect.top)
    top.value = cursorRect.top + ((cursorHeight - 30) / 2)
    left.value = Math.max(4, blockRect.left - 38)
    setTargetBlockRange({ from: targetBlock.from, to: targetBlock.to })
    currentBlockType.value = getCurrentBlockType(props.editor)
    visible.value = true
  })
}

function convertBlock(type) {
  applyBlockConversion(props.editor, type)
  currentBlockType.value = getCurrentBlockType(props.editor)
  hovered.value = false
  setOpen(false)
  nextTick(updatePosition)
}

function handleDocumentClick(event) {
  if (!menuRoot.value?.contains(event.target)) {
    hovered.value = false
    setOpen(false)
  }
}

function handleBlur() {
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
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
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
  padding: 0;
  color: var(--text-muted);
  background: var(--bg);
  border: 1px solid transparent;
  border-radius: 0;
  font-family: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
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

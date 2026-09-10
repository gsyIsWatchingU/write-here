<template>
  <Teleport to="body">
    <button
      v-show="visible"
      class="selection-comment-button"
      type="button"
      :style="positionStyle"
      title="评论选中文字"
      @mousedown.prevent.stop="createComment"
    >
      <span aria-hidden="true">▱</span>
      评论
    </button>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { contextForRange, readAnchorText } from '../utils/commentAnchors'

const props = defineProps({
  editor: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
})

const emit = defineEmits(['comment'])
const visible = ref(false)
const top = ref(0)
const left = ref(0)
const selectedAnchor = ref(null)
let animationFrame = null

const positionStyle = computed(() => ({ top: `${top.value}px`, left: `${left.value}px` }))

function updatePosition() {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = requestAnimationFrame(() => {
    animationFrame = null
    const editor = props.editor
    const selection = editor?.state?.selection
    if (!props.enabled || !editor?.view || editor.isDestroyed || !selection || selection.empty) {
      visible.value = false
      selectedAnchor.value = null
      return
    }

    const { from, to } = selection
    const quoteText = readAnchorText(editor.state.doc, from, to)
    if (!quoteText || quoteText.length > 500) {
      visible.value = false
      selectedAnchor.value = null
      return
    }

    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    top.value = Math.max(8, Math.min(start.top, end.top) - 42)
    left.value = Math.max(8, Math.min(window.innerWidth - 92, (start.left + end.right) / 2 - 38))
    selectedAnchor.value = {
      from,
      to,
      quoteText,
      ...contextForRange(editor.state.doc, from, to),
      status: 'active',
    }
    visible.value = true
  })
}

function createComment() {
  if (!selectedAnchor.value) return
  emit('comment', { ...selectedAnchor.value })
  visible.value = false
}

onMounted(() => {
  props.editor.on('selectionUpdate', updatePosition)
  props.editor.on('transaction', updatePosition)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})

onBeforeUnmount(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  props.editor.off('selectionUpdate', updatePosition)
  props.editor.off('transaction', updatePosition)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<style scoped>
.selection-comment-button {
  position: fixed;
  z-index: 180;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--text);
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: 0;
  box-shadow: 3px 3px 0 var(--primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.selection-comment-button:hover {
  background: var(--primary);
}
</style>

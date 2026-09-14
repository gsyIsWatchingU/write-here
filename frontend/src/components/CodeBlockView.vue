<template>
  <node-view-wrapper class="code-block-shell">
    <button
      class="code-block-copy-button"
      type="button"
      contenteditable="false"
      draggable="false"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      @mousedown.prevent
      @click="copyCode"
    >
      <svg v-if="copyState === 'success'" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 12 4 4L19 6" />
      </svg>
      <svg v-else-if="copyState === 'error'" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7l10 10M17 7 7 17" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
    </button>
    <pre><node-view-content as="code" /></pre>
    <span class="code-block-copy-announcement" aria-live="polite">{{ announcement }}</span>
  </node-view-wrapper>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { copyPlainText } from '../utils/clipboard.js'

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
})

const copyState = ref('idle')
let resetTimer = null

const buttonLabel = computed(() => {
  if (copyState.value === 'success') return '已复制代码'
  if (copyState.value === 'error') return '复制失败，请重试'
  return '复制代码'
})

const announcement = computed(() => (
  copyState.value === 'success'
    ? '代码已复制'
    : copyState.value === 'error' ? '代码复制失败' : ''
))

async function copyCode() {
  clearTimeout(resetTimer)
  copyState.value = await copyPlainText(props.node.textContent) ? 'success' : 'error'
  resetTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 1600)
}

onBeforeUnmount(() => clearTimeout(resetTimer))
</script>

<template>
  <div class="ai-polish">
    <button
      type="button"
      class="icon-btn ai-polish-btn"
      :class="{ running }"
      :disabled="running"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      @click="openModal"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 1.8 9.2 5.6 13 6.8 9.2 8 8 11.8 6.8 8 3 6.8 6.8 5.6Z"
          fill="currentColor"
        />
        <path d="M12.5 10.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6Z" fill="currentColor" opacity="0.65" />
      </svg>
      <span>AI 润色</span>
    </button>
    <span v-if="message" class="ai-message" :class="{ error: messageIsError }">{{ message }}</span>

    <div v-if="open" class="modal-overlay" @click.self="closeModal">
      <div class="modal">
        <h3>AI 润色整篇文档</h3>
        <p class="modal-hint">
          将把整篇文档交给 Claude 润色，完成后会<strong>替换当前正文</strong>并自动保存。
        </p>
        <textarea
          ref="instructionInput"
          v-model="instruction"
          class="instruction-input"
          rows="4"
          maxlength="4000"
          placeholder="输入润色要求，例如：让表达更专业简洁、修正错别字、增强段落逻辑，并补充面试常见追问。"
        ></textarea>
        <p v-if="!configured" class="config-warning">
          服务器尚未配置 Claude CLI 与 API Key，无法调用润色服务。
        </p>
        <div class="modal-actions">
          <button class="ghost" :disabled="running" @click="closeModal">取消</button>
          <button
            class="primary"
            :disabled="running || !configured || !instruction.trim()"
            @click="runPolish"
          >{{ running ? '润色中…' : '开始润色' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import { api } from '../utils/api'
import { htmlToMarkdown } from '../utils/htmlToMarkdown'
import { markdownTaskListPlugin } from '../utils/markdownTasks'

const props = defineProps({
  editor: { type: Object, required: true },
})
const emit = defineEmits(['applied'])

const open = ref(false)
const instruction = ref('')
const running = ref(false)
const configured = ref(true)
const message = ref('')
const messageIsError = ref(false)
const instructionInput = ref(null)
let messageTimer = null

const parser = new MarkdownIt({ html: false, linkify: true }).use(markdownTaskListPlugin)

const buttonTitle = computed(() => {
  if (running.value) return '正在润色整篇文档…'
  return 'AI 润色：调用 Claude 润色整篇文档'
})

function setMessage(text, { error = false, ttl = 2600 } = {}) {
  message.value = text
  messageIsError.value = error
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = null
  if (ttl > 0) {
    messageTimer = setTimeout(() => {
      message.value = ''
      messageIsError.value = false
      messageTimer = null
    }, ttl)
  }
}

function describePolishError(error) {
  const detail = String(error?.message || '')
  if (/超时/.test(detail)) return '润色超时，请缩短文档或稍后重试'
  if (/未配置/.test(detail)) return '服务器未配置 Claude CLI 与 API Key'
  if (/内容过长/.test(detail)) return '文档过长，请分段润色'
  return detail || 'AI 润色失败，请重试'
}

function closeModal() {
  if (running.value) return
  open.value = false
  instruction.value = ''
}

async function openModal() {
  if (running.value) return
  if (!configured.value) {
    setMessage('服务器未配置 Claude CLI 与 API Key', { error: true, ttl: 4000 })
    return
  }
  open.value = true
  await nextTick()
  instructionInput.value?.focus()
}

async function runPolish() {
  const editor = props.editor
  if (!editor || editor.isDestroyed || running.value) return
  const requirement = instruction.value.trim()
  if (!requirement || !configured.value) return

  running.value = true
  setMessage('润色中…可能需要 1～3 分钟', { ttl: 0 })
  try {
    const markdown = htmlToMarkdown(editor.getHTML())
    const data = await api.polishDocument(markdown, requirement)
    const polished = String(data?.markdown || '').trim()
    if (!polished) throw new Error('Claude 未返回有效内容，请重试')
    editor.commands.setContent(parser.render(polished))
    emit('applied')
    closeModal()
    setMessage('润色完成，正文已更新')
  } catch (error) {
    setMessage(describePolishError(error), { error: true, ttl: 5000 })
  } finally {
    running.value = false
  }
}

onMounted(async () => {
  try {
    const status = await api.getAiPolishStatus()
    configured.value = Boolean(status?.configured)
  } catch (error) {
    // 接口不可用时按未配置处理，点击按钮给出提示
    configured.value = false
  }
})

onBeforeUnmount(() => {
  if (messageTimer) clearTimeout(messageTimer)
})
</script>

<style scoped>
.ai-polish {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ai-polish-btn {
  width: auto;
  min-width: 92px;
  padding-inline: 8px;
  white-space: nowrap;
}
.ai-polish-btn.running {
  border-color: var(--primary);
  color: var(--primary);
  cursor: progress;
}
.ai-message {
  max-width: 176px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted, #666);
}
.ai-message.error {
  color: var(--danger);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  padding: 32px;
  border-radius: 0;
  width: 520px;
  max-width: 90vw;
  box-shadow: 8px 8px 0 var(--border);
  border: 2px solid var(--border);
}
.modal h3 {
  margin-bottom: 12px;
}
.modal-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 14px;
}
.instruction-input {
  width: 100%;
  min-height: 108px;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: 0;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
  background: var(--bg-gray);
  color: var(--text);
}
.instruction-input:focus {
  outline: none;
  background: #fff;
}
.config-warning {
  margin-top: 10px;
  font-size: 13px;
  color: var(--danger);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
@media (max-width: 640px) {
  .ai-message {
    max-width: 108px;
  }
}
</style>

<template>
  <div class="voice-input">
    <button
      type="button"
      class="icon-btn voice-btn"
      :class="{ recording, transcribing }"
      :disabled="transcribing"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      @click="toggle"
    >
      <svg v-if="recording" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="3" y="3" width="10" height="10" fill="currentColor" />
      </svg>
      <svg v-else viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M8 1.5A2.5 2.5 0 0 0 5.5 4v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <path
          d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <span v-if="message" class="voice-message" :class="{ error: messageIsError }">{{ message }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../utils/api'
import {
  VOICE_MAX_SECONDS,
  VOICE_SHORTCUT_LABEL,
  createVoiceRecorder,
  describeVoiceError,
  isVoiceShortcut,
} from '../utils/voiceInput'

const props = defineProps({
  editor: { type: Object, required: true }
})

const MIN_SECONDS = 0.4

const recording = ref(false)
const transcribing = ref(false)
const message = ref('')
const messageIsError = ref(false)
let messageTimer = null
let shortcutHold = false

const recorder = createVoiceRecorder({
  onAutoStop: (result) => submit(result)
})

const buttonTitle = computed(() => {
  if (recording.value) return `停止录音并转写（最长 ${VOICE_MAX_SECONDS} 秒）`
  if (transcribing.value) return '正在转写…'
  return `语音输入：点击开始，或按住 ${VOICE_SHORTCUT_LABEL} 说话`
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

function insertTranscript(text) {
  const editor = props.editor
  if (!editor || editor.isDestroyed) return false
  // 用 text 节点插入，避免转写结果里的 < > 被当成 HTML 解析
  return editor.chain().focus().insertContent({ type: 'text', text }).run()
}

async function submit(result) {
  if (!result) {
    setMessage('没有录到声音', { error: true })
    return
  }
  if (result.durationSeconds < MIN_SECONDS) {
    setMessage('录音太短，请再说一遍', { error: true })
    return
  }

  transcribing.value = true
  setMessage('识别中…', { ttl: 0 })
  try {
    const data = await api.transcribeAudio(result.wav)
    const text = String(data?.text || '').trim()
    if (!text) {
      setMessage('没听清，请再说一遍', { error: true })
      return
    }
    if (!insertTranscript(text)) {
      setMessage('插入失败，请重试', { error: true })
      return
    }
    setMessage(`已插入 ${text.length} 字`)
  } catch (error) {
    setMessage(describeVoiceError(error), { error: true, ttl: 4000 })
  } finally {
    transcribing.value = false
  }
}

async function start() {
  if (recording.value || transcribing.value) return
  try {
    await recorder.start()
    recording.value = true
    setMessage('录音中…', { ttl: 0 })
  } catch (error) {
    recording.value = false
    setMessage(describeVoiceError(error), { error: true, ttl: 4000 })
  }
}

async function stop() {
  if (!recording.value) return
  const result = recorder.stop()
  recording.value = false
  await submit(result)
}

function toggle() {
  if (recording.value) stop()
  else start()
}

function isFormField(target) {
  if (!target || typeof target.closest !== 'function') return false
  return Boolean(target.closest('input, textarea, select'))
}

function onKeyDown(event) {
  if (!isVoiceShortcut(event) || event.repeat) return
  if (isFormField(event.target)) return
  event.preventDefault()
  shortcutHold = true
  start()
}

function onKeyUp(event) {
  if (!isVoiceShortcut(event) || !shortcutHold) return
  shortcutHold = false
  event.preventDefault()
  stop()
}

function onWindowBlur() {
  if (!shortcutHold) return
  shortcutHold = false
  stop()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onWindowBlur)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onWindowBlur)
  recorder.cancel()
  if (messageTimer) clearTimeout(messageTimer)
})
</script>

<style scoped>
.voice-input {
  display: flex;
  align-items: center;
  gap: 6px;
}
.voice-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
}
.voice-btn.recording {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
  animation: voice-pulse 1.1s ease-in-out infinite;
}
.voice-btn.transcribing {
  border-color: var(--primary);
  color: var(--primary);
  cursor: progress;
}
.voice-message {
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted, #666);
}
.voice-message.error {
  color: var(--danger);
}
@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media (max-width: 640px) {
  .voice-message {
    max-width: 88px;
  }
}
</style>

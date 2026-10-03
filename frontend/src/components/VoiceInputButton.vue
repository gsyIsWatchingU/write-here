<template>
  <div class="voice-input">
    <button
      type="button"
      class="icon-btn voice-btn"
      :class="{ recording, transcribing }"
      :aria-busy="transcribing ? 'true' : 'false'"
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
    <div v-if="recording" class="voice-live">
      <span class="voice-meter" aria-hidden="true">
        <span class="voice-meter-fill" :style="{ width: meterWidth }" />
      </span>
      <span class="voice-live-text">{{ liveText }}</span>
    </div>
    <span v-else-if="message" class="voice-message" :class="{ error: messageIsError }">{{ message }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { api } from '../utils/api'
import {
  VOICE_MAX_SECONDS,
  createVoiceRecorder,
  describeVoiceError,
} from '../utils/voiceInput'

const props = defineProps({
  editor: { type: Object, required: true }
})

const MIN_SECONDS = 0.4

const recording = ref(false)
const transcribing = ref(false)
const message = ref('')
const messageIsError = ref(false)
const level = ref(0)
const elapsed = ref(0)
const pendingCount = ref(0)
const transcribedChars = ref(0)
let messageTimer = null
let ticker = null

// 转写按段串行发送：段是按说话顺序切出来的，串行能保证上屏顺序不乱
const queue = []
let draining = false

const recorder = createVoiceRecorder({
  onAutoStop: () => stop(),
  onLevel: (value) => { level.value = value },
  onSegment: (segment) => enqueue(segment),
})

const buttonTitle = computed(() => {
  if (recording.value) return `停止录音（最长 ${VOICE_MAX_SECONDS} 秒，边说边上屏）`
  if (transcribing.value) return '正在转写…'
  return '语音输入：点击开始录音，说话停顿即自动上屏'
})

const meterWidth = computed(() => `${Math.round(Math.max(0, Math.min(1, level.value)) * 100)}%`)

const liveText = computed(() => {
  const clock = formatClock(elapsed.value)
  if (pendingCount.value > 0) return `${clock} · 转写中 ${pendingCount.value}`
  if (transcribedChars.value) return `${clock} · 已上屏 ${transcribedChars.value} 字`
  return clock
})

function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

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

function enqueue(segment) {
  queue.push(segment)
  pendingCount.value = queue.length
  drain()
}

async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    const segment = queue.shift()
    pendingCount.value = queue.length + 1
    await transcribeSegment(segment)
  }
  draining = false
  pendingCount.value = 0
  if (!recording.value) {
    if (transcribedChars.value) setMessage(`已插入 ${transcribedChars.value} 字`)
    else setMessage('没听清，请再说一遍', { error: true })
  }
}

async function transcribeSegment(segment) {
  transcribing.value = true
  try {
    const data = await api.transcribeAudio(segment.wav)
    const text = String(data?.text || '').trim()
    if (!text) return
    if (!insertTranscript(text)) return
    transcribedChars.value += text.length
  } catch (error) {
    // 单段失败不打断后面的段，只提示一次
    setMessage(describeVoiceError(error), { error: true, ttl: 4000 })
  } finally {
    transcribing.value = false
  }
}

function startTicker() {
  stopTicker()
  ticker = setInterval(() => {
    elapsed.value = recorder.elapsedSeconds
  }, 100)
}

function stopTicker() {
  if (ticker) clearInterval(ticker)
  ticker = null
}

async function start() {
  if (recording.value) return
  transcribedChars.value = 0
  elapsed.value = 0
  level.value = 0
  message.value = ''
  try {
    await recorder.start()
    recording.value = true
    startTicker()
  } catch (error) {
    recording.value = false
    setMessage(describeVoiceError(error), { error: true, ttl: 4000 })
  }
}

async function stop() {
  if (!recording.value) return
  const result = recorder.stop()
  recording.value = false
  stopTicker()
  level.value = 0

  // 说得太短没触发切段时，用整段录音兜底一次
  if (result && recorder.segmentsEmitted === 0 && result.durationSeconds >= MIN_SECONDS) {
    enqueue({ wav: result.wav, durationSeconds: result.durationSeconds })
    return
  }
  if (queue.length || draining) return
  if (transcribedChars.value) setMessage(`已插入 ${transcribedChars.value} 字`)
  else setMessage(recorder.segmentsEmitted === 0 ? '没有录到声音' : '没听清，请再说一遍', {
    error: recorder.segmentsEmitted === 0,
  })
}

function toggle() {
  if (recording.value) stop()
  else start()
}

onBeforeUnmount(() => {
  recorder.cancel()
  stopTicker()
  queue.length = 0
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
}
.voice-live {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 电平条：让用户看得见麦克风有没有在收声 */
.voice-meter {
  display: block;
  width: 46px;
  height: 4px;
  border-radius: 2px;
  background: var(--border, #e3e3e3);
  overflow: hidden;
}
.voice-meter-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--danger);
  transition: width 80ms linear;
}
.voice-live-text,
.voice-message {
  max-width: 148px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted, #666);
  font-variant-numeric: tabular-nums;
}
.voice-message.error {
  color: var(--danger);
}
@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media (max-width: 640px) {
  .voice-live-text,
  .voice-message {
    max-width: 96px;
  }
  .voice-meter {
    width: 32px;
  }
}
</style>

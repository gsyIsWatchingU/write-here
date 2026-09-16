export const VOICE_SAMPLE_RATE = 16000
export const VOICE_MAX_SECONDS = 60
export const VOICE_SHORTCUT_LABEL = '双击 Ctrl'
export const VOICE_HOLD_LABEL = '按住 F2'
export const CTRL_TAP_MS = 220
export const CTRL_DOUBLE_MS = 420

function isControlKey(event) {
  return event?.key === 'Control' || event?.code === 'ControlLeft' || event?.code === 'ControlRight'
}

// 按住说话的入口：单独的 F2，不带任何修饰键。
export function isVoiceHoldShortcut(event) {
  if (!event) return false
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false
  return event.key === 'F2' || event.code === 'F2'
}

// 双击 Ctrl 检测：把「按一下 Ctrl」和「Ctrl+其它键」「按住 Ctrl 拖动」区分开。
export function createShortcutDetector(options = {}) {
  const {
    now = Date.now,
    tapMs = CTRL_TAP_MS,
    doubleMs = CTRL_DOUBLE_MS,
  } = options

  let pressingSince = 0
  let lastTapAt = 0

  return {
    keydown(event) {
      if (!isControlKey(event)) {
        // 用户按了别的键（例如 Ctrl+C），之前那一下轻点不再当作双击的一半
        pressingSince = 0
        lastTapAt = 0
        return false
      }
      if (event.repeat) return false
      if (event.altKey || event.shiftKey || event.metaKey) {
        pressingSince = 0
        return false
      }
      pressingSince = now()
      return false
    },
    keyup(event) {
      if (!isControlKey(event)) return false
      if (!pressingSince) return false
      const held = now() - pressingSince
      pressingSince = 0
      if (held > tapMs) {
        lastTapAt = 0
        return false
      }
      const tappedAt = now()
      if (lastTapAt && tappedAt - lastTapAt <= doubleMs) {
        lastTapAt = 0
        return true
      }
      lastTapAt = tappedAt
      return false
    },
    reset() {
      pressingSince = 0
      lastTapAt = 0
    },
  }
}

export function floatToPcm16(samples) {
  const output = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] || 0))
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return output
}

export function downsampleTo16k(samples, inputRate) {
  if (!inputRate || inputRate === VOICE_SAMPLE_RATE) {
    return samples instanceof Float32Array ? samples : Float32Array.from(samples)
  }
  const ratio = inputRate / VOICE_SAMPLE_RATE
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = position - left
    output[i] = (samples[left] ?? 0) * (1 - weight) + (samples[right] ?? 0) * weight
  }
  return output
}

export function pcm16ToWav(pcm, sampleRate = VOICE_SAMPLE_RATE) {
  const dataBytes = pcm.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i], true)
  return new Uint8Array(buffer)
}

export function wavDurationSeconds(wav, sampleRate = VOICE_SAMPLE_RATE) {
  if (!wav || wav.byteLength <= 44) return 0
  return Math.max(0, (wav.byteLength - 44) / 2 / sampleRate)
}

export function describeVoiceError(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限被拒绝，请在浏览器里允许后重试'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没有检测到可用的麦克风'
  if (name === 'NotReadableError' || name === 'TrackStartError') return '麦克风被其它程序占用'
  if (name === 'AbortError') return '语音输入已取消'
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  return '语音输入失败，请重试'
}

function mergeChunks(chunks, totalLength) {
  const merged = new Float32Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

export function createVoiceRecorder(options = {}) {
  const {
    AudioContextCtor = typeof window === 'undefined' ? null : (window.AudioContext || window.webkitAudioContext),
    mediaDevices = typeof navigator === 'undefined' ? null : navigator.mediaDevices,
    sampleRate = VOICE_SAMPLE_RATE,
    bufferSize = 4096,
    maxSeconds = VOICE_MAX_SECONDS,
    onAutoStop = null,
    now = Date.now,
  } = options

  let stream = null
  let context = null
  let processor = null
  let source = null
  let timer = null
  let startedAt = 0
  let chunks = []

  function reset() {
    if (timer) clearTimeout(timer)
    timer = null
    stream = null
    context = null
    processor = null
    source = null
    chunks = []
    startedAt = 0
  }

  function build() {
    if (!context) return null
    const capturedRate = context.sampleRate || sampleRate
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (total === 0) return null
    const merged = mergeChunks(chunks, total)
    const pcm = floatToPcm16(downsampleTo16k(merged, capturedRate))
    const wav = pcm16ToWav(pcm, sampleRate)
    const durationSeconds = pcm.length / sampleRate
    return { wav, durationSeconds, elapsedSeconds: Math.max(0, (now() - startedAt) / 1000) }
  }

  function teardown() {
    if (processor) {
      processor.onaudioprocess = null
      try { processor.disconnect() } catch (error) { /* 已断开 */ }
    }
    if (source) {
      try { source.disconnect() } catch (error) { /* 已断开 */ }
    }
    if (stream) stream.getTracks().forEach((track) => track.stop())
    const closing = context
    if (closing) {
      try {
        const result = closing.close()
        if (result && typeof result.catch === 'function') result.catch(() => {})
      } catch (error) { /* 已关闭 */ }
    }
  }

  const recorder = {
    get recording() {
      return Boolean(context)
    },
    async start() {
      if (context) return
      if (!mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持录音，请使用桌面版 Chrome 或 Edge')
      if (!AudioContextCtor) throw new Error('当前浏览器不支持 Web Audio 录音')

      stream = await mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      try {
        context = new AudioContextCtor({ sampleRate })
      } catch (error) {
        context = new AudioContextCtor()
      }
      startedAt = now()
      chunks = []
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(bufferSize, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!chunks) return
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(context.destination)
      if (typeof context.resume === 'function' && context.state === 'suspended') {
        try { await context.resume() } catch (error) { /* 忽略恢复失败 */ }
      }
      timer = setTimeout(() => {
        const result = recorder.stop()
        if (result && onAutoStop) onAutoStop(result)
      }, maxSeconds * 1000)
    },
    stop() {
      if (!context) return null
      const result = build()
      teardown()
      reset()
      return result
    },
    cancel() {
      if (!context) return
      teardown()
      reset()
    },
  }

  return recorder
}

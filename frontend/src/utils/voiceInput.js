export const VOICE_SAMPLE_RATE = 16000
export const VOICE_MAX_SECONDS = 60

// 流式分段参数：说话停顿时把已经说过的部分先送出去转写，不必等点停止。
export const VOICE_SEGMENT = {
  // 静音多久算一句话说完
  silenceSeconds: 0.7,
  // 一段里累计有声多久才值得送转写（过滤咳嗽、键盘声）
  minSeconds: 0.45,
  // 一口气说到这么长就强制切一段，避免单段太长拖慢返回
  maxSeconds: 12,
  // 切段时保留的尾部余量，避免把最后一个字切掉
  tailPadSeconds: 0.16,
  // 说话前先补上的缓冲，避免起头的字被吃掉
  preRollSeconds: 0.3,
  // 帧能量阈值（RMS），高于它算有声
  speechThreshold: 0.018,
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

export function frameRms(samples) {
  if (!samples || samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] || 0
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

// 把 RMS 压到 0～1，方便画电平条：正常说话大约在 0.3～0.8
export function levelOf(rms) {
  if (!rms || rms <= 0) return 0
  return Math.min(1, Math.sqrt(rms / 0.25))
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
    onLevel = null,
    onSegment = null,
    segment: segmentOverrides = {},
    now = Date.now,
  } = options

  const segmentConfig = { ...VOICE_SEGMENT, ...segmentOverrides }

  let stream = null
  let context = null
  let processor = null
  let source = null
  let timer = null
  let startedAt = 0
  let chunks = []

  // 流式分段状态
  let capturedRate = sampleRate
  let frameSeconds = 0
  let preRoll = []
  let preRollSamples = 0
  let segmentFrames = []
  let segmentSamples = 0
  let segmentSpeechSeconds = 0
  let segmentSilenceSeconds = 0
  let lastSpeechSamples = 0
  let segmentOpen = false
  let segmentSeq = 0
  let sessionSegments = 0

  function reset() {
    if (timer) clearTimeout(timer)
    timer = null
    stream = null
    context = null
    processor = null
    source = null
    chunks = []
    startedAt = 0
    resetSegment()
  }

  function resetSegment() {
    preRoll = []
    preRollSamples = 0
    segmentFrames = []
    segmentSamples = 0
    segmentSpeechSeconds = 0
    segmentSilenceSeconds = 0
    lastSpeechSamples = 0
    segmentOpen = false
  }

  function build() {
    if (!context) return null
    const rate = context.sampleRate || sampleRate
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (total === 0) return null
    const merged = mergeChunks(chunks, total)
    const pcm = floatToPcm16(downsampleTo16k(merged, rate))
    const wav = pcm16ToWav(pcm, sampleRate)
    const durationSeconds = pcm.length / sampleRate
    return { wav, durationSeconds, elapsedSeconds: Math.max(0, (now() - startedAt) / 1000) }
  }

  // 把当前累积的一段裁到「最后一个有声帧 + 尾部余量」，避免把长静音也喂给转写服务
  function trimSegment() {
    const keep = Math.min(segmentSamples, lastSpeechSamples + Math.round(segmentConfig.tailPadSeconds * capturedRate))
    const kept = []
    let taken = 0
    for (const frame of segmentFrames) {
      if (taken >= keep) break
      const slice = Math.min(frame.length, keep - taken)
      kept.push(slice === frame.length ? frame : frame.subarray(0, slice))
      taken += slice
    }
    return { kept, taken }
  }

  function flushSegment() {
    if (!segmentOpen) return null
    const speechSeconds = segmentSpeechSeconds
    const { kept, taken } = trimSegment()
    resetSegment()
    if (!onSegment || speechSeconds < segmentConfig.minSeconds || taken === 0) return null

    const merged = mergeChunks(kept, taken)
    const pcm = floatToPcm16(downsampleTo16k(merged, capturedRate))
    const wav = pcm16ToWav(pcm, sampleRate)
    const durationSeconds = pcm.length / sampleRate
    if (durationSeconds < 0.2) return null

    segmentSeq += 1
    sessionSegments += 1
    const payload = { wav, durationSeconds, seq: segmentSeq }
    onSegment(payload)
    return payload
  }

  function handleFrame(frame) {
    chunks.push(frame)
    const rms = frameRms(frame)
    if (onLevel) onLevel(levelOf(rms))
    if (!onSegment) return

    const speaking = rms >= segmentConfig.speechThreshold
    if (speaking && !segmentOpen) {
      segmentOpen = true
      // 开段时带上说话前的缓冲，避免起头的字被吃掉
      segmentFrames = preRoll.slice()
      segmentSamples = preRollSamples
      segmentSpeechSeconds = 0
      segmentSilenceSeconds = 0
      lastSpeechSamples = segmentSamples
    }

    const preRollMax = Math.max(1, Math.ceil(segmentConfig.preRollSeconds * capturedRate))
    preRoll.push(frame)
    preRollSamples += frame.length
    while (preRoll.length > 1 && preRollSamples - preRoll[0].length >= preRollMax) {
      preRollSamples -= preRoll.shift().length
    }

    if (!segmentOpen) return

    segmentFrames.push(frame)
    segmentSamples += frame.length
    if (speaking) {
      segmentSpeechSeconds += frameSeconds
      segmentSilenceSeconds = 0
      lastSpeechSamples = segmentSamples
    } else {
      segmentSilenceSeconds += frameSeconds
    }

    const tooLong = segmentSamples / capturedRate >= segmentConfig.maxSeconds
    if (segmentSilenceSeconds >= segmentConfig.silenceSeconds || tooLong) flushSegment()
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
    // 本次录音已经切出去几段，用来判断要不要拿整段音频兜底
    get segmentsEmitted() {
      return sessionSegments
    },
    get elapsedSeconds() {
      return startedAt ? Math.max(0, (now() - startedAt) / 1000) : 0
    },
    flush() {
      return flushSegment()
    },
    async start() {
      if (context) return
      sessionSegments = 0
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
      capturedRate = context.sampleRate || sampleRate
      frameSeconds = bufferSize / capturedRate
      startedAt = now()
      chunks = []
      resetSegment()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(bufferSize, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!chunks) return
        handleFrame(new Float32Array(event.inputBuffer.getChannelData(0)))
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
      flushSegment()
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

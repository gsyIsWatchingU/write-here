import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VOICE_MAX_SECONDS,
  VOICE_SAMPLE_RATE,
  createVoiceRecorder,
  describeVoiceError,
  downsampleTo16k,
  floatToPcm16,
  frameRms,
  levelOf,
  pcm16ToWav,
  wavDurationSeconds,
} from './voiceInput.js'

function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

test('pcm16ToWav 输出 16 kHz 单声道 PCM 头，数据长度与采样一致', () => {
  const pcm = new Int16Array([0, 32767, -32768, 100])
  const wav = pcm16ToWav(pcm)

  assert.equal(wav.byteLength, 44 + pcm.length * 2)
  assert.equal(readAscii(wav, 0, 4), 'RIFF')
  assert.equal(readAscii(wav, 8, 4), 'WAVE')
  assert.equal(readAscii(wav, 12, 4), 'fmt ')
  assert.equal(readAscii(wav, 36, 4), 'data')

  const view = new DataView(wav.buffer)
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), VOICE_SAMPLE_RATE)
  assert.equal(view.getUint32(28, true), VOICE_SAMPLE_RATE * 2)
  assert.equal(view.getUint16(32, true), 2)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(view.getUint32(40, true), pcm.length * 2)
  assert.equal(view.getInt16(44 + 2 * 2, true), -32768)
  assert.equal(Number(wavDurationSeconds(wav).toFixed(4)), Number((4 / VOICE_SAMPLE_RATE).toFixed(4)))
})

test('floatToPcm16 裁剪越界值并转换为 16 位整数', () => {
  const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
  assert.deepEqual(Array.from(pcm), [0, 32767, -32768, 32767, -32768, 16383])
})

test('downsampleTo16k 按比例降采样，同采样率时原样返回', () => {
  const source = new Float32Array(48000).fill(0.5)
  const downsampled = downsampleTo16k(source, 48000)
  assert.equal(downsampled.length, 16000)
  assert.ok(Array.from(downsampled).every((value) => Math.abs(value - 0.5) < 1e-6))

  const unchanged = downsampleTo16k(source, VOICE_SAMPLE_RATE)
  assert.equal(unchanged, source)
})

test('describeVoiceError 把浏览器错误码翻译为中文提示', () => {
  assert.match(describeVoiceError({ name: 'NotAllowedError' }), /权限/)
  assert.match(describeVoiceError({ name: 'NotFoundError' }), /麦克风/)
  assert.match(describeVoiceError({ name: 'NotReadableError' }), /占用/)
  assert.equal(describeVoiceError({ message: ' 录音太短 ' }), '录音太短')
  assert.equal(describeVoiceError({}), '语音输入失败，请重试')
})

function fakeEnvironment({ sampleRate = VOICE_SAMPLE_RATE, frames = [] } = {}) {
  const tracks = []
  const processor = { onaudioprocess: null, connect() {}, disconnect() {} }
  const context = {
    sampleRate,
    state: 'suspended',
    destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => processor,
    resume: async () => { context.state = 'running' },
    close: () => { context.closed = true },
  }
  const mediaDevices = {
    getUserMedia: async () => {
      const track = { kind: 'audio', stopped: false, stop() { this.stopped = true } }
      tracks.push(track)
      return { getTracks: () => tracks }
    },
  }

  return {
    tracks,
    processor,
    context,
    feed: (samples) => {
      if (!processor.onaudioprocess) return
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } })
    },
    recorderOptions: {
      AudioContextCtor: function FakeAudioContext() {
        return context
      },
      mediaDevices,
      maxSeconds: VOICE_MAX_SECONDS,
    },
    frames,
  }
}

test('recorder 采集音频后停止，产出 WAV 并释放设备', async () => {
  const env = fakeEnvironment()
  const recorder = createVoiceRecorder(env.recorderOptions)

  await recorder.start()
  assert.equal(recorder.recording, true)
  env.feed(new Float32Array([0.2, -0.2, 0.4, -0.4]))
  env.feed(new Float32Array([0.6, 0.6, 0.6, 0.6]))

  const result = recorder.stop()
  assert.ok(result)
  assert.equal(result.wav.byteLength, 44 + 8 * 2)
  assert.equal(result.durationSeconds, 8 / VOICE_SAMPLE_RATE)
  assert.equal(env.context.closed, true)
  assert.ok(env.tracks.every((track) => track.stopped))
  assert.equal(recorder.recording, false)
  assert.equal(recorder.stop(), null)
})

test('recorder 按设备采样率降采样到 16 kHz', async () => {
  const env = fakeEnvironment({ sampleRate: 48000 })
  const recorder = createVoiceRecorder(env.recorderOptions)

  await recorder.start()
  env.feed(new Float32Array(48000).fill(0.5))
  const result = recorder.stop()

  assert.ok(result)
  assert.equal(result.wav.byteLength, 44 + 16000 * 2)
  assert.equal(result.durationSeconds, 1)
})

test('recorder 到时自动停止并回调，取消录音不产出音频', async () => {
  const autoStops = []
  const env = fakeEnvironment()
  const recorder = createVoiceRecorder({
    ...env.recorderOptions,
    maxSeconds: 0.02,
    onAutoStop: (result) => autoStops.push(result),
  })

  await recorder.start()
  env.feed(new Float32Array([0.1, 0.2]))
  await new Promise((resolve) => setTimeout(resolve, 60))

  assert.equal(autoStops.length, 1)
  assert.equal(autoStops[0].wav.byteLength, 44 + 2 * 2)
  assert.equal(recorder.recording, false)
  assert.ok(env.tracks.every((track) => track.stopped))

  await recorder.start()
  env.feed(new Float32Array([0.3, 0.3]))
  recorder.cancel()
  assert.equal(recorder.recording, false)
  assert.equal(recorder.stop(), null)
})

test('recorder 在没有录音设备时给出可读错误', async () => {
  const recorder = createVoiceRecorder({ AudioContextCtor: null, mediaDevices: null })
  await assert.rejects(() => recorder.start(), /不支持录音/)
})

function loudFrame(length = 4096) {
  const frame = new Float32Array(length)
  for (let i = 0; i < length; i += 1) frame[i] = Math.sin(i / 8) * 0.4
  return frame
}

function silentFrame(length = 4096) {
  return new Float32Array(length)
}

test('frameRms 与 levelOf 把音量映射成 0～1 的电平', () => {
  assert.equal(frameRms(new Float32Array(4)), 0)
  assert.equal(levelOf(0), 0)
  assert.ok(Math.abs(frameRms(new Float32Array(16).fill(0.5)) - 0.5) < 1e-6)
  assert.equal(levelOf(0.25), 1)
  assert.ok(levelOf(0.02) > 0 && levelOf(0.02) < 1)
  assert.equal(levelOf(4), 1)
})

test('说话停顿后自动切出一段，尾部静音不进入音频', async () => {
  const segments = []
  const levels = []
  const env = fakeEnvironment()
  const recorder = createVoiceRecorder({
    ...env.recorderOptions,
    onSegment: (segment) => segments.push(segment),
    onLevel: (value) => levels.push(value),
  })

  await recorder.start()
  for (let i = 0; i < 3; i += 1) env.feed(loudFrame())
  for (let i = 0; i < 5; i += 1) env.feed(silentFrame())

  assert.equal(segments.length, 1)
  // 3 帧有声 0.77s + 0.16s 尾部余量，远小于喂进去的 8 帧（2.05s）
  assert.ok(segments[0].durationSeconds > 0.7, `实际 ${segments[0].durationSeconds}`)
  assert.ok(segments[0].durationSeconds < 1.1, `实际 ${segments[0].durationSeconds}`)
  assert.equal(segments[0].seq, 1)
  assert.ok(levels.length >= 8)
  assert.equal(levels[0], 1)
  assert.equal(levels[levels.length - 1], 0)
  assert.equal(recorder.segmentsEmitted, 1)

  recorder.stop()
})

test('过短的响声不切段，一口气说太长会强制切段', async () => {
  const short = []
  const envShort = fakeEnvironment()
  const shortRecorder = createVoiceRecorder({
    ...envShort.recorderOptions,
    onSegment: (segment) => short.push(segment),
  })
  await shortRecorder.start()
  envShort.feed(loudFrame())
  for (let i = 0; i < 5; i += 1) envShort.feed(silentFrame())
  assert.equal(short.length, 0)
  assert.equal(shortRecorder.segmentsEmitted, 0)
  shortRecorder.stop()

  const forced = []
  const envLong = fakeEnvironment()
  const longRecorder = createVoiceRecorder({
    ...envLong.recorderOptions,
    segment: { maxSeconds: 0.6 },
    onSegment: (segment) => forced.push(segment),
  })
  await longRecorder.start()
  for (let i = 0; i < 3; i += 1) envLong.feed(loudFrame())
  assert.equal(forced.length, 1)
  assert.ok(forced[0].durationSeconds > 0.7)
  longRecorder.stop()
})

test('停止录音会补上还没切出去的尾部', async () => {
  const segments = []
  const env = fakeEnvironment()
  const recorder = createVoiceRecorder({
    ...env.recorderOptions,
    onSegment: (segment) => segments.push(segment),
  })

  await recorder.start()
  for (let i = 0; i < 3; i += 1) env.feed(loudFrame())
  const result = recorder.stop()

  assert.equal(segments.length, 1)
  assert.ok(result)
  assert.equal(recorder.segmentsEmitted, 1)
  assert.equal(recorder.flush(), null)
  assert.equal(recorder.elapsedSeconds, 0)
})

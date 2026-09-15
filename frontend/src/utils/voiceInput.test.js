import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VOICE_MAX_SECONDS,
  VOICE_SAMPLE_RATE,
  createVoiceRecorder,
  describeVoiceError,
  downsampleTo16k,
  floatToPcm16,
  isVoiceShortcut,
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

test('isVoiceShortcut 只认 Ctrl+Alt+M，并忽略带其它修饰键的组合', () => {
  assert.equal(isVoiceShortcut({ ctrlKey: true, altKey: true, code: 'KeyM' }), true)
  assert.equal(isVoiceShortcut({ ctrlKey: true, altKey: true, code: 'KeyN' }), false)
  assert.equal(isVoiceShortcut({ ctrlKey: true, code: 'KeyM' }), false)
  assert.equal(isVoiceShortcut({ altKey: true, code: 'KeyM' }), false)
  assert.equal(isVoiceShortcut({ ctrlKey: true, altKey: true, metaKey: true, code: 'KeyM' }), false)
  assert.equal(isVoiceShortcut({ ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyM' }), false)
  assert.equal(isVoiceShortcut({ ctrlKey: true, altKey: true, key: 'm' }), true)
  assert.equal(isVoiceShortcut(null), false)
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

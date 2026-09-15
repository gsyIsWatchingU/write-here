const express = require('express');
const { authenticateSession } = require('./problems');

const DEFAULT_ASR_URL = 'http://127.0.0.1:8001';
const DEFAULT_ASR_MODEL = 'qwen3-asr-1.7b';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_SECONDS = 240;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

class AsrError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function asrConfig(env = process.env) {
    return {
        url: String(env.ASR_URL || DEFAULT_ASR_URL).replace(/\/+$/, ''),
        model: String(env.ASR_MODEL || DEFAULT_ASR_MODEL).trim() || DEFAULT_ASR_MODEL,
        apiKey: String(env.ASR_API_KEY || '').trim(),
        timeoutMs: Number(env.ASR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
        maxSeconds: Number(env.ASR_MAX_SECONDS) || DEFAULT_MAX_SECONDS,
    };
}

// 只接受浏览器端直接生成的 PCM WAV：不依赖 ffmpeg，也不把任意格式喂给推理服务。
function readWavInfo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
    if (buffer.toString('latin1', 0, 4) !== 'RIFF') return null;
    if (buffer.toString('latin1', 8, 12) !== 'WAVE') return null;

    let offset = 12;
    let fmt = null;
    let dataBytes = 0;
    while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('latin1', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (body + chunkSize > buffer.length) return null;
        if (chunkId === 'fmt ' && chunkSize >= 16) {
            fmt = {
                audioFormat: buffer.readUInt16LE(body),
                channels: buffer.readUInt16LE(body + 2),
                sampleRate: buffer.readUInt32LE(body + 4),
                bitsPerSample: buffer.readUInt16LE(body + 14),
            };
        } else if (chunkId === 'data') {
            dataBytes = chunkSize;
        }
        offset = body + chunkSize + (chunkSize % 2);
    }

    if (!fmt || !dataBytes) return null;
    if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) return null;
    const bytesPerSecond = fmt.sampleRate * fmt.channels * 2;
    if (!bytesPerSecond) return null;
    return {
        channels: fmt.channels,
        sampleRate: fmt.sampleRate,
        durationSeconds: dataBytes / bytesPerSecond,
    };
}

function upstreamBody(wav, model, BlobCtor = globalThis.Blob, FormDataCtor = globalThis.FormData) {
    const form = new FormDataCtor();
    form.append('file', new BlobCtor([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('response_format', 'json');
    return form;
}

async function transcribeWav({ wav, config = asrConfig(), fetchImpl = globalThis.fetch, now = Date.now }) {
    const info = readWavInfo(wav);
    if (!info) throw new AsrError(400, '只支持 16 位 PCM WAV 音频');
    if (info.channels !== 1) throw new AsrError(400, '只支持单声道音频');
    if (info.sampleRate < 8000 || info.sampleRate > 48000) throw new AsrError(400, '采样率不在 8k～48k 范围内');
    if (info.durationSeconds <= 0.05) throw new AsrError(400, '录音太短，请再说一遍');
    if (info.durationSeconds > config.maxSeconds) {
        throw new AsrError(413, `录音超过 ${config.maxSeconds} 秒上限`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = now();
    let response;
    try {
        response = await fetchImpl(`${config.url}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
            body: upstreamBody(wav, config.model),
            signal: controller.signal,
        });
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `转写超时（>${config.timeoutMs / 1000}s）`
            : 'GPU 转写服务不可用，请稍后重试';
        throw new AsrError(502, message);
    } finally {
        clearTimeout(timer);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }
    if (!response.ok) {
        const detail = payload?.error?.message || payload?.message;
        throw new AsrError(502, detail ? `转写服务返回错误：${detail}` : `转写服务返回 ${response.status}`);
    }

    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    return { text, durationSeconds: Number(info.durationSeconds.toFixed(2)), elapsedMs: now() - startedAt };
}

function createAsrRouter({ db, config = asrConfig(), fetchImpl = globalThis.fetch }) {
    const router = express.Router();

    router.post(
        '/asr/transcribe',
        express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_UPLOAD_BYTES }),
        async (req, res) => {
            const user = await authenticateSession(db, req);
            if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });

            const wav = Buffer.isBuffer(req.body) ? req.body : null;
            if (!wav || wav.length === 0) return res.status(400).json({ error: '缺少音频数据' });

            try {
                const result = await transcribeWav({ wav, config, fetchImpl });
                res.json(result);
            } catch (error) {
                const status = error instanceof AsrError ? error.status : 500;
                if (status >= 500) console.error('语音转写失败:', error.message);
                res.status(status).json({ error: error.message || '语音转写失败' });
            }
        }
    );

    return router;
}

module.exports = { AsrError, asrConfig, createAsrRouter, readWavInfo, transcribeWav };

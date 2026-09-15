const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { AsrError, asrConfig, createAsrRouter, readWavInfo, transcribeWav } = require('./asr');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function makeWav(seconds, { sampleRate = 16000, channels = 1 } = {}) {
    const dataBytes = Math.floor(seconds * sampleRate * channels * 2);
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write('RIFF', 0, 'latin1');
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write('WAVE', 8, 'latin1');
    buffer.write('fmt ', 12, 'latin1');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * 2, 28);
    buffer.writeUInt16LE(channels * 2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'latin1');
    buffer.writeUInt32LE(dataBytes, 40);
    return buffer;
}

async function startServer({ fetchImpl, config } = {}) {
    const db = new sqlite3.Database(':memory:');
    await exec(db, `
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            displayName TEXT,
            email TEXT,
            ssoSubject TEXT,
            isAdmin INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE sessions (
            token TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            expiresAt DATETIME NOT NULL
        );
        INSERT INTO users (id, username) VALUES (1, 'tester');
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('good-token', 1, datetime('now', '+1 day'));
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('old-token', 1, datetime('now', '-1 day'));
    `);

    const app = express();
    app.use(createAsrRouter({ db, fetchImpl, config }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        server,
        db,
        base: `http://127.0.0.1:${server.address().port}`,
        close: async () => {
            await new Promise((resolve) => server.close(resolve));
            await new Promise((resolve) => db.close(resolve));
        },
    };
}

function postAudio(base, buffer, { token = 'good-token', type = 'audio/wav' } = {}) {
    return fetch(`${base}/asr/transcribe`, {
        method: 'POST',
        headers: {
            'content-type': type,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: buffer,
    });
}

test('readWavInfo 解析 16 位 PCM WAV，并拒绝非 PCM、立体声与截断文件', () => {
    const info = readWavInfo(makeWav(1.5));
    assert.equal(info.channels, 1);
    assert.equal(info.sampleRate, 16000);
    assert.equal(Number(info.durationSeconds.toFixed(2)), 1.5);

    assert.equal(readWavInfo(Buffer.from('not-a-wav')), null);
    assert.equal(readWavInfo(makeWav(1).subarray(0, 30)), null);
    assert.equal(readWavInfo(makeWav(1, { channels: 2 })).channels, 2);
});

test('asrConfig 读取环境变量并保留默认值', () => {
    const defaults = asrConfig({});
    assert.equal(defaults.url, 'http://127.0.0.1:8001');
    assert.equal(defaults.model, 'qwen3-asr-1.7b');

    const custom = asrConfig({
        ASR_URL: 'http://127.0.0.1:8100/',
        ASR_MODEL: 'qwen3-asr',
        ASR_API_KEY: 'secret',
        ASR_MAX_SECONDS: '30',
    });
    assert.equal(custom.url, 'http://127.0.0.1:8100');
    assert.equal(custom.apiKey, 'secret');
    assert.equal(custom.maxSeconds, 30);
});

test('transcribeWav 按 OpenAI 兼容格式转发音频并返回文本', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ text: ' 你好，世界 ' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    const result = await transcribeWav({
        wav: makeWav(2),
        config: { ...asrConfig({ ASR_URL: 'http://asr.test', ASR_MODEL: 'asr-model', ASR_API_KEY: 'key-1' }), maxSeconds: 10 },
        fetchImpl,
    });

    assert.equal(result.text, '你好，世界');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://asr.test/v1/audio/transcriptions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer key-1');

    const form = calls[0].options.body;
    assert.equal(form.get('model'), 'asr-model');
    assert.equal(form.get('response_format'), 'json');
    const file = form.get('file');
    assert.equal(file.name, 'speech.wav');
    assert.equal(file.type, 'audio/wav');
});

test('transcribeWav 拒绝过短、过长、立体声和非法格式', async () => {
    const config = { ...asrConfig({}), maxSeconds: 5 };
    const ok = async () => new Response(JSON.stringify({ text: '' }), { status: 200 });

    await assert.rejects(() => transcribeWav({ wav: Buffer.from('x'), config, fetchImpl: ok }), (error) => {
        assert.ok(error instanceof AsrError);
        assert.equal(error.status, 400);
        return true;
    });

    await assert.rejects(() => transcribeWav({ wav: makeWav(0.01), config, fetchImpl: ok }), { status: 400 });
    await assert.rejects(() => transcribeWav({ wav: makeWav(9), config, fetchImpl: ok }), { status: 413 });
    await assert.rejects(() => transcribeWav({ wav: makeWav(2, { channels: 2 }), config, fetchImpl: ok }), { status: 400 });
});

test('transcribeWav 上游失败与超时都返回 502', async () => {
    const config = { ...asrConfig({ ASR_TIMEOUT_MS: '10' }) };

    await assert.rejects(
        () => transcribeWav({
            wav: makeWav(1),
            config,
            fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'model busy' } }), { status: 500 }),
        }),
        (error) => {
            assert.equal(error.status, 502);
            assert.match(error.message, /model busy/);
            return true;
        }
    );

    await assert.rejects(
        () => transcribeWav({
            wav: makeWav(1),
            config,
            fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            }),
        }),
        (error) => {
            assert.equal(error.status, 502);
            assert.match(error.message, /超时/);
            return true;
        }
    );
});

test('转写接口要求登录会话，并区分鉴权与音频错误', async (t) => {
    const ctx = await startServer({
        fetchImpl: async () => new Response(JSON.stringify({ text: '登录后才听到' }), { status: 200 }),
    });
    t.after(ctx.close);

    const anonymous = await postAudio(ctx.base, makeWav(1), { token: null });
    assert.equal(anonymous.status, 401);
    assert.match((await anonymous.json()).error, /登录/);

    const expired = await postAudio(ctx.base, makeWav(1), { token: 'old-token' });
    assert.equal(expired.status, 401);

    const invalid = await postAudio(ctx.base, Buffer.from('not-a-wav'));
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /PCM WAV/);

    const ok = await postAudio(ctx.base, makeWav(1));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).text, '登录后才听到');
});

test('转写接口把 GPU 服务故障转成 502', async (t) => {
    const ctx = await startServer({
        fetchImpl: async () => new Response('upstream down', { status: 502 }),
    });
    t.after(ctx.close);

    const failed = await postAudio(ctx.base, makeWav(1));
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /转写/);
});

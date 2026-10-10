const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { createUserSettingsRouter, maskApiKey } = require('./userSettings');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}

async function startServer() {
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
        CREATE TABLE user_settings (
            userId INTEGER PRIMARY KEY,
            aiBaseUrl TEXT NOT NULL DEFAULT '',
            aiApiKey TEXT NOT NULL DEFAULT '',
            aiModel TEXT NOT NULL DEFAULT '',
            aiProtocol TEXT NOT NULL DEFAULT 'anthropic',
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username) VALUES (1, 'tester@example.com');
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('good-token', 1, datetime('now', '+1 day'));
        INSERT INTO sessions (token, userId, expiresAt) VALUES ('old-token', 1, datetime('now', '-1 day'));
    `);

    const app = express();
    app.use(express.json());
    app.use(createUserSettingsRouter({ db }));
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

function requestJson(base, path, { method = 'GET', body, token = 'good-token' } = {}) {
    return fetch(`${base}${path}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

test('maskApiKey 掩码规则', () => {
    assert.equal(maskApiKey(''), '');
    assert.equal(maskApiKey('sk'), 'sk****');
    assert.equal(maskApiKey('abcdefgh'), 'ab****');
    assert.equal(maskApiKey('sk-very-long-secret-key'), 'sk-v****ey');
    assert.ok(!maskApiKey('sk-very-long-secret-key').includes('secret'));
});

test('设置接口要求登录', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const anon = await requestJson(ctx.base, '/settings', { token: null });
    assert.equal(anon.status, 401);

    const expired = await requestJson(ctx.base, '/settings', { token: 'old-token' });
    assert.equal(expired.status, 401);

    const anonPut = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { nickname: 'x' }, token: null });
    assert.equal(anonPut.status, 401);
});

test('GET /settings 返回昵称与空 AI 配置，不泄露 Key', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const res = await requestJson(ctx.base, '/settings');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.nickname, 'tester@example.com');
    assert.equal(body.ai.baseUrl, '');
    assert.equal(body.ai.model, '');
    assert.equal(body.ai.hasApiKey, false);
    assert.equal(body.ai.apiKeyHint, '');
});

test('PUT /settings 更新昵称并持久化到 users.displayName', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const res = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { nickname: ' 郭书羽 ' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.nickname, '郭书羽');

    const row = await get(ctx.db, 'SELECT displayName FROM users WHERE id = 1');
    assert.equal(row.displayName, '郭书羽');
});

test('PUT /settings 校验昵称非空与长度', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const empty = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { nickname: '   ' } });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /昵称/);

    const long = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { nickname: 'x'.repeat(50) } });
    assert.equal(long.status, 200);
    const row = await get(ctx.db, 'SELECT displayName FROM users WHERE id = 1');
    assert.equal(row.displayName, 'x'.repeat(40));
});

test('PUT /settings 保存 AI 配置，GET 只回掩码', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const res = await requestJson(ctx.base, '/settings', {
        method: 'PUT',
        body: { ai: { baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-secret-123456', model: 'claude-sonnet-4-5' } },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ai.baseUrl, 'https://api.example.com/v1');
    assert.equal(body.ai.model, 'claude-sonnet-4-5');
    assert.equal(body.ai.hasApiKey, true);
    assert.match(body.ai.apiKeyHint, /sk-s/);
    assert.ok(!JSON.stringify(body).includes('sk-secret-123456'));

    const row = await get(ctx.db, 'SELECT aiBaseUrl, aiApiKey, aiModel FROM user_settings WHERE userId = 1');
    assert.equal(row.aiBaseUrl, 'https://api.example.com/v1');
    assert.equal(row.aiApiKey, 'sk-secret-123456');
    assert.equal(row.aiModel, 'claude-sonnet-4-5');

    const got = await requestJson(ctx.base, '/settings');
    const gotBody = await got.json();
    assert.equal(gotBody.ai.hasApiKey, true);
    assert.ok(!JSON.stringify(gotBody).includes('sk-secret-123456'));
});

test('PUT /settings 空 apiKey 保持原样，clearApiKey 显式清除', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    await requestJson(ctx.base, '/settings', {
        method: 'PUT',
        body: { ai: { baseUrl: 'https://api.example.com', apiKey: 'sk-secret-123456' } },
    });

    // 空字符串不覆盖已有 Key
    await requestJson(ctx.base, '/settings', {
        method: 'PUT',
        body: { ai: { baseUrl: 'https://api2.example.com' } },
    });
    let row = await get(ctx.db, 'SELECT aiBaseUrl, aiApiKey FROM user_settings WHERE userId = 1');
    assert.equal(row.aiBaseUrl, 'https://api2.example.com');
    assert.equal(row.aiApiKey, 'sk-secret-123456');

    // 显式清除
    const cleared = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { ai: { clearApiKey: true } } });
    assert.equal(cleared.status, 200);
    const clearedBody = await cleared.json();
    assert.equal(clearedBody.ai.hasApiKey, false);
    row = await get(ctx.db, 'SELECT aiApiKey FROM user_settings WHERE userId = 1');
    assert.equal(row.aiApiKey, '');
});

test('PUT /settings 校验模型名长度', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const res = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { ai: { model: 'm'.repeat(121) } } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /模型名过长/);
});

test('PUT /settings 保存并回显 aiProtocol（默认 anthropic，非法值忽略）', async (t) => {
    const ctx = await startServer();
    t.after(ctx.close);

    const got0 = await requestJson(ctx.base, '/settings');
    assert.equal((await got0.json()).ai.protocol, 'anthropic');

    const res = await requestJson(ctx.base, '/settings', {
        method: 'PUT',
        body: { ai: { baseUrl: 'https://api.deepseek.com', protocol: 'openai' } },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ai.protocol, 'openai');

    const row = await get(ctx.db, 'SELECT aiProtocol FROM user_settings WHERE userId = 1');
    assert.equal(row.aiProtocol, 'openai');

    const got = await requestJson(ctx.base, '/settings');
    assert.equal((await got.json()).ai.protocol, 'openai');

    // 非法值忽略，保持原样
    const bad = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { ai: { protocol: 'weird' } } });
    assert.equal((await bad.json()).ai.protocol, 'openai');

    // 显式切回 anthropic
    const back = await requestJson(ctx.base, '/settings', { method: 'PUT', body: { ai: { protocol: 'anthropic' } } });
    assert.equal((await back.json()).ai.protocol, 'anthropic');
});
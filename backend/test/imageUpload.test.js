const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sqlite3 = require('sqlite3').verbose();
const {
    detectImageType, storagePathFor, normalizeDimension, writeImageAtomic,
} = require('../imageUpload');

/**
 * 文档插图上传链路回归。
 *
 * 背景：编辑器此前只有「填外链」一条路——后端没有上传接口，图片节点还是行内的，
 * 粘贴进来的 base64/blob 图在重新解析 HTML 时会被静默丢弃。这里锁住新链路的几条硬约束：
 * 未登录拒绝、非图片拒绝、内容寻址去重、以及 /uploads 的长缓存头。
 */

const PORT = 3600 + Math.floor(Math.random() * 200);
let child = null;
let tempDir = null;
let uploadDir = null;
let db = null;
let token = 'image-upload-test-token';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 最小合法 PNG（1×1，透明）
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
);
const GIF_1PX = Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9]),
]);

function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: PORT, ...options }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                buffer: Buffer.concat(chunks),
                text: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function postImage(buffer, { headers = {} } = {}) {
    return request({
        method: 'POST',
        path: '/images/upload',
        headers: {
            'Content-Type': 'image/png',
            'Content-Length': buffer.length,
            ...headers,
        },
    }, buffer);
}

before(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'wh-image-'));
    uploadDir = path.join(tempDir, 'uploads');
    const dbPath = path.join(tempDir, 'test.db');
    child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DB_PATH: dbPath, UPLOAD_DIR: uploadDir, PORT: String(PORT) },
        stdio: 'ignore',
    });

    for (let i = 0; i < 60; i++) {
        try {
            const res = await request({ method: 'GET', path: '/health' });
            if (res.status === 200) break;
        } catch {}
        await sleep(300);
    }

    db = new sqlite3.Database(dbPath);
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
    for (let i = 0; i < 40; i++) {
        const rows = await new Promise((resolve) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (e, r) => resolve(r || []));
        });
        if (rows.length) break;
        await sleep(250);
    }
    await run("INSERT OR IGNORE INTO users (id, username, password) VALUES (1, 'image-test', 'x')");
    await run('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, 1, datetime(\'now\', \'+1 day\'))', [token]);
});

after(() => {
    if (db) db.close();
    if (child) child.kill('SIGKILL');
    if (tempDir) {
        try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
    }
});

test('按文件头识别图片类型，不信任 Content-Type', () => {
    assert.deepStrictEqual(detectImageType(PNG_1PX), { ext: 'png', mime: 'image/png' });
    assert.deepStrictEqual(detectImageType(GIF_1PX), { ext: 'gif', mime: 'image/gif' });
    assert.deepStrictEqual(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), { ext: 'jpg', mime: 'image/jpeg' });
    assert.strictEqual(detectImageType(Buffer.from('<html></html>')), null);
    assert.strictEqual(detectImageType(Buffer.alloc(4)), null);
});

test('存储路径按 hash 分片，尺寸字段做上下限收敛', () => {
    const sha = 'a'.repeat(64);
    assert.strictEqual(storagePathFor(sha, 'png'), `aa/aa/${sha}.png`);
    assert.strictEqual(normalizeDimension('1200'), 1200);
    assert.strictEqual(normalizeDimension('abc'), 0);
    assert.strictEqual(normalizeDimension('-5'), 0);
});

test('同图重复写入只保留一份，且落盘是原子写', () => {
    const dir = path.join(tempDir, 'atomic');
    const first = writeImageAtomic(dir, 'ab/cd/hash.png', PNG_1PX);
    assert.strictEqual(first.created, true);
    const second = writeImageAtomic(dir, 'ab/cd/hash.png', PNG_1PX);
    assert.strictEqual(second.created, false);
    assert.strictEqual(readFileSync(first.absolutePath).length, PNG_1PX.length);
});

test('未登录上传返回 401', async () => {
    const res = await postImage(PNG_1PX);
    assert.strictEqual(res.status, 401);
});

test('非图片内容返回 400', async () => {
    const res = await request({
        method: 'POST',
        path: '/images/upload',
        headers: {
            'Content-Type': 'image/png',
            'Content-Length': 5,
            Authorization: `Bearer ${token}`,
        },
    }, Buffer.from('hello'));
    assert.strictEqual(res.status, 400);
    assert.match(JSON.parse(res.text).error, /只支持/);
});

test('登录后上传返回不可变 URL，重复上传复用同一文件', async () => {
    const first = await postImage(PNG_1PX, {
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Image-Width': '1200',
            'X-Image-Height': '800',
        },
    });
    assert.strictEqual(first.status, 200);
    const body = JSON.parse(first.text);
    assert.strictEqual(body.width, 1200);
    assert.strictEqual(body.height, 800);
    assert.strictEqual(body.deduped, false);
    assert.match(body.url, /^\/uploads\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);

    const file = await request({ method: 'GET', path: body.url });
    assert.strictEqual(file.status, 200);
    assert.match(file.headers['content-type'] || '', /image\/png/);
    assert.match(file.headers['cache-control'] || '', /immutable/);
    assert.strictEqual(file.buffer.length, PNG_1PX.length);

    const second = await postImage(PNG_1PX, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(JSON.parse(second.text).url, body.url);
    assert.strictEqual(JSON.parse(second.text).deduped, true);
});

test('元数据落库，宽高与体积可回查', async () => {
    const rows = await new Promise((resolve, reject) => {
        db.all('SELECT sha256, mime, byteSize, width, height FROM images', (err, r) => (err ? reject(err) : resolve(r)));
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].mime, 'image/png');
    assert.strictEqual(rows[0].byteSize, PNG_1PX.length);
    assert.strictEqual(rows[0].width, 1200);
});

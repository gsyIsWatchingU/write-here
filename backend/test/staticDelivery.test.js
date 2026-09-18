const { test, after, before } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, existsSync, readdirSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sqlite3 = require('sqlite3').verbose();

/**
 * 静态资源交付与列表接口的传输量回归。
 *
 * 背景：编辑器共享 chunk 有 836 KB，后端此前既没有压缩也没有缓存头，
 * 打开文档每次都要明文重传一遍；列表接口 `SELECT *` 还会把每篇文档的正文全文一起返回。
 * 这几条断言就是为了防止这些优化被回退。
 */

const PORT = 3400 + Math.floor(Math.random() * 200);
const DIST_ASSETS = path.join(__dirname, '../../frontend/dist/assets');
let child = null;
let tempDir = null;
let db = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 原生 http 请求：fetch/undici 会自动解压 gzip，量不出真实传输量 */
function rawGet(pathname, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: pathname, headers: { 'Accept-Encoding': acceptEncoding } },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.on('end', () => resolve({ bytes, headers: res.headers }));
      }
    );
    req.on('error', reject);
  });
}

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'wh-static-'));
  const dbPath = path.join(tempDir, 'test.db');
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT) },
    stdio: 'ignore',
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await rawGet('/health', 'identity');
      if (res.headers['content-type']?.includes('json')) break;
    } catch {}
    await sleep(300);
  }

  db = new sqlite3.Database(dbPath);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

  // 等建表完成再插数据
  for (let i = 0; i < 40; i++) {
    const rows = await all("SELECT name FROM sqlite_master WHERE type='table' AND name='docs'");
    if (rows.length) break;
    await sleep(250);
  }
  await run("INSERT OR IGNORE INTO users (id, username, password) VALUES (1, 'static-test', 'x')");
  await run(
    'INSERT INTO docs (publicId, userId, title, content, visibility, kind) VALUES (?, 1, ?, ?, ?, ?)',
    ['staticdeliveryhash00000000000000001', '长文文档', `<p>${'正文用于验证列表接口不回传全文。'.repeat(400)}</p>`, 'private', 'document']
  );
});

after(() => {
  if (db) db.close();
  if (child) child.kill('SIGKILL');
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
});

test('前端 chunk 走压缩传输，体积显著下降', async (t) => {
  if (!existsSync(DIST_ASSETS)) return t.skip('没有前端构建产物');
  const file = readdirSync(DIST_ASSETS)
    .filter((f) => f.endsWith('.js'))
    .sort((a, b) => statSync(path.join(DIST_ASSETS, b)).size - statSync(path.join(DIST_ASSETS, a)).size)[0];
  if (!file) return t.skip('没有前端构建产物');

  const [gz, plain] = await Promise.all([
    rawGet(`/assets/${file}`, 'gzip'),
    rawGet(`/assets/${file}`, 'identity'),
  ]);
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
  assert.ok(gz.bytes < plain.bytes * 0.5, `压缩后应有明显下降：${plain.bytes} -> ${gz.bytes}`);
});

test('带哈希的 assets 长缓存，index.html 每次校验', async (t) => {
  if (!existsSync(DIST_ASSETS)) return t.skip('没有前端构建产物');
  const file = readdirSync(DIST_ASSETS).find((f) => f.endsWith('.js'));
  if (!file) return t.skip('没有前端构建产物');

  const asset = await rawGet(`/assets/${file}`, 'identity');
  assert.match(asset.headers['cache-control'] || '', /max-age=31536000/);
  assert.match(asset.headers['cache-control'] || '', /immutable/);

  const html = await rawGet('/', 'identity');
  assert.match(html.headers['cache-control'] || '', /no-cache/);
});

test('文档列表只回传正文预览片段，不回传全文', async () => {
  const res = await rawGet('/docs?userId=1', 'identity');
  const body = JSON.parse(
    await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/docs?userId=1' }, (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => resolve(data));
      }).on('error', reject);
    })
  );
  const doc = body.find((item) => item.title === '长文文档');
  assert.ok(doc, '应能查到插入的文档');
  assert.ok(doc.content.length <= 200, `正文预览应被截断，实际 ${doc.content.length} 字符`);
});

test('热查询路径有索引，且数据库运行在 WAL 模式', async () => {
  const all = (sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  const names = (await all("SELECT name FROM sqlite_master WHERE type='index'")).map((r) => r.name);
  for (const expected of ['idx_docs_visibility', 'idx_shares_docId', 'idx_comments_docId', 'idx_notifications_userId']) {
    assert.ok(names.includes(expected), `缺少索引 ${expected}`);
  }
  const mode = await all('PRAGMA journal_mode');
  assert.strictEqual(String(mode[0].journal_mode).toLowerCase(), 'wal');
});

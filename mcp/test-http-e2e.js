// 端到端测试：HTTP MCP 端点（Streamable HTTP）——连接、列工具、创建文档、错误密钥拦截
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const require = createRequire(import.meta.url);
const { hashToken } = require('../backend/mcp.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-mcp-http-'));
const DB = path.join(tmpDir, 'test.db');
const PORT = 3213;
const SECRET = 'testsecret123';
const TOKEN = 'whmcp_e2e_token_test';
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [path.join(HERE, '../backend/server.js')], {
  cwd: tmpDir,
  env: {
    ...process.env,
    DB_PATH: DB,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    MCP_HTTP_SECRET: SECRET,
    HORIZON_DOCS_URL: BASE,
    HORIZON_DOCS_TOKEN: TOKEN,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => { out += d; });
server.stderr.on('data', (d) => { out += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not ready */ }
    await sleep(400);
  }
  throw new Error('server not ready\n' + out);
}

async function main() {
  await waitReady();

  // 准备测试用户与 API Token（等价于网站在“MCP AI 接入”中生成 Token）
  const sqlite3 = require('../backend/node_modules/sqlite3');
  const db = new sqlite3.Database(DB);
  const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => e ? rej(e) : res()));
  const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
  await run("INSERT INTO users (username, password, isAdmin) VALUES ('mcptest', 'x', 0)");
  const user = await get('SELECT id FROM users WHERE username = ?', ['mcptest']);
  await run('INSERT INTO api_tokens (userId, name, tokenHash, tokenPrefix) VALUES (?, ?, ?, ?)',
    [user.id, 'e2e', hashToken(TOKEN), TOKEN.slice(0, 14)]);

  // 1. 错误密钥应被 403 拦截
  const badRes = await fetch(`${BASE}/mcp/wrongsecret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  console.log('1. 错误密钥:', badRes.status, await badRes.text());

  // 2. 正确密钥：连接并初始化
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${SECRET}`));
  const client = new Client({ name: 'horizon-e2e', version: '1.0.0' });
  await client.connect(transport);
  console.log('2. 客户端连接成功');

  // 3. 列出工具
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log('3. 工具列表:', names.join(', '));

  // 4. 调用 create_markdown_document 创建文档
  const title = `HTTP MCP E2E ${Date.now()}`;
  const markdown = '# 端到端测试文档\n\n由 Streamable HTTP MCP 创建。';
  const created = await client.callTool({
    name: 'create_markdown_document',
    arguments: { title, markdown, visibility: 'private' },
  });
  console.log('4. 创建文档结果:', JSON.stringify(created).slice(0, 300));

  // 5. 读取刚创建的文档（tools/call get_markdown_document）
  const docId = created.structuredContent?.result?.documentId;
  if (docId) {
    const read = await client.callTool({ name: 'get_markdown_document', arguments: { documentId: docId } });
    const okRead = JSON.stringify(read).includes('端到端测试文档');
    console.log('5. 回读文档:', okRead ? 'PASS' : 'FAIL ' + JSON.stringify(read).slice(0, 200));
    if (!okRead) throw new Error('回读失败');
  } else {
    console.log('5. 创建响应缺少 documentId，跳过回读');
  }

  const ok =
    badRes.status === 403 &&
    tools.tools.length >= 8 &&
    names.includes('create_markdown_document') &&
    names.includes('get_markdown_document') &&
    JSON.stringify(created).includes('端到端测试文档');

  await client.close();
  db.close();
  server.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* windows */ }
  console.log('\n' + (ok ? 'ALL E2E TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  console.error(out);
  server.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});

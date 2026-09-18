const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { createMcpRouter, extractOutline, hashToken, migrateMcp } = require('./mcp');
const { migrateDocumentIdentity } = require('./documentIdentity');
const { migrateProblems } = require('./problems');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, (error) => error ? reject(error) : resolve()));
}

test('Markdown 大纲忽略代码围栏并保留标题中的井号', () => {
    assert.deepEqual(extractOutline('# C#\n```md\n## 代码示例\n```\n## 正文标题 ##'), [
        { level: 1, title: 'C#', line: 1 },
        { level: 2, title: '正文标题', line: 5 }
    ]);
});

test('MCP Token 以用户身份创建、读取和更新 Markdown 文档，撤销后立即失效', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-here-mcp-'));
    const db = new sqlite3.Database(path.join(dir, 'test.db'));
    let server = null;
    t.after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => db.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    await exec(db, `
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            displayName TEXT,
            email TEXT,
            ssoSubject TEXT,
            isAdmin INTEGER DEFAULT 0
        );
        CREATE TABLE docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publicId TEXT UNIQUE,
            userId INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'private',
            likes INTEGER NOT NULL DEFAULT 0,
            sortOrder INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username, displayName) VALUES (1, 'tester@example.com', '测试用户');
        INSERT INTO users (id, username, displayName) VALUES (2, 'other@example.com', '其他用户');
    `);
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            migrateProblems(db);
            migrateMcp(db);
            migrateDocumentIdentity(db);
            db.get('SELECT 1', (error) => error ? reject(error) : resolve());
        });
    });
    await run(db, "INSERT INTO sessions (token, userId, expiresAt) VALUES ('session-1', 1, datetime('now', '+1 day'))");

    const app = express();
    app.use(express.json());
    app.use(createMcpRouter({ db }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await fetch(`${base}/api-tokens`)).status, 401);
    const tokenResponse = await fetch(`${base}/api-tokens`, {
        method: 'POST',
        headers: { cookie: 'horizon_session=session-1', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Codex' })
    });
    assert.equal(tokenResponse.status, 201);
    const issued = await tokenResponse.json();
    assert.match(issued.token, /^whmcp_[A-Za-z0-9_-]{43}$/);

    const stored = await get(db, 'SELECT tokenHash, tokenPrefix FROM api_tokens WHERE id = ?', [issued.id]);
    assert.notEqual(stored.tokenHash, issued.token);
    assert.equal(stored.tokenHash, hashToken(issued.token));
    assert.equal(stored.tokenPrefix, issued.prefix);

    const unauthorized = await fetch(`${base}/mcp-api/documents`, {
        headers: { authorization: 'Bearer invalid' }
    });
    assert.equal(unauthorized.status, 401);

    const createResponse = await fetch(`${base}/mcp-api/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            title: 'MCP 上传测试',
            markdown: '\\# 标题\r\n\r\n<script>alert(1)</script>\r\n\r\n- 条目',
            visibility: 'private'
        })
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.title, 'MCP 上传测试');
    assert.equal(created.markdown, '# 标题\n\n<script>alert(1)</script>\n\n- 条目');
    assert.match(created.html, /<h1>标题<\/h1>/);
    assert.match(created.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(created.visibility, 'private');
    assert.match(created.documentId, /^[a-f0-9]{32}$/);
    assert.equal(created.publicId, created.documentId);
    assert.match(created.url, new RegExp(`/doc/${created.documentId}$`));

    const owner = await get(db, 'SELECT userId FROM docs WHERE id = ?', [created.id]);
    assert.equal(owner.userId, 1);

    const updateResponse = await fetch(`${base}/mcp-api/documents/${created.documentId}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: '## 第二版', visibility: 'public' })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.markdown, '## 第二版');
    assert.equal(updated.visibility, 'public');

    const otherDoc = await get(db, 'SELECT id FROM docs WHERE userId = 1');
    await run(db, "INSERT INTO docs (userId, title, content, kind) VALUES (2, '他人文档', '<p>x</p>', 'document')");
    const list = await (await fetch(`${base}/mcp-api/documents`, {
        headers: { authorization: `Bearer ${issued.token}` }
    })).json();
    assert.deepEqual(list.map((doc) => doc.documentId), [created.documentId]);

    const searchResponse = await fetch(`${base}/mcp-api/documents/search?q=${encodeURIComponent('第二版')}`, {
        headers: { authorization: `Bearer ${issued.token}` }
    });
    assert.equal(searchResponse.status, 200);
    const searchResults = await searchResponse.json();
    assert.deepEqual(searchResults.map((doc) => doc.documentId), [created.documentId]);
    assert.deepEqual(searchResults[0].outline, [{ level: 2, title: '第二版', line: 1 }]);

    const readResponse = await fetch(`${base}/mcp-api/documents/${created.documentId}/read?startLine=1&lineCount=1`, {
        headers: { authorization: `Bearer ${issued.token}` }
    });
    assert.equal(readResponse.status, 200);
    const read = await readResponse.json();
    assert.equal(read.content, '## 第二版');
    assert.equal(read.totalLines, 1);
    assert.equal(read.hasMore, false);

    const staleEdit = await fetch(`${base}/mcp-api/documents/${created.documentId}/content`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'append', text: '不应写入', expectedUpdatedAt: '2000-01-01 00:00:00' })
    });
    assert.equal(staleEdit.status, 409);

    const editResponse = await fetch(`${base}/mcp-api/documents/${created.documentId}/content`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'append', text: '新增段落', expectedUpdatedAt: read.updatedAt })
    });
    assert.equal(editResponse.status, 200);
    const edited = await editResponse.json();
    assert.equal(edited.markdown, '## 第二版\n\n新增段落');
    assert.equal(edited.edit.changed, true);

    const duplicateEdit = await fetch(`${base}/mcp-api/documents/${created.documentId}/content`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'replace', oldText: '#', text: '*' })
    });
    assert.equal(duplicateEdit.status, 409);

    const createSecond = await fetch(`${base}/mcp-api/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: '第二篇', markdown: '# 二' })
    });
    const second = await createSecond.json();
    const createThird = await fetch(`${base}/mcp-api/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: '第三篇', markdown: '# 三' })
    });
    const third = await createThird.json();
    const moveResponse = await fetch(`${base}/mcp-api/documents/${third.documentId}/order`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ position: 'first' })
    });
    assert.equal(moveResponse.status, 200);
    assert.equal((await moveResponse.json()).documentIds[0], third.documentId);
    const manualList = await (await fetch(`${base}/mcp-api/documents?sort=manual`, {
        headers: { authorization: `Bearer ${issued.token}` }
    })).json();
    assert.deepEqual(manualList.map((doc) => doc.documentId), [third.documentId, created.documentId, second.documentId]);

    const revokeResponse = await fetch(`${base}/api-tokens/${issued.id}`, {
        method: 'DELETE',
        headers: { cookie: 'horizon_session=session-1' }
    });
    assert.equal(revokeResponse.status, 200);
    assert.equal((await fetch(`${base}/mcp-api/documents`, {
        headers: { authorization: `Bearer ${issued.token}` }
    })).status, 401);
});

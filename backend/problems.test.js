const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { createProblemsRouter, migrateProblems } = require('./problems');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, (err) => err ? reject(err) : resolve()));
}

test('题目发布生成版本快照，并校验会话与嵌入令牌', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-here-problems-'));
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
            username TEXT,
            email TEXT,
            ssoSubject TEXT,
            displayName TEXT,
            isAdmin INTEGER DEFAULT 0
        );
        CREATE TABLE docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            visibility TEXT NOT NULL DEFAULT 'private',
            likes INTEGER NOT NULL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username) VALUES (1, 'tester');
    `);
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            migrateProblems(db);
            db.get('SELECT 1', (err) => err ? reject(err) : resolve());
        });
    });
    await run(db, "INSERT INTO sessions (token, userId, expiresAt) VALUES ('session-1', 1, datetime('now', '+1 day'))");

    const app = express();
    app.use(express.json());
    app.use(createProblemsRouter({ db }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${base}/problem-items`);
    assert.equal(unauthorized.status, 401);

    const cookieAuthorized = await fetch(`${base}/problem-items`, {
        headers: { cookie: 'horizon_session=session-1' }
    });
    assert.equal(cookieAuthorized.status, 200);

    const createdResponse = await fetch(`${base}/problem-items`, {
        method: 'POST',
        headers: { authorization: 'Bearer session-1', 'content-type': 'application/json' },
        body: JSON.stringify({ title: '两数之和' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    await run(db, "UPDATE docs SET content = '<h2>版本一</h2>' WHERE id = ?", [created.id]);

    const publishedResponse = await fetch(`${base}/problem-items/${created.id}/publish`, {
        method: 'POST', headers: { authorization: 'Bearer session-1', 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(publishedResponse.status, 200);
    const published = await publishedResponse.json();
    assert.equal(published.publishedVersion, 1);

    assert.equal((await fetch(`${base}/problem-content/${created.id}?token=wrong`)).status, 404);
    const contentResponse = await fetch(`${base}/problem-content/${created.id}?token=${published.embedToken}`);
    const content = await contentResponse.json();
    assert.equal(content.problem.content, '<h2>版本一</h2>');
    assert.equal(content.problem.version, 1);

    await run(db, "UPDATE docs SET content = '<h2>尚未发布的版本二</h2>' WHERE id = ?", [created.id]);
    const unchanged = await (await fetch(`${base}/problem-content/${created.id}?token=${published.embedToken}`)).json();
    assert.equal(unchanged.problem.content, '<h2>版本一</h2>');
});

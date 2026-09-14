const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { createDocumentOrderRouter, migrateDocumentOrder } = require('./documentOrder');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

test('个人文档拖放顺序持久化，并拒绝缺失或越权文档', async (t) => {
    const db = new sqlite3.Database(':memory:');
    let server;
    t.after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => db.close(resolve));
    });

    await exec(db, `
        CREATE TABLE docs (
            id INTEGER PRIMARY KEY,
            userId INTEGER NOT NULL,
            title TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'document'
        );
        INSERT INTO docs (id, userId, title) VALUES
            (1, 1, '一'),
            (2, 1, '二'),
            (3, 1, '三'),
            (4, 2, '他人文档');
    `);
    await migrateDocumentOrder(db);

    const app = express();
    app.use(express.json());
    app.use(createDocumentOrderRouter({ db }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const success = await fetch(`${base}/docs/order`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 1, documentIds: [3, 1, 2] }),
    });
    assert.equal(success.status, 200);
    const rows = await all(db, 'SELECT id, sortOrder FROM docs WHERE userId = 1 ORDER BY sortOrder');
    assert.deepEqual(rows, [
        { id: 3, sortOrder: 0 },
        { id: 1, sortOrder: 1 },
        { id: 2, sortOrder: 2 },
    ]);

    const incomplete = await fetch(`${base}/docs/order`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 1, documentIds: [1, 2] }),
    });
    assert.equal(incomplete.status, 400);

    const unauthorized = await fetch(`${base}/docs/order`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 1, documentIds: [1, 2, 4] }),
    });
    assert.equal(unauthorized.status, 400);
});

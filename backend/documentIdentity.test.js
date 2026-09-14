const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
    DOCUMENT_PUBLIC_ID_PATTERN,
    createDocumentPublicId,
    documentIdentifierParams,
    migrateDocumentIdentity,
} = require('./documentIdentity');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

test('文档 publicId 生成、旧数据迁移与数字 ID 兼容', async (t) => {
    const db = new sqlite3.Database(':memory:');
    t.after(() => new Promise((resolve) => db.close(resolve)));

    await exec(db, `
        CREATE TABLE docs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
        INSERT INTO docs (title) VALUES ('旧文档一'), ('旧文档二');
    `);
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            migrateDocumentIdentity(db);
            db.get('SELECT 1', (error) => error ? reject(error) : resolve());
        });
    });

    const rows = await all(db, 'SELECT id, publicId FROM docs ORDER BY id');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => DOCUMENT_PUBLIC_ID_PATTERN.test(row.publicId)));
    assert.notEqual(rows[0].publicId, rows[1].publicId);
    assert.match(createDocumentPublicId(), DOCUMENT_PUBLIC_ID_PATTERN);
    assert.deepEqual(documentIdentifierParams(rows[0].publicId), [rows[0].publicId, -1]);
    assert.deepEqual(documentIdentifierParams('9'), ['9', 9]);

    await assert.rejects(
        () => exec(db, `INSERT INTO docs (title, publicId) VALUES ('重复', '${rows[0].publicId}')`),
        /UNIQUE constraint failed/
    );
});

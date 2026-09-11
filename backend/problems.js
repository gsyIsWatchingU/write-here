const express = require('express');
const { v4: uuidv4 } = require('uuid');

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function callback(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function migrateProblems(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            userId INTEGER NOT NULL,
            expiresAt DATETIME NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(userId, expiresAt)');

    const columns = [
        ['kind', "TEXT NOT NULL DEFAULT 'document'"],
        ['publishStatus', "TEXT NOT NULL DEFAULT 'draft'"],
        ['publishedVersion', 'INTEGER NOT NULL DEFAULT 0'],
        ['publishedTitle', 'TEXT'],
        ['publishedContent', 'TEXT'],
        ['publishedAt', 'DATETIME'],
        ['embedToken', 'TEXT']
    ];
    for (const [column, type] of columns) {
        db.run(`ALTER TABLE docs ADD COLUMN ${column} ${type}`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error(`迁移题目字段 ${column} 失败:`, err.message);
            }
        });
    }
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_embed_token ON docs(embedToken) WHERE embedToken IS NOT NULL');
    db.run('CREATE INDEX IF NOT EXISTS idx_docs_kind_owner ON docs(kind, userId, updatedAt)');
}

async function authenticateSession(db, req) {
    const header = req.get('authorization') || '';
    const cookieHeader = req.get('cookie') || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map((part) => {
        const [name, ...rest] = part.trim().split('=');
        return [name, decodeURIComponent(rest.join('='))];
    }).filter(([name]) => name));
    const token = header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : (cookies.horizon_session || '');
    if (!token) return null;
    return get(db, `
        SELECT users.id, users.username, users.email, users.ssoSubject, users.isAdmin
        FROM sessions JOIN users ON users.id = sessions.userId
        WHERE sessions.token = ? AND sessions.expiresAt > CURRENT_TIMESTAMP
    `, [token]);
}

function createProblemsRouter({ db }) {
    const router = express.Router();

    async function requireUser(req, res) {
        const user = await authenticateSession(db, req);
        if (!user) res.status(401).json({ error: '登录已过期，请重新登录' });
        return user;
    }

    router.get('/problem-items', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const rows = await all(db, `
                SELECT id, title, content, publishStatus, publishedVersion, publishedTitle,
                       publishedAt, embedToken, createdAt, updatedAt
                FROM docs
                WHERE userId = ? AND kind = 'problem'
                ORDER BY updatedAt DESC
            `, [user.id]);
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/problem-items', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const title = String(req.body.title || '无标题题目').trim().slice(0, 200);
            const result = await run(db, `
                INSERT INTO docs (userId, title, content, kind, visibility, publishStatus, embedToken)
                VALUES (?, ?, '<p></p>', 'problem', 'private', 'draft', ?)
            `, [user.id, title || '无标题题目', uuidv4()]);
            const problem = await get(db, 'SELECT * FROM docs WHERE id = ?', [result.lastID]);
            res.status(201).json(problem);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/problem-items/:id/publish', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const result = await run(db, `
                UPDATE docs
                SET publishStatus = 'published', publishedTitle = title, publishedContent = content,
                    publishedVersion = publishedVersion + 1, publishedAt = CURRENT_TIMESTAMP,
                    embedToken = COALESCE(embedToken, ?), updatedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND userId = ? AND kind = 'problem'
            `, [uuidv4(), req.params.id, user.id]);
            if (!result.changes) return res.status(404).json({ error: '题目不存在或无权限发布' });
            const problem = await get(db, `
                SELECT id, title, publishStatus, publishedTitle, publishedVersion, publishedAt, embedToken, updatedAt
                FROM docs WHERE id = ?
            `, [req.params.id]);
            res.json(problem);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/problem-items/:id/unpublish', async (req, res) => {
        try {
            const user = await requireUser(req, res);
            if (!user) return;
            const result = await run(db, `
                UPDATE docs SET publishStatus = 'draft', updatedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND userId = ? AND kind = 'problem'
            `, [req.params.id, user.id]);
            if (!result.changes) return res.status(404).json({ error: '题目不存在或无权限取消发布' });
            res.json({ message: '已取消发布' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/problem-content/:id', async (req, res) => {
        const token = String(req.query.token || '');
        if (!token) return res.status(401).json({ error: '缺少题目读取令牌' });
        try {
            const problem = await get(db, `
                SELECT id, publishedTitle, publishedContent, publishedVersion, publishedAt
                FROM docs
                WHERE id = ? AND kind = 'problem' AND publishStatus = 'published' AND embedToken = ?
            `, [req.params.id, token]);
            if (!problem) return res.status(404).json({ error: '题目未发布或关联链接无效' });
            res.set('Cache-Control', 'no-store');
            res.json({
                contractVersion: 1,
                problem: {
                    id: String(problem.id), title: problem.publishedTitle,
                    content: problem.publishedContent || '', version: problem.publishedVersion,
                    publishedAt: problem.publishedAt
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = { authenticateSession, createProblemsRouter, migrateProblems };

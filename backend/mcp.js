const { createHash, randomBytes } = require('crypto');
const express = require('express');
const MarkdownIt = require('markdown-it');
const { authenticateSession } = require('./problems');

const TOKEN_PREFIX = 'whmcp_';
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE_TOKENS = 10;
const markdownParser = new MarkdownIt({ html: false, linkify: true });

const ESCAPED_BLOCK_MARKERS = [
    /^( {0,3})\\(#{1,6})(?=[ \t]+|$)/,
    /^( {0,3})\\(>)(?=[ \t]+|$)/,
    /^( {0,3})\\([*+-])(?=[ \t]+)/,
    /^( {0,3}\d{1,9})\\([.)])(?=[ \t]+)/
];

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function callback(error) {
            if (error) reject(error);
            else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function migrateMcp(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            tokenHash TEXT UNIQUE NOT NULL,
            tokenPrefix TEXT NOT NULL,
            lastUsedAt DATETIME,
            revokedAt DATETIME,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_api_tokens_user_active ON api_tokens(userId, revokedAt, createdAt)');
    db.run('ALTER TABLE docs ADD COLUMN markdownContent TEXT', (error) => {
        if (error && !error.message.includes('duplicate column name')) {
            console.error('迁移 Markdown 原文列失败:', error.message);
        }
    });
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function normalizeMarkdown(markdown) {
    let fenceMarker = null;

    return String(markdown || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => {
            const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
            if (fenceMarker) {
                const closesFence = fence
                    && fence[1][0] === fenceMarker[0]
                    && fence[1].length >= fenceMarker.length
                    && /^[ \t]*$/.test(line.slice(fence[0].length));
                if (closesFence) fenceMarker = null;
                return line;
            }
            if (fence) {
                fenceMarker = fence[1];
                return line;
            }
            for (const pattern of ESCAPED_BLOCK_MARKERS) {
                if (pattern.test(line)) return line.replace(pattern, '$1$2');
            }
            return line;
        })
        .join('\n');
}

function validateMarkdown(value) {
    if (typeof value !== 'string') return 'markdown 必须是字符串';
    if (Buffer.byteLength(value, 'utf8') > MAX_MARKDOWN_BYTES) return 'Markdown 不能超过 2 MB';
    return null;
}

function normalizeTitle(value) {
    return String(value || '').trim().slice(0, 200);
}

function getPublicBaseUrl(req) {
    const configured = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
    return configured || `${req.protocol}://${req.get('host')}`;
}

function documentResponse(req, row) {
    return {
        id: row.id,
        title: row.title,
        markdown: row.markdownContent ?? null,
        html: row.content,
        visibility: row.visibility,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        url: `${getPublicBaseUrl(req)}/doc/${row.id}`
    };
}

function createMcpRouter({ db }) {
    const router = express.Router();

    async function requireSession(req, res) {
        const user = await authenticateSession(db, req);
        if (!user) res.status(401).json({ error: '登录已过期，请重新登录' });
        return user;
    }

    async function requireApiToken(req, res) {
        const header = req.get('authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (!token.startsWith(TOKEN_PREFIX)) {
            res.status(401).json({ error: 'MCP Token 无效' });
            return null;
        }
        const tokenRow = await get(db, `
            SELECT api_tokens.id AS tokenId, users.id, COALESCE(users.displayName, users.username) AS username
            FROM api_tokens
            JOIN users ON users.id = api_tokens.userId
            WHERE api_tokens.tokenHash = ? AND api_tokens.revokedAt IS NULL
        `, [hashToken(token)]);
        if (!tokenRow) {
            res.status(401).json({ error: 'MCP Token 无效或已撤销' });
            return null;
        }
        await run(db, 'UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?', [tokenRow.tokenId]);
        return tokenRow;
    }

    router.get('/api-tokens', async (req, res) => {
        try {
            const user = await requireSession(req, res);
            if (!user) return;
            const rows = await all(db, `
                SELECT id, name, tokenPrefix AS prefix, lastUsedAt, createdAt
                FROM api_tokens
                WHERE userId = ? AND revokedAt IS NULL
                ORDER BY createdAt DESC
            `, [user.id]);
            res.json(rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/api-tokens', async (req, res) => {
        try {
            const user = await requireSession(req, res);
            if (!user) return;
            const name = String(req.body.name || 'AI MCP').trim().slice(0, 60);
            if (!name) return res.status(400).json({ error: 'Token 名称不能为空' });
            const count = await get(db, 'SELECT COUNT(*) AS count FROM api_tokens WHERE userId = ? AND revokedAt IS NULL', [user.id]);
            if (count.count >= MAX_ACTIVE_TOKENS) {
                return res.status(400).json({ error: `最多保留 ${MAX_ACTIVE_TOKENS} 个有效 Token` });
            }
            const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
            const prefix = `${token.slice(0, 14)}...`;
            const result = await run(db, `
                INSERT INTO api_tokens (userId, name, tokenHash, tokenPrefix)
                VALUES (?, ?, ?, ?)
            `, [user.id, name, hashToken(token), prefix]);
            const row = await get(db, 'SELECT id, name, tokenPrefix AS prefix, createdAt FROM api_tokens WHERE id = ?', [result.lastID]);
            res.status(201).json({ ...row, token });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/api-tokens/:id', async (req, res) => {
        try {
            const user = await requireSession(req, res);
            if (!user) return;
            const result = await run(db, `
                UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND userId = ? AND revokedAt IS NULL
            `, [req.params.id, user.id]);
            if (!result.changes) return res.status(404).json({ error: 'Token 不存在或已撤销' });
            res.json({ revoked: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/mcp-api/documents', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
            const rows = await all(db, `
                SELECT id, title, visibility, createdAt, updatedAt
                FROM docs
                WHERE userId = ? AND kind = 'document'
                ORDER BY updatedAt DESC
                LIMIT ?
            `, [user.id, limit]);
            res.json(rows.map((row) => ({
                ...row,
                url: `${getPublicBaseUrl(req)}/doc/${row.id}`
            })));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/mcp-api/documents/:id', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const row = await get(db, `
                SELECT id, title, content, markdownContent, visibility, createdAt, updatedAt
                FROM docs
                WHERE id = ? AND userId = ? AND kind = 'document'
            `, [req.params.id, user.id]);
            if (!row) return res.status(404).json({ error: '文档不存在或无权限访问' });
            res.json(documentResponse(req, row));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/mcp-api/documents', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const title = normalizeTitle(req.body.title);
            const markdownError = validateMarkdown(req.body.markdown);
            const visibility = req.body.visibility || 'private';
            if (!title) return res.status(400).json({ error: '标题不能为空' });
            if (markdownError) return res.status(400).json({ error: markdownError });
            if (!['private', 'public'].includes(visibility)) return res.status(400).json({ error: 'visibility 仅支持 private 或 public' });
            const normalized = normalizeMarkdown(req.body.markdown);
            const result = await run(db, `
                INSERT INTO docs (userId, title, content, markdownContent, visibility, kind)
                VALUES (?, ?, ?, ?, ?, 'document')
            `, [user.id, title, markdownParser.render(normalized), normalized, visibility]);
            const row = await get(db, `
                SELECT id, title, content, markdownContent, visibility, createdAt, updatedAt
                FROM docs WHERE id = ?
            `, [result.lastID]);
            res.status(201).json(documentResponse(req, row));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.put('/mcp-api/documents/:id', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const hasTitle = Object.prototype.hasOwnProperty.call(req.body, 'title');
            const hasMarkdown = Object.prototype.hasOwnProperty.call(req.body, 'markdown');
            const hasVisibility = Object.prototype.hasOwnProperty.call(req.body, 'visibility');
            if (!hasTitle && !hasMarkdown && !hasVisibility) {
                return res.status(400).json({ error: '至少提供 title、markdown 或 visibility 中的一项' });
            }
            const updates = [];
            const values = [];
            if (hasTitle) {
                const title = normalizeTitle(req.body.title);
                if (!title) return res.status(400).json({ error: '标题不能为空' });
                updates.push('title = ?');
                values.push(title);
            }
            if (hasMarkdown) {
                const markdownError = validateMarkdown(req.body.markdown);
                if (markdownError) return res.status(400).json({ error: markdownError });
                const normalized = normalizeMarkdown(req.body.markdown);
                updates.push('content = ?', 'markdownContent = ?');
                values.push(markdownParser.render(normalized), normalized);
            }
            if (hasVisibility) {
                if (!['private', 'public'].includes(req.body.visibility)) {
                    return res.status(400).json({ error: 'visibility 仅支持 private 或 public' });
                }
                updates.push('visibility = ?');
                values.push(req.body.visibility);
            }
            values.push(req.params.id, user.id);
            const result = await run(db, `
                UPDATE docs SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND userId = ? AND kind = 'document'
            `, values);
            if (!result.changes) return res.status(404).json({ error: '文档不存在或无权限修改' });
            const row = await get(db, `
                SELECT id, title, content, markdownContent, visibility, createdAt, updatedAt
                FROM docs WHERE id = ? AND userId = ?
            `, [req.params.id, user.id]);
            res.json(documentResponse(req, row));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = {
    MAX_MARKDOWN_BYTES,
    createMcpRouter,
    hashToken,
    migrateMcp,
    normalizeMarkdown
};

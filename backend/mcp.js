const { createHash, randomBytes } = require('crypto');
const express = require('express');
const MarkdownIt = require('markdown-it');
const { authenticateSession } = require('./problems');
const { createDocumentPublicId, documentIdentifierParams } = require('./documentIdentity');

const TOKEN_PREFIX = 'whmcp_';
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE_TOKENS = 10;
const MAX_SEARCH_QUERY_LENGTH = 100;
const MAX_READ_LINES = 500;
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

function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, '\\$&');
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function extractOutline(markdown, limit = 100) {
    const headings = [];
    let fenceMarker = null;
    const lines = normalizeLineEndings(markdown).split('\n');

    for (const [index, line] of lines.entries()) {
        const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fenceMarker) {
            const closesFence = fence
                && fence[1][0] === fenceMarker[0]
                && fence[1].length >= fenceMarker.length
                && /^[ \t]*$/.test(line.slice(fence[0].length));
            if (closesFence) fenceMarker = null;
            continue;
        }
        if (fence) {
            fenceMarker = fence[1];
            continue;
        }

        const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
        if (!heading) continue;
        const title = heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
        headings.push({ level: heading[1].length, title, line: index + 1 });
        if (headings.length >= limit) break;
    }

    return headings;
}

function createExcerpt(value, query, maxLength = 320) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const matchAt = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    const start = matchAt > 80 ? matchAt - 80 : 0;
    const excerpt = text.slice(start, start + maxLength);
    return `${start > 0 ? '…' : ''}${excerpt}${start + maxLength < text.length ? '…' : ''}`;
}

function getDocumentSource(row) {
    return row.markdownContent === null || row.markdownContent === undefined
        ? { content: row.content || '', format: 'html' }
        : { content: row.markdownContent, format: 'markdown' };
}

function getPublicBaseUrl(req) {
    const configured = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
    return configured || `${req.protocol}://${req.get('host')}`;
}

function documentResponse(req, row) {
    const source = getDocumentSource(row);
    return {
        id: row.id,
        documentId: row.publicId,
        publicId: row.publicId,
        title: row.title,
        markdown: row.markdownContent ?? null,
        html: row.content,
        contentFormat: source.format,
        outline: source.format === 'markdown' ? extractOutline(source.content) : [],
        visibility: row.visibility,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        url: `${getPublicBaseUrl(req)}/doc/${row.publicId}`
    };
}

function getOwnedDocumentByIdentifier(db, identifier, userId, columns) {
    const [publicId, legacyId] = documentIdentifierParams(identifier);
    return get(db, `
        SELECT ${columns}
        FROM docs
        WHERE (publicId = ? OR id = ?) AND userId = ? AND kind = 'document'
    `, [publicId, legacyId, userId]);
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
            const sort = req.query.sort || 'updated';
            if (!['updated', 'manual', 'title'].includes(sort)) {
                return res.status(400).json({ error: 'sort 仅支持 updated、manual 或 title' });
            }
            const orderBy = {
                updated: 'updatedAt DESC',
                manual: 'sortOrder IS NOT NULL, sortOrder ASC, updatedAt DESC',
                title: 'title COLLATE NOCASE ASC, id ASC'
            }[sort];
            const rows = await all(db, `
                SELECT id, publicId, title, visibility, sortOrder, createdAt, updatedAt
                FROM docs
                WHERE userId = ? AND kind = 'document'
                ORDER BY ${orderBy}
                LIMIT ?
            `, [user.id, limit]);
            res.json(rows.map((row) => {
                const { sortOrder, ...document } = row;
                return {
                    ...document,
                    documentId: row.publicId,
                    order: sortOrder,
                    url: `${getPublicBaseUrl(req)}/doc/${row.publicId}`
                };
            }));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/mcp-api/documents/search', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const query = String(req.query.q || '').trim();
            const visibility = req.query.visibility || 'all';
            const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
            if (!query) return res.status(400).json({ error: '搜索关键词不能为空' });
            if (query.length > MAX_SEARCH_QUERY_LENGTH) {
                return res.status(400).json({ error: `搜索关键词不能超过 ${MAX_SEARCH_QUERY_LENGTH} 个字符` });
            }
            if (!['all', 'private', 'public'].includes(visibility)) {
                return res.status(400).json({ error: 'visibility 仅支持 all、private 或 public' });
            }

            const like = `%${escapeLike(query)}%`;
            const visibilitySql = visibility === 'all' ? '' : 'AND visibility = ?';
            const params = [user.id];
            if (visibility !== 'all') params.push(visibility);
            params.push(like, like, like, limit);
            const rows = await all(db, `
                SELECT id, publicId, title, content, markdownContent, visibility, sortOrder, createdAt, updatedAt
                FROM docs
                WHERE userId = ? AND kind = 'document'
                  ${visibilitySql}
                  AND (
                    title LIKE ? ESCAPE '\\'
                    OR markdownContent LIKE ? ESCAPE '\\'
                    OR content LIKE ? ESCAPE '\\'
                  )
                ORDER BY updatedAt DESC
                LIMIT ?
            `, params);

            res.json(rows.map((row) => {
                const source = getDocumentSource(row);
                const searchable = source.format === 'html' ? stripHtml(source.content) : source.content;
                return {
                    id: row.id,
                    documentId: row.publicId,
                    publicId: row.publicId,
                    title: row.title,
                    excerpt: createExcerpt(searchable, query),
                    contentFormat: source.format,
                    outline: source.format === 'markdown' ? extractOutline(source.content, 20) : [],
                    characterCount: source.content.length,
                    visibility: row.visibility,
                    order: row.sortOrder,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    url: `${getPublicBaseUrl(req)}/doc/${row.publicId}`
                };
            }));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/mcp-api/documents/:id/read', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const startLine = Number.parseInt(req.query.startLine, 10) || 1;
            const lineCount = Number.parseInt(req.query.lineCount, 10) || 200;
            if (startLine < 1) return res.status(400).json({ error: 'startLine 必须大于 0' });
            if (lineCount < 1 || lineCount > MAX_READ_LINES) {
                return res.status(400).json({ error: `lineCount 必须在 1 到 ${MAX_READ_LINES} 之间` });
            }
            const row = await getOwnedDocumentByIdentifier(
                db,
                req.params.id,
                user.id,
                'id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt'
            );
            if (!row) return res.status(404).json({ error: '文档不存在或无权限访问' });

            const source = getDocumentSource(row);
            const lines = normalizeLineEndings(source.content).split('\n');
            if (startLine > lines.length) {
                return res.status(400).json({ error: `startLine 超出文档范围，文档共 ${lines.length} 行` });
            }
            const endLine = Math.min(startLine + lineCount - 1, lines.length);
            res.json({
                id: row.id,
                documentId: row.publicId,
                publicId: row.publicId,
                title: row.title,
                content: lines.slice(startLine - 1, endLine).join('\n'),
                contentFormat: source.format,
                startLine,
                endLine,
                totalLines: lines.length,
                hasMore: endLine < lines.length,
                outline: source.format === 'markdown' ? extractOutline(source.content) : [],
                visibility: row.visibility,
                updatedAt: row.updatedAt,
                url: `${getPublicBaseUrl(req)}/doc/${row.publicId}`
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/mcp-api/documents/:id', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const row = await getOwnedDocumentByIdentifier(
                db,
                req.params.id,
                user.id,
                'id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt'
            );
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
            const publicId = createDocumentPublicId();
            const result = await run(db, `
                INSERT INTO docs (publicId, userId, title, content, markdownContent, visibility, kind)
                VALUES (?, ?, ?, ?, ?, ?, 'document')
            `, [publicId, user.id, title, markdownParser.render(normalized), normalized, visibility]);
            const row = await get(db, `
                SELECT id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt
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
            const [publicId, legacyId] = documentIdentifierParams(req.params.id);
            values.push(publicId, legacyId, user.id);
            const result = await run(db, `
                UPDATE docs SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP
                WHERE (publicId = ? OR id = ?) AND userId = ? AND kind = 'document'
            `, values);
            if (!result.changes) return res.status(404).json({ error: '文档不存在或无权限修改' });
            const row = await getOwnedDocumentByIdentifier(
                db,
                req.params.id,
                user.id,
                'id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt'
            );
            res.json(documentResponse(req, row));
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.patch('/mcp-api/documents/:id/content', async (req, res) => {
        try {
            const user = await requireApiToken(req, res);
            if (!user) return;
            const operation = req.body.operation;
            const text = normalizeLineEndings(req.body.text);
            const oldText = normalizeLineEndings(req.body.oldText);
            const replaceAll = req.body.replaceAll === true;
            const expectedUpdatedAt = req.body.expectedUpdatedAt;
            if (!['replace', 'append', 'prepend'].includes(operation)) {
                return res.status(400).json({ error: 'operation 仅支持 replace、append 或 prepend' });
            }
            if (operation === 'replace' && !oldText) {
                return res.status(400).json({ error: 'replace 操作必须提供非空 oldText' });
            }
            if (operation !== 'replace' && !text) {
                return res.status(400).json({ error: `${operation} 操作的 text 不能为空` });
            }

            const row = await getOwnedDocumentByIdentifier(
                db,
                req.params.id,
                user.id,
                'id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt'
            );
            if (!row) return res.status(404).json({ error: '文档不存在或无权限修改' });
            if (row.markdownContent === null || row.markdownContent === undefined) {
                return res.status(409).json({
                    error: '该网页旧文档没有 Markdown 原文，请先用 update_markdown_document 提交完整 Markdown'
                });
            }
            if (expectedUpdatedAt && expectedUpdatedAt !== row.updatedAt) {
                return res.status(409).json({
                    error: '文档已被更新，请重新读取后再修改',
                    currentUpdatedAt: row.updatedAt
                });
            }

            let nextMarkdown = row.markdownContent;
            let replacements = 0;
            if (operation === 'replace') {
                let cursor = 0;
                while ((cursor = nextMarkdown.indexOf(oldText, cursor)) !== -1) {
                    replacements += 1;
                    cursor += oldText.length;
                }
                if (!replacements) return res.status(409).json({ error: '未找到要替换的原文，请重新读取文档' });
                if (replacements > 1 && !replaceAll) {
                    return res.status(409).json({
                        error: `原文出现 ${replacements} 次，请提供更完整的 oldText 或明确设置 replaceAll`
                    });
                }
                nextMarkdown = replaceAll
                    ? nextMarkdown.split(oldText).join(text)
                    : nextMarkdown.replace(oldText, text);
            } else if (operation === 'append') {
                nextMarkdown = nextMarkdown
                    ? `${nextMarkdown.replace(/\n*$/, '')}\n\n${text.replace(/^\n*/, '')}`
                    : text;
            } else {
                nextMarkdown = nextMarkdown
                    ? `${text.replace(/\n*$/, '')}\n\n${nextMarkdown.replace(/^\n*/, '')}`
                    : text;
            }
            nextMarkdown = normalizeMarkdown(nextMarkdown);
            const markdownError = validateMarkdown(nextMarkdown);
            if (markdownError) return res.status(400).json({ error: markdownError });
            if (nextMarkdown === row.markdownContent) {
                return res.json({ ...documentResponse(req, row), edit: { operation, replacements, changed: false } });
            }

            const values = [markdownParser.render(nextMarkdown), nextMarkdown, row.id, user.id];
            let concurrencySql = '';
            if (expectedUpdatedAt) {
                concurrencySql = ' AND updatedAt = ?';
                values.push(expectedUpdatedAt);
            }
            const result = await run(db, `
                UPDATE docs
                SET content = ?, markdownContent = ?, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND userId = ? AND kind = 'document'${concurrencySql}
            `, values);
            if (!result.changes) {
                const current = await get(db, 'SELECT updatedAt FROM docs WHERE id = ? AND userId = ?', [row.id, user.id]);
                return res.status(409).json({
                    error: '文档已被更新，请重新读取后再修改',
                    currentUpdatedAt: current?.updatedAt
                });
            }
            const updated = await get(db, `
                SELECT id, publicId, title, content, markdownContent, visibility, createdAt, updatedAt
                FROM docs WHERE id = ? AND userId = ?
            `, [row.id, user.id]);
            res.json({ ...documentResponse(req, updated), edit: { operation, replacements, changed: true } });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.patch('/mcp-api/documents/:id/order', async (req, res) => {
        const user = await requireApiToken(req, res).catch((error) => {
            res.status(500).json({ error: error.message });
            return null;
        });
        if (!user) return;
        const position = req.body.position;
        if (!['first', 'last', 'before', 'after'].includes(position)) {
            return res.status(400).json({ error: 'position 仅支持 first、last、before 或 after' });
        }
        if (['before', 'after'].includes(position) && !req.body.anchorDocumentId) {
            return res.status(400).json({ error: 'before/after 必须提供另一个有效的 anchorDocumentId' });
        }

        let transactionStarted = false;
        try {
            await run(db, 'BEGIN IMMEDIATE');
            transactionStarted = true;
            const document = await getOwnedDocumentByIdentifier(db, req.params.id, user.id, 'id, publicId');
            const anchorDocument = req.body.anchorDocumentId
                ? await getOwnedDocumentByIdentifier(db, req.body.anchorDocumentId, user.id, 'id, publicId')
                : null;
            const documentId = Number(document?.id);
            const anchorDocumentId = Number(anchorDocument?.id);
            if (!Number.isInteger(documentId) || documentId <= 0) {
                await run(db, 'ROLLBACK');
                transactionStarted = false;
                return res.status(404).json({ error: '文档不存在或无权限排序' });
            }
            if (['before', 'after'].includes(position)
                && (!Number.isInteger(anchorDocumentId) || anchorDocumentId <= 0 || anchorDocumentId === documentId)) {
                await run(db, 'ROLLBACK');
                transactionStarted = false;
                return res.status(400).json({ error: 'before/after 必须提供另一个有效的 anchorDocumentId' });
            }
            const rows = await all(db, `
                SELECT id, publicId
                FROM docs
                WHERE userId = ? AND kind = 'document'
                ORDER BY sortOrder IS NOT NULL, sortOrder ASC, updatedAt DESC
            `, [user.id]);
            const documentIds = rows.map((row) => Number(row.id));
            if (!documentIds.includes(documentId)) {
                await run(db, 'ROLLBACK');
                transactionStarted = false;
                return res.status(404).json({ error: '文档不存在或无权限排序' });
            }

            const nextIds = documentIds.filter((id) => id !== documentId);
            if (position === 'first') nextIds.unshift(documentId);
            else if (position === 'last') nextIds.push(documentId);
            else {
                const anchorIndex = nextIds.indexOf(anchorDocumentId);
                if (anchorIndex === -1) {
                    await run(db, 'ROLLBACK');
                    transactionStarted = false;
                    return res.status(404).json({ error: '锚点文档不存在或无权限访问' });
                }
                nextIds.splice(position === 'before' ? anchorIndex : anchorIndex + 1, 0, documentId);
            }

            for (const [index, id] of nextIds.entries()) {
                await run(db, `
                    UPDATE docs SET sortOrder = ?
                    WHERE id = ? AND userId = ? AND kind = 'document'
                `, [index, id, user.id]);
            }
            await run(db, 'COMMIT');
            transactionStarted = false;
            const publicIdsById = new Map(rows.map((row) => [Number(row.id), row.publicId]));
            res.json({
                documentId: document.publicId,
                position,
                anchorDocumentId: anchorDocument?.publicId || null,
                documentIds: nextIds.map((id) => publicIdsById.get(id))
            });
        } catch (error) {
            if (transactionStarted) await run(db, 'ROLLBACK').catch(() => {});
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = {
    MAX_MARKDOWN_BYTES,
    MAX_READ_LINES,
    createMcpRouter,
    extractOutline,
    hashToken,
    migrateMcp,
    normalizeMarkdown,
    stripHtml
};

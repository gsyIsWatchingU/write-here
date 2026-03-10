const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// y-websocket server utils
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket/bin/utils');

// 创建 Express 应用
const app = express();
const port = 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 连接数据库 - 使用 __dirname 确保路径正确
const dbPath = path.join(__dirname, '../db/docs.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('数据库连接失败:', err.message);
    } else {
        console.log('数据库连接成功');
        initDatabase();
    }
});

// 初始化数据库表
function initDatabase() {
    db.serialize(() => {
        // 创建用户表
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建文档表
        db.run(`
            CREATE TABLE IF NOT EXISTS docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 创建分享表
        db.run(`
            CREATE TABLE IF NOT EXISTS shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                docId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                permission TEXT NOT NULL DEFAULT 'read',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 迁移：如果旧表缺少 userId 列，则添加
        db.run(`ALTER TABLE docs ADD COLUMN userId INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移 userId 列失败:', err.message);
            }
        });

        console.log('数据库表初始化完成');
    });
}

// ==================== 用户 API ====================

// 用户注册
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, password],
        function(err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return res.status(400).json({ error: '用户名已存在' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, username });
        }
    );
});

// 用户登录
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    db.get('SELECT id, username FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: '用户名或密码错误' });
        res.json(row);
    });
});

// ==================== 文档 API ====================

// 获取所有文档（用户专属）
app.get('/docs', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.all('SELECT * FROM docs WHERE userId = ? ORDER BY updatedAt DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 获取单个文档（用户专属）
app.get('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.get('SELECT * FROM docs WHERE id = ? AND userId = ?', [id, userId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '文档不存在或无权限访问' });
        res.json(row);
    });
});

// 创建新文档
app.post('/docs', (req, res) => {
    const { userId, title, content } = req.body;
    if (!userId || !title) {
        return res.status(400).json({ error: '用户ID和标题不能为空' });
    }
    db.run(
        'INSERT INTO docs (userId, title, content) VALUES (?, ?, ?)',
        [userId, title, content || ''],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, userId, title, content: content || '' });
        }
    );
});

// 更新文档（用户专属）
app.put('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId, title, content } = req.body;
    if (!userId || !title) {
        return res.status(400).json({ error: '用户ID和标题不能为空' });
    }
    db.run(
        'UPDATE docs SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?',
        [title, content || '', id, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '文档不存在或无权限修改' });
            res.json({ id: parseInt(id), userId, title, content });
        }
    );
});

// 删除文档（用户专属）- 修复：使用 query 参数获取 userId
app.delete('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.serialize(() => {
        // 同时删除相关分享
        db.run('DELETE FROM shares WHERE docId = ?', [id]);
        db.run(
            'DELETE FROM docs WHERE id = ? AND userId = ?',
            [id, userId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: '文档不存在或无权限删除' });
                res.json({ message: '文档删除成功' });
            }
        );
    });
});

// ==================== 分享 API ====================

// 创建/更新分享
app.post('/shares', (req, res) => {
    const { docId, userId, permission } = req.body;
    if (!docId || !userId) return res.status(400).json({ error: '参数不完整' });

    // 验证文档属于该用户
    db.get('SELECT * FROM docs WHERE id = ? AND userId = ?', [docId, userId], (err, doc) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!doc) return res.status(404).json({ error: '文档不存在或无权限' });

        // 检查是否已有分享
        db.get('SELECT * FROM shares WHERE docId = ? AND userId = ?', [docId, userId], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });

            if (existing) {
                // 更新权限
                db.run('UPDATE shares SET permission = ? WHERE id = ?', [permission || 'read', existing.id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ ...existing, permission: permission || 'read' });
                });
            } else {
                // 创建新分享
                const token = uuidv4();
                db.run(
                    'INSERT INTO shares (docId, userId, token, permission) VALUES (?, ?, ?, ?)',
                    [docId, userId, token, permission || 'read'],
                    function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ id: this.lastID, docId, userId, token, permission: permission || 'read' });
                    }
                );
            }
        });
    });
});

// 通过 token 获取分享的文档
app.get('/shares/:token', (req, res) => {
    const { token } = req.params;
    db.get(
        `SELECT shares.*, docs.title, docs.content, docs.userId as ownerId, docs.createdAt as docCreatedAt, docs.updatedAt
         FROM shares 
         JOIN docs ON shares.docId = docs.id 
         WHERE shares.token = ?`,
        [token],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: '分享链接无效或已过期' });
            res.json({
                permission: row.permission,
                doc: {
                    id: row.docId,
                    title: row.title,
                    content: row.content,
                    ownerId: row.ownerId,
                    createdAt: row.docCreatedAt,
                    updatedAt: row.updatedAt
                }
            });
        }
    );
});

// 获取文档的所有分享
app.get('/shares/doc/:docId', (req, res) => {
    const { docId } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    // 验证文档属于该用户
    db.get('SELECT id FROM docs WHERE id = ? AND userId = ?', [docId, userId], (err, doc) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!doc) return res.status(404).json({ error: '文档不存在或无权限' });
        db.all('SELECT * FROM shares WHERE docId = ?', [docId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

// 删除分享
app.delete('/shares/doc/:docId', (req, res) => {
    const { docId } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.run('DELETE FROM shares WHERE docId = ? AND userId = ?', [docId, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '分享已取消' });
    });
});

// ==================== 启动服务器（HTTP + WebSocket） ====================

const server = http.createServer(app);

// WebSocket for Yjs 协同编辑
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // 只处理 /ws 路径
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws, req) => {
    setupWSConnection(ws, req);
});

server.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`WebSocket 协同编辑服务已启动`);
});

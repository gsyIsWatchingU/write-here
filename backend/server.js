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
const port = 3210;

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
                isAdmin INTEGER NOT NULL DEFAULT 0,
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
                visibility TEXT NOT NULL DEFAULT 'private',
                likes INTEGER NOT NULL DEFAULT 0,
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

        // 创建点赞表
        db.run(`
            CREATE TABLE IF NOT EXISTS likes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                docId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(docId, userId),
                FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 创建通知表
        db.run(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER NOT NULL,
                type TEXT NOT NULL,
                message TEXT NOT NULL,
                isRead INTEGER NOT NULL DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 创建协作表
        db.run(`
            CREATE TABLE IF NOT EXISTS collaborations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                docId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(docId, userId),
                FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 创建评论表
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                docId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                content TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);

        // 迁移：如果旧表缺少字段，则添加
        db.run(`ALTER TABLE users ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移 isAdmin 列失败:', err.message);
            }
        });

        db.run(`ALTER TABLE docs ADD COLUMN userId INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移 userId 列失败:', err.message);
            }
        });

        db.run(`ALTER TABLE docs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移 visibility 列失败:', err.message);
            }
        });

        db.run(`ALTER TABLE docs ADD COLUMN likes INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移 likes 列失败:', err.message);
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
    db.get('SELECT id, username, isAdmin FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
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

// 获取单个文档（用户专属或公开文档）
app.get('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.get('SELECT * FROM docs WHERE id = ? AND (userId = ? OR visibility = "public")', [id, userId], (err, row) => {
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

// ==================== 管理员 API ====================

// 管理员获取所有文档
app.get('/admin/docs', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    // 验证是否为管理员
    db.get('SELECT isAdmin FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user || user.isAdmin !== 1) return res.status(403).json({ error: '无管理员权限' });
        
        db.all('SELECT docs.*, users.username FROM docs JOIN users ON docs.userId = users.id ORDER BY docs.updatedAt DESC', (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

// ==================== 社区 API ====================

// 获取公开文档列表
app.get('/community/docs', (req, res) => {
    const { sortBy = '综合' } = req.query;
    let orderBy = 'docs.updatedAt DESC';
    
    if (sortBy === '最新') {
        orderBy = 'docs.createdAt DESC';
    } else if (sortBy === '最热') {
        orderBy = 'docs.likes DESC, docs.updatedAt DESC';
    }
    
    db.all(`
        SELECT docs.*, users.username 
        FROM docs 
        JOIN users ON docs.userId = users.id 
        WHERE docs.visibility = 'public' 
        ORDER BY ${orderBy}
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 更新文档可见性
app.put('/docs/:id/visibility', (req, res) => {
    const { id } = req.params;
    const { userId, visibility } = req.body;
    if (!userId || !visibility) {
        return res.status(400).json({ error: '用户ID和可见性不能为空' });
    }
    db.run(
        'UPDATE docs SET visibility = ? WHERE id = ? AND userId = ?',
        [visibility, id, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '文档不存在或无权限修改' });
            res.json({ id: parseInt(id), visibility });
        }
    );
});

// ==================== 点赞 API ====================

// 点赞/取消点赞
app.post('/docs/:id/like', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    db.serialize(() => {
        // 检查是否已点赞
        db.get('SELECT id FROM likes WHERE docId = ? AND userId = ?', [id, userId], (err, like) => {
            if (err) return res.status(500).json({ error: err.message });
            
            if (like) {
                // 取消点赞
                db.run('DELETE FROM likes WHERE id = ?', [like.id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    // 更新点赞数
                    db.run('UPDATE docs SET likes = likes - 1 WHERE id = ?', [id], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ liked: false });
                    });
                });
            } else {
                // 添加点赞
                db.run('INSERT INTO likes (docId, userId) VALUES (?, ?)', [id, userId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    // 更新点赞数
                    db.run('UPDATE docs SET likes = likes + 1 WHERE id = ?', [id], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        // 获取文档作者
                        db.get('SELECT userId FROM docs WHERE id = ?', [id], (err, doc) => {
                            if (err) return res.status(500).json({ error: err.message });
                            // 发送通知给作者
                            if (doc.userId !== parseInt(userId)) {
                                db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)', 
                                    [doc.userId, 'like', `有人点赞了你的文档`], function(err) {
                                        if (err) console.error('发送通知失败:', err.message);
                                        else {
                                            // 发送实时通知
                                            sendNotificationToUser(doc.userId, {
                                                id: this.lastID,
                                                userId: doc.userId,
                                                type: 'like',
                                                message: `有人点赞了你的文档`,
                                                isRead: 0,
                                                createdAt: new Date().toISOString()
                                            });
                                        }
                                    }
                                );
                            }
                            res.json({ liked: true });
                        });
                    });
                });
            }
        });
    });
});

// 检查用户是否已点赞
app.get('/docs/:id/like/status', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    db.get('SELECT id FROM likes WHERE docId = ? AND userId = ?', [id, userId], (err, like) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ liked: !!like });
    });
});

// ==================== 协作 API ====================

// 申请协作权限
app.post('/collaborations', (req, res) => {
    const { docId, userId } = req.body;
    if (!docId || !userId) return res.status(400).json({ error: '参数不完整' });

    // 检查文档是否存在且为公开
    db.get('SELECT userId as ownerId, visibility FROM docs WHERE id = ?', [docId], (err, doc) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!doc) return res.status(404).json({ error: '文档不存在' });
        if (doc.visibility !== 'public') return res.status(403).json({ error: '只能申请公开文档的协作权限' });
        if (doc.ownerId === parseInt(userId)) return res.status(400).json({ error: '不能申请自己文档的协作权限' });

        // 检查是否已存在协作请求
        db.get('SELECT id, status FROM collaborations WHERE docId = ? AND userId = ?', [docId, userId], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });

            if (existing) {
                if (existing.status === 'approved') {
                    return res.status(400).json({ error: '您已经是该文档的协作者' });
                } else if (existing.status === 'pending') {
                    return res.status(400).json({ error: '协作请求已发送，等待作者批准' });
                }
            }

            // 创建协作请求
            db.run(
                'INSERT INTO collaborations (docId, userId, status) VALUES (?, ?, ?)',
                [docId, userId, 'pending'],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    // 发送通知给文档作者
                    db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)', 
                        [doc.ownerId, 'collaboration_request', `有人申请协作您的文档`], function(err) {
                            if (err) console.error('发送通知失败:', err.message);
                            else {
                                // 发送实时通知
                                sendNotificationToUser(doc.ownerId, {
                                    id: this.lastID,
                                    userId: doc.ownerId,
                                    type: 'collaboration_request',
                                    message: `有人申请协作您的文档`,
                                    isRead: 0,
                                    createdAt: new Date().toISOString()
                                });
                            }
                        }
                    );

                    res.json({ id: this.lastID, docId, userId, status: 'pending' });
                }
            );
        });
    });
});

// 获取用户收到的协作请求
app.get('/collaborations/requests', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    db.all(`
        SELECT collaborations.*, docs.title, users.username 
        FROM collaborations 
        JOIN docs ON collaborations.docId = docs.id 
        JOIN users ON collaborations.userId = users.id 
        WHERE docs.userId = ? AND collaborations.status = 'pending' 
        ORDER BY collaborations.createdAt DESC
    `, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 批准/拒绝协作请求
app.put('/collaborations/:id', (req, res) => {
    const { id } = req.params;
    const { userId, status } = req.body;
    if (!userId || !status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: '参数不完整或无效' });
    }

    // 验证请求存在且文档属于当前用户
    db.get(`
        SELECT collaborations.*, docs.userId as ownerId 
        FROM collaborations 
        JOIN docs ON collaborations.docId = docs.id 
        WHERE collaborations.id = ? AND docs.userId = ?
    `, [id, userId], (err, collaboration) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!collaboration) return res.status(404).json({ error: '协作请求不存在或无权限处理' });
        if (collaboration.status !== 'pending') return res.status(400).json({ error: '该请求已处理' });

        // 更新协作状态
        db.run(
            'UPDATE collaborations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
            [status, id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // 发送通知给请求者
                const message = status === 'approved' ? '您的协作申请已被批准' : '您的协作申请已被拒绝';
                db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)', 
                    [collaboration.userId, 'collaboration_response', message], function(err) {
                        if (err) console.error('发送通知失败:', err.message);
                        else {
                            // 发送实时通知
                            sendNotificationToUser(collaboration.userId, {
                                id: this.lastID,
                                userId: collaboration.userId,
                                type: 'collaboration_response',
                                message: message,
                                isRead: 0,
                                createdAt: new Date().toISOString()
                            });
                        }
                    }
                );

                res.json({ id: parseInt(id), status });
            }
        );
    });
});

// 获取文档的协作者列表
app.get('/collaborations/doc/:docId', (req, res) => {
    const { docId } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    // 验证文档属于当前用户
    db.get('SELECT id FROM docs WHERE id = ? AND userId = ?', [docId, userId], (err, doc) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!doc) return res.status(404).json({ error: '文档不存在或无权限' });

        db.all(`
            SELECT collaborations.*, users.username 
            FROM collaborations 
            JOIN users ON collaborations.userId = users.id 
            WHERE collaborations.docId = ? AND collaborations.status = 'approved' 
            ORDER BY collaborations.createdAt DESC
        `, [docId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

// 删除协作者
app.delete('/collaborations/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    // 验证协作存在且文档属于当前用户
    db.get(`
        SELECT collaborations.*, docs.userId as ownerId 
        FROM collaborations 
        JOIN docs ON collaborations.docId = docs.id 
        WHERE collaborations.id = ? AND docs.userId = ?
    `, [id, userId], (err, collaboration) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!collaboration) return res.status(404).json({ error: '协作关系不存在或无权限处理' });

        // 删除协作
        db.run('DELETE FROM collaborations WHERE id = ?', [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // 发送通知给被移除的协作者
            db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)', 
                [collaboration.userId, 'collaboration_removed', '您已被移除为文档协作者'], function(err) {
                    if (err) console.error('发送通知失败:', err.message);
                    else {
                        // 发送实时通知
                        sendNotificationToUser(collaboration.userId, {
                            id: this.lastID,
                            userId: collaboration.userId,
                            type: 'collaboration_removed',
                            message: '您已被移除为文档协作者',
                            isRead: 0,
                            createdAt: new Date().toISOString()
                        });
                    }
                }
            );

            res.json({ message: '协作者已删除' });
        });
    });
});

// 检查用户是否有文档的协作权限
app.get('/collaborations/check', (req, res) => {
    const { docId, userId } = req.query;
    if (!docId || !userId) return res.status(400).json({ error: '参数不完整' });

    db.get('SELECT status FROM collaborations WHERE docId = ? AND userId = ? AND status = ?', 
        [docId, userId, 'approved'], (err, collaboration) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ hasAccess: !!collaboration });
        }
    );
});

// ==================== 评论 API ====================

// 获取文档的评论列表
app.get('/comments/doc/:docId', (req, res) => {
    const { docId } = req.params;
    db.all(`
        SELECT comments.*, users.username 
        FROM comments 
        JOIN users ON comments.userId = users.id 
        WHERE comments.docId = ? 
        ORDER BY comments.createdAt DESC
    `, [docId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 添加评论
app.post('/comments', (req, res) => {
    const { docId, userId, content } = req.body;
    if (!docId || !userId || !content) return res.status(400).json({ error: '参数不完整' });

    // 检查文档是否存在且为公开
    db.get('SELECT userId as ownerId, visibility FROM docs WHERE id = ?', [docId], (err, doc) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!doc) return res.status(404).json({ error: '文档不存在' });
        if (doc.visibility !== 'public') return res.status(403).json({ error: '只能评论公开文档' });

        // 添加评论
        db.run(
            'INSERT INTO comments (docId, userId, content) VALUES (?, ?, ?)',
            [docId, userId, content],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                // 发送通知给文档作者
                if (doc.ownerId !== parseInt(userId)) {
                    db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)', 
                        [doc.ownerId, 'comment', `有人评论了你的文档`], function(err) {
                            if (err) console.error('发送通知失败:', err.message);
                            else {
                                // 发送实时通知
                                sendNotificationToUser(doc.ownerId, {
                                    id: this.lastID,
                                    userId: doc.ownerId,
                                    type: 'comment',
                                    message: `有人评论了你的文档`,
                                    isRead: 0,
                                    createdAt: new Date().toISOString()
                                });
                            }
                        }
                    );
                }

                // 返回评论信息
                db.get(`
                    SELECT comments.*, users.username 
                    FROM comments 
                    JOIN users ON comments.userId = users.id 
                    WHERE comments.id = ?
                `, [this.lastID], (err, comment) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json(comment);
                });
            }
        );
    });
});

// 删除评论
app.delete('/comments/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    // 验证评论存在且属于当前用户或文档作者
    db.get(`
        SELECT comments.*, docs.userId as ownerId 
        FROM comments 
        JOIN docs ON comments.docId = docs.id 
        WHERE comments.id = ?
    `, [id], (err, comment) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!comment) return res.status(404).json({ error: '评论不存在' });
        if (comment.userId !== parseInt(userId) && comment.ownerId !== parseInt(userId)) {
            return res.status(403).json({ error: '无权限删除此评论' });
        }

        // 删除评论
        db.run('DELETE FROM comments WHERE id = ?', [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: '评论已删除' });
        });
    });
});

// ==================== 通知 API ====================

// 获取用户通知
app.get('/notifications', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    db.all('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 标记通知为已读
app.put('/notifications/:id/read', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    db.run(
        'UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?',
        [id, userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '通知不存在或无权限修改' });
            res.json({ message: '通知已标记为已读' });
        }
    );
});

// ==================== WebSocket 通知服务 ====================

// 存储用户的 WebSocket 连接
const userConnections = new Map();

// 发送通知给指定用户
function sendNotificationToUser(userId, notification) {
    const connections = userConnections.get(userId);
    if (connections) {
        connections.forEach(ws => {
            if (ws.readyState === 1) { // OPEN
                ws.send(JSON.stringify({ type: 'notification', data: notification }));
            }
        });
    }
}

// ==================== 启动服务器（HTTP + WebSocket） ====================

const server = http.createServer(app);

// WebSocket for Yjs 协同编辑和通知
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // 处理 /ws 路径（Yjs 协同编辑）和 /notifications 路径（通知）
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else if (url.pathname.startsWith('/notifications')) {
        // 处理通知的 WebSocket 连接
        const userId = url.searchParams.get('userId');
        if (!userId) {
            socket.destroy();
            return;
        }
        
        wss.handleUpgrade(request, socket, head, (ws) => {
            // 存储用户连接
            if (!userConnections.has(userId)) {
                userConnections.set(userId, new Set());
            }
            userConnections.get(userId).add(ws);
            
            // 连接关闭时清理
            ws.on('close', () => {
                const connections = userConnections.get(userId);
                if (connections) {
                    connections.delete(ws);
                    if (connections.size === 0) {
                        userConnections.delete(userId);
                    }
                }
            });
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
    console.log(`WebSocket 通知服务已启动`);
});

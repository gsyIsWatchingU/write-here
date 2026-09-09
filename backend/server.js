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
const port = Number(process.env.PORT) || 3210;
const host = process.env.HOST || '0.0.0.0';
const MIN_PASSWORD_LENGTH = 6;

// 中间件
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 连接数据库 - 使用 __dirname 确保路径正确
const dbPath = process.env.DB_PATH || path.join(__dirname, '../db/docs.db');
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
                parentId INTEGER,
                content TEXT NOT NULL,
                isResolved INTEGER NOT NULL DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id),
                FOREIGN KEY (parentId) REFERENCES comments(id) ON DELETE CASCADE
            )
        `);

        // 评论点赞独立存储，避免重复点赞并保留用户维度
        db.run(`
            CREATE TABLE IF NOT EXISTS comment_likes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                commentId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(commentId, userId),
                FOREIGN KEY (commentId) REFERENCES comments(id) ON DELETE CASCADE,
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

        db.run(`ALTER TABLE comments ADD COLUMN parentId INTEGER`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移评论 parentId 列失败:', err.message);
            }
        });

        db.run(`ALTER TABLE comments ADD COLUMN isResolved INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('迁移评论 isResolved 列失败:', err.message);
            }
        });

        for (const [column, type] of [
            ['actorUserId', 'INTEGER'],
            ['docId', 'INTEGER'],
            ['commentId', 'INTEGER']
        ]) {
            db.run(`ALTER TABLE notifications ADD COLUMN ${column} ${type}`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error(`迁移通知 ${column} 列失败:`, err.message);
                }
            });
        }

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
    if (password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `密码至少需要 ${MIN_PASSWORD_LENGTH} 位` });
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

// 更新文档（作者或已批准的协作者）
app.put('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId, title, content } = req.body;
    if (!userId || !title) {
        return res.status(400).json({ error: '用户ID和标题不能为空' });
    }
    db.run(
        `UPDATE docs
         SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND (
             userId = ? OR EXISTS (
                 SELECT 1 FROM collaborations
                 WHERE collaborations.docId = docs.id
                   AND collaborations.userId = ?
                   AND collaborations.status = 'approved'
             )
         )`,
        [title, content || '', id, userId, userId],
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
                                db.get('SELECT username FROM users WHERE id = ?', [userId], (userErr, actor) => {
                                    if (!userErr && actor) createNotification({
                                        userId: doc.userId,
                                        type: 'like',
                                        message: `${actor.username} 点赞了你的文档`,
                                        actorUserId: Number(userId),
                                        docId: Number(id)
                                    });
                                });
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
                } else if (existing.status === 'rejected') {
                    // 被拒绝后允许重新申请：更新回 pending，避免 UNIQUE 冲突
                    return db.run(
                        'UPDATE collaborations SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
                        ['pending', existing.id],
                        function(err) {
                            if (err) return res.status(500).json({ error: err.message });

                            // 重新发送通知给文档作者
                            db.run('INSERT INTO notifications (userId, type, message) VALUES (?, ?, ?)',
                                [doc.ownerId, 'collaboration_request', `有人申请协作您的文档`], function(err) {
                                    if (err) console.error('发送通知失败:', err.message);
                                    else {
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

                            return res.json({ id: existing.id, docId, userId, status: 'pending', reRequested: true });
                        }
                    );
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

// 获取用户对某文档的协作状态（pending/approved/rejected/none）
app.get('/collaborations/status', (req, res) => {
    const { docId, userId } = req.query;
    if (!docId || !userId) return res.status(400).json({ error: '参数不完整' });

    db.get(
        'SELECT status FROM collaborations WHERE docId = ? AND userId = ?',
        [docId, userId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: row?.status || null });
        }
    );
});

// 获取我参与协作（已批准）的文档列表
app.get('/collaborations/mydocs', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    db.all(
        `
        SELECT 
            docs.*,
            users.username,
            collaborations.id as collaborationId,
            collaborations.createdAt as collaborationCreatedAt,
            collaborations.updatedAt as collaborationUpdatedAt
        FROM collaborations
        JOIN docs ON collaborations.docId = docs.id
        JOIN users ON docs.userId = users.id
        WHERE collaborations.userId = ?
          AND collaborations.status = 'approved'
        ORDER BY docs.updatedAt DESC
        `,
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
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

function checkCommentAccess(docId, userId, shareToken, callback) {
    db.get(`
        SELECT docs.id, docs.userId AS ownerId, docs.title, docs.visibility,
               EXISTS(
                   SELECT 1 FROM collaborations
                   WHERE collaborations.docId = docs.id
                     AND collaborations.userId = ?
                     AND collaborations.status = 'approved'
               ) AS isCollaborator,
               EXISTS(
                   SELECT 1 FROM shares
                   WHERE shares.docId = docs.id AND shares.token = ?
               ) AS hasShare
        FROM docs
        WHERE docs.id = ?
    `, [userId || 0, shareToken || '', docId], (err, doc) => {
        if (err) return callback(err);
        if (!doc) return callback(null, null, false);
        const numericUserId = Number(userId || 0);
        const allowed = doc.visibility === 'public'
            || doc.ownerId === numericUserId
            || doc.isCollaborator === 1
            || doc.hasShare === 1;
        callback(null, doc, allowed);
    });
}

function createNotification({ userId, type, message, actorUserId = null, docId = null, commentId = null }) {
    if (!userId || Number(userId) === Number(actorUserId)) return;
    db.run(
        `INSERT INTO notifications (userId, type, message, actorUserId, docId, commentId)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, type, message, actorUserId, docId, commentId],
        function(err) {
            if (err) return console.error('发送通知失败:', err.message);
            sendNotificationToUser(Number(userId), {
                id: this.lastID,
                userId: Number(userId),
                type,
                message,
                actorUserId,
                docId,
                commentId,
                isRead: 0,
                createdAt: new Date().toISOString()
            });
        }
    );
}

function notifyMentions(content, actor, doc, commentId, excludedUserIds = []) {
    const usernames = [...new Set(
        [...content.matchAll(/@([^\s@，。,:：；;]+)/g)].map(match => match[1])
    )];
    if (!usernames.length) return;
    const placeholders = usernames.map(() => '?').join(',');
    db.all(
        `SELECT id, username FROM users WHERE username IN (${placeholders})`,
        usernames,
        (err, users) => {
            if (err) return console.error('查询提及用户失败:', err.message);
            users
                .filter(mentioned => !excludedUserIds.includes(mentioned.id))
                .forEach(mentioned => createNotification({
                    userId: mentioned.id,
                    type: 'mention',
                    message: `${actor.username} 在《${doc.title}》中提到了你`,
                    actorUserId: actor.id,
                    docId: doc.id,
                    commentId
                }));
        }
    );
}

// 获取文档的评论列表
app.get('/comments/doc/:docId', (req, res) => {
    const { docId } = req.params;
    const { userId, shareToken } = req.query;
    checkCommentAccess(docId, userId, shareToken, (accessErr, doc, allowed) => {
        if (accessErr) return res.status(500).json({ error: accessErr.message });
        if (!doc) return res.status(404).json({ error: '文档不存在' });
        if (!allowed) return res.status(403).json({ error: '无权限查看评论' });

        db.all(`
            SELECT comments.*, users.username,
                   COUNT(comment_likes.id) AS likeCount,
                   MAX(CASE WHEN comment_likes.userId = ? THEN 1 ELSE 0 END) AS liked
            FROM comments
            JOIN users ON comments.userId = users.id
            LEFT JOIN comment_likes ON comment_likes.commentId = comments.id
            WHERE comments.docId = ?
            GROUP BY comments.id
            ORDER BY COALESCE(comments.parentId, comments.id) DESC,
                     CASE WHEN comments.parentId IS NULL THEN 0 ELSE 1 END,
                     comments.createdAt ASC
        `, [userId || 0, docId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows.map(row => ({
                ...row,
                liked: Boolean(row.liked),
                likeCount: Number(row.likeCount)
            })));
        });
    });
});

// 添加评论
app.post('/comments', (req, res) => {
    const { docId, userId, content, parentId = null, shareToken = '' } = req.body;
    const normalizedContent = String(content || '').trim();
    if (!docId || !userId || !normalizedContent) return res.status(400).json({ error: '参数不完整' });
    if (normalizedContent.length > 2000) return res.status(400).json({ error: '评论不能超过 2000 字' });

    checkCommentAccess(docId, userId, shareToken, (accessErr, doc, allowed) => {
        if (accessErr) return res.status(500).json({ error: accessErr.message });
        if (!doc) return res.status(404).json({ error: '文档不存在' });
        if (!allowed) return res.status(403).json({ error: '无权限评论此文档' });

        db.get('SELECT id, username FROM users WHERE id = ?', [userId], (userErr, actor) => {
            if (userErr) return res.status(500).json({ error: userErr.message });
            if (!actor) return res.status(404).json({ error: '用户不存在' });

            const insertComment = (rootParentId, parentAuthorId = null) => {
                db.run(
                    'INSERT INTO comments (docId, userId, content, parentId) VALUES (?, ?, ?, ?)',
                    [docId, userId, normalizedContent, rootParentId],
                    function(err) {
                        if (err) return res.status(500).json({ error: err.message });
                        const commentId = this.lastID;
                        const recipients = new Set();
                        if (doc.ownerId !== Number(userId)) recipients.add(doc.ownerId);
                        if (parentAuthorId && parentAuthorId !== Number(userId)) recipients.add(parentAuthorId);

                        recipients.forEach(recipientId => createNotification({
                            userId: recipientId,
                            type: rootParentId ? 'reply' : 'comment',
                            message: rootParentId
                                ? `${actor.username} 回复了《${doc.title}》中的评论`
                                : `${actor.username} 评论了《${doc.title}》`,
                            actorUserId: actor.id,
                            docId: Number(docId),
                            commentId: rootParentId || commentId
                        }));
                        notifyMentions(normalizedContent, actor, doc, rootParentId || commentId, [...recipients]);

                        db.get(`
                            SELECT comments.*, users.username, 0 AS likeCount, 0 AS liked
                            FROM comments
                            JOIN users ON comments.userId = users.id
                            WHERE comments.id = ?
                        `, [commentId], (commentErr, comment) => {
                            if (commentErr) return res.status(500).json({ error: commentErr.message });
                            res.status(201).json({ ...comment, liked: false });
                        });
                    }
                );
            };

            if (!parentId) return insertComment(null);
            db.get(
                'SELECT id, userId, parentId FROM comments WHERE id = ? AND docId = ?',
                [parentId, docId],
                (parentErr, parent) => {
                    if (parentErr) return res.status(500).json({ error: parentErr.message });
                    if (!parent) return res.status(404).json({ error: '回复的评论不存在' });
                    insertComment(parent.parentId || parent.id, parent.userId);
                }
            );
        });
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

        const commentIdsSql = 'SELECT id FROM comments WHERE id = ? OR parentId = ?';
        db.serialize(() => {
            db.run(`DELETE FROM comment_likes WHERE commentId IN (${commentIdsSql})`, [id, id]);
            db.run('DELETE FROM comments WHERE id = ? OR parentId = ?', [id, id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: '评论已删除' });
            });
        });
    });
});

// 评论点赞/取消点赞
app.post('/comments/:id/like', (req, res) => {
    const { id } = req.params;
    const { userId, shareToken = '' } = req.body;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });

    db.get(`
        SELECT comments.id, comments.docId, comments.userId AS authorId,
               users.username AS actorName, docs.title
        FROM comments
        JOIN docs ON comments.docId = docs.id
        JOIN users ON users.id = ?
        WHERE comments.id = ?
    `, [userId, id], (err, comment) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!comment) return res.status(404).json({ error: '评论或用户不存在' });

        checkCommentAccess(comment.docId, userId, shareToken, (accessErr, doc, allowed) => {
            if (accessErr) return res.status(500).json({ error: accessErr.message });
            if (!doc || !allowed) return res.status(403).json({ error: '无权限点赞此评论' });

            db.get('SELECT id FROM comment_likes WHERE commentId = ? AND userId = ?', [id, userId], (likeErr, like) => {
            if (likeErr) return res.status(500).json({ error: likeErr.message });
            const finish = (liked) => db.get(
                'SELECT COUNT(*) AS count FROM comment_likes WHERE commentId = ?',
                [id],
                (countErr, countRow) => {
                    if (countErr) return res.status(500).json({ error: countErr.message });
                    res.json({ liked, likeCount: Number(countRow.count) });
                }
            );

            if (like) {
                return db.run('DELETE FROM comment_likes WHERE id = ?', [like.id], deleteErr => {
                    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
                    finish(false);
                });
            }

            db.run('INSERT INTO comment_likes (commentId, userId) VALUES (?, ?)', [id, userId], insertErr => {
                if (insertErr) return res.status(500).json({ error: insertErr.message });
                createNotification({
                    userId: comment.authorId,
                    type: 'comment_like',
                    message: `${comment.actorName} 赞了你在《${comment.title}》中的评论`,
                    actorUserId: Number(userId),
                    docId: comment.docId,
                    commentId: Number(id)
                });
                finish(true);
            });
            });
        });
    });
});

// 解决/重新打开评论线程
app.put('/comments/:id/resolve', (req, res) => {
    const { id } = req.params;
    const { userId, resolved } = req.body;
    if (!userId || typeof resolved !== 'boolean') return res.status(400).json({ error: '参数不完整' });

    db.get(`
        SELECT comments.id, comments.userId, comments.parentId, docs.userId AS ownerId
        FROM comments JOIN docs ON comments.docId = docs.id
        WHERE comments.id = ?
    `, [id], (err, comment) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!comment || comment.parentId) return res.status(404).json({ error: '评论线程不存在' });
        if (comment.userId !== Number(userId) && comment.ownerId !== Number(userId)) {
            return res.status(403).json({ error: '无权限处理此评论线程' });
        }
        db.run('UPDATE comments SET isResolved = ? WHERE id = ?', [resolved ? 1 : 0, id], updateErr => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ id: Number(id), isResolved: resolved ? 1 : 0 });
        });
    });
});

// ==================== 通知 API ====================

// 获取用户通知
app.get('/notifications', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    
    db.all(`
        SELECT notifications.*, users.username AS actorName, docs.title AS docTitle
        FROM notifications
        LEFT JOIN users ON notifications.actorUserId = users.id
        LEFT JOIN docs ON notifications.docId = docs.id
        WHERE notifications.userId = ?
        ORDER BY notifications.createdAt DESC
        LIMIT 100
    `, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 一键全部已读
app.put('/notifications/read-all', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.run('UPDATE notifications SET isRead = 1 WHERE userId = ? AND isRead = 0', [userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});

// 清理已读通知
app.delete('/notifications/read', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '用户ID不能为空' });
    db.run('DELETE FROM notifications WHERE userId = ? AND isRead = 1', [userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
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

// 生产环境由后端直接托管 Vite 构建产物，REST 与 WebSocket 使用同一来源。
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));
app.get('*', (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
        if (err) next(err);
    });
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

server.listen(port, host, () => {
    console.log(`服务器运行在 http://${host}:${port}`);
    console.log(`WebSocket 协同编辑服务已启动`);
    console.log(`WebSocket 通知服务已启动`);
});

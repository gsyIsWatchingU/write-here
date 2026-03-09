const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

// 创建Express应用
const app = express();
const port = 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 连接数据库
const db = new sqlite3.Database('../db/docs.db', (err) => {
    if (err) {
        console.error('数据库连接失败:', err.message);
    } else {
        console.log('数据库连接成功');
        // 初始化数据库表
        initDatabase();
    }
});

// 初始化数据库表
function initDatabase() {
    // 创建用户表
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('创建用户表失败:', err.message);
        } else {
            console.log('用户表创建成功');
        }
    });
    
    // 创建文档表，添加userId字段
    db.run(`
        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `, (err) => {
        if (err) {
            console.error('创建文档表失败:', err.message);
        } else {
            console.log('文档表创建成功');
        }
    });
}

// API端点

// 用户注册
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        res.status(400).json({ error: '用户名和密码不能为空' });
        return;
    }
    
    db.run(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, password],
        function(err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    res.status(400).json({ error: '用户名已存在' });
                } else {
                    res.status(500).json({ error: err.message });
                }
                return;
            }
            res.json({ id: this.lastID, username });
        }
    );
});

// 用户登录
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        res.status(400).json({ error: '用户名和密码不能为空' });
        return;
    }
    
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(401).json({ error: '用户名或密码错误' });
            return;
        }
        res.json({ id: row.id, username: row.username });
    });
});

// 获取所有文档（用户专属）
app.get('/docs', (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
        res.status(400).json({ error: '用户ID不能为空' });
        return;
    }
    
    db.all('SELECT * FROM docs WHERE userId = ? ORDER BY updatedAt DESC', [userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 获取单个文档（用户专属）
app.get('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
        res.status(400).json({ error: '用户ID不能为空' });
        return;
    }
    
    db.get('SELECT * FROM docs WHERE id = ? AND userId = ?', [id, userId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: '文档不存在或无权限访问' });
            return;
        }
        res.json(row);
    });
});

// 创建新文档
app.post('/docs', (req, res) => {
    const { userId, title, content } = req.body;
    
    if (!userId || !title || !content) {
        res.status(400).json({ error: '用户ID、标题和内容不能为空' });
        return;
    }
    
    db.run(
        'INSERT INTO docs (userId, title, content) VALUES (?, ?, ?)',
        [userId, title, content],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, userId, title, content });
        }
    );
});

// 更新文档（用户专属）
app.put('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId, title, content } = req.body;
    
    if (!userId || !title || !content) {
        res.status(400).json({ error: '用户ID、标题和内容不能为空' });
        return;
    }
    
    db.run(
        'UPDATE docs SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?',
        [title, content, id, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: '文档不存在或无权限修改' });
                return;
            }
            res.json({ id: parseInt(id), userId, title, content });
        }
    );
});

// 删除文档（用户专属）
app.delete('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
        res.status(400).json({ error: '用户ID不能为空' });
        return;
    }
    
    db.run(
        'DELETE FROM docs WHERE id = ? AND userId = ?',
        [id, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: '文档不存在或无权限删除' });
                return;
            }
            res.json({ message: '文档删除成功' });
        }
    );
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
});
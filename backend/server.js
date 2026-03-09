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
    db.run(`
        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('创建表失败:', err.message);
        } else {
            console.log('表创建成功');
        }
    });
}

// API端点

// 获取所有文档
app.get('/docs', (req, res) => {
    db.all('SELECT * FROM docs ORDER BY updatedAt DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 获取单个文档
app.get('/docs/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM docs WHERE id = ?', [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: '文档不存在' });
            return;
        }
        res.json(row);
    });
});

// 创建新文档
app.post('/docs', (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) {
        res.status(400).json({ error: '标题和内容不能为空' });
        return;
    }
    
    db.run(
        'INSERT INTO docs (title, content) VALUES (?, ?)',
        [title, content],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, title, content });
        }
    );
});

// 更新文档
app.put('/docs/:id', (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;
    
    if (!title || !content) {
        res.status(400).json({ error: '标题和内容不能为空' });
        return;
    }
    
    db.run(
        'UPDATE docs SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
        [title, content, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: '文档不存在' });
                return;
            }
            res.json({ id: parseInt(id), title, content });
        }
    );
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
});
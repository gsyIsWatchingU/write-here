# 轻量级文档编辑器

一个类似语雀的轻量级线上文档编辑器，包含前后端和数据库，支持用户认证和个人文档管理。

## 项目结构

```
├── frontend/          # 前端代码
│   └── index.html     # 主页面
├── backend/           # 后端代码
│   ├── package.json   # 依赖配置
│   └── server.js      # 服务器代码
└── db/                # 数据库目录
```

## 功能特点

- 用户注册和登录
- 新建文档
- 编辑文档
- 保存文档
- 查看个人文档列表
- 删除文档
- 每个用户只能操作自己的文档

## 技术栈

- 前端：HTML, CSS, JavaScript
- 后端：Node.js, Express
- 数据库：SQLite

## 安装和运行

### 1. 安装依赖

```bash
# 进入后端目录
cd backend

# 安装依赖
npm install
```

### 2. 启动后端服务

```bash
# 启动后端服务器
npm start
```

后端服务将运行在 `http://localhost:3000`。

### 3. 打开前端页面

直接在浏览器中打开 `frontend/index.html` 文件。

## API 接口

### 用户相关
- `POST /register` - 用户注册
- `POST /login` - 用户登录

### 文档相关
- `GET /docs?userId=1` - 获取指定用户的所有文档
- `GET /docs/:id?userId=1` - 获取指定用户的单个文档
- `POST /docs` - 创建新文档（需要 userId）
- `PUT /docs/:id` - 更新文档（需要 userId）
- `DELETE /docs/:id` - 删除文档（需要 userId）

## 数据库结构

### 用户表 (users)
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 文档表 (docs)
```sql
CREATE TABLE docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
);
```

## 注意事项

- 本项目为轻量级实现，仅包含最基础的功能
- 数据库使用 SQLite，数据存储在 `db/docs.db` 文件中
- 本项目使用 localStorage 存储用户登录状态
- 本项目未实现文档版本控制
- 本项目未实现密码加密存储，仅用于演示目的

# 轻量级文档编辑器

一个类似语雀的轻量级线上文档编辑器，包含前后端和数据库。

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

- 新建文档
- 编辑文档
- 保存文档
- 查看文档列表
- 查看文档详情

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

- `GET /docs` - 获取所有文档
- `GET /docs/:id` - 获取单个文档
- `POST /docs` - 创建新文档
- `PUT /docs/:id` - 更新文档

## 数据库结构

```sql
CREATE TABLE docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 注意事项

- 本项目为轻量级实现，仅包含最基础的功能
- 数据库使用 SQLite，数据存储在 `db/docs.db` 文件中
- 本项目未实现用户认证和权限管理
- 本项目未实现文档版本控制

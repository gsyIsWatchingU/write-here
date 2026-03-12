# WriteHere - 轻量级文档编辑器

一个类似语雀的轻量级线上文档编辑器，包含前后端和数据库，支持用户认证、个人文档管理、协同编辑和社区功能。

## 项目结构

```
├── frontend/          # 前端代码
│   ├── src/           # 源代码
│   │   ├── assets/    # 静态资源
│   │   ├── components/ # 组件
│   │   ├── router/    # 路由配置
│   │   ├── utils/     # 工具函数
│   │   ├── views/     # 页面
│   │   ├── App.vue    # 根组件
│   │   └── main.js    # 入口文件
│   ├── index.html     # 主页面
│   ├── package.json   # 依赖配置
│   └── vite.config.js # Vite配置
├── backend/           # 后端代码
│   ├── package.json   # 依赖配置
│   └── server.js      # 服务器代码
└── db/                # 数据库目录
    └── docs.db        # SQLite数据库文件
```

## 功能特点

- **用户管理**
  - 用户注册和登录
  - 个人信息管理
  - 管理员权限

- **文档管理**
  - 新建文档
  - 编辑文档（富文本编辑器）
  - 保存文档（自动保存）
  - 查看个人文档列表
  - 删除文档
  - 文档可见性设置（私密/公开）

- **协同编辑**
  - 实时多人编辑
  - 光标位置显示
  - 编辑历史记录

- **文档分享**
  - 生成分享链接
  - 设置访问权限（只读/可编辑）
  - 分享链接管理

- **社区功能**
  - 查看公开文档列表
  - 文档排序（综合/最新/最热）
  - 文档点赞
  - 点赞通知

- **管理员功能**
  - 查看所有文档
  - 文档管理

## 技术栈

### 前端
- **框架**：Vue 3
- **构建工具**：Vite
- **路由**：Vue Router 4
- **编辑器**：TipTap 2（富文本编辑器）
- **协同编辑**：Yjs + Y-WebSocket
- **样式**：原生CSS
- **其他**：Lowlight（代码高亮）

### 后端
- **语言**：Node.js
- **框架**：Express
- **数据库**：SQLite
- **WebSocket**：ws + y-websocket
- **其他**：uuid（生成唯一ID）

### 数据库
- **类型**：SQLite
- **存储**：本地文件存储

## 安装和运行

### 方式一：一键启动（推荐）

在项目根目录下，一次性安装依赖并启动前后端服务：

```bash
# 安装所有依赖（首次运行需要）
npm run install:all

# 启动前后端服务
npm run dev
```

后端服务将运行在 `http://localhost:3210`，前端服务将运行在 `http://localhost:5273`（或其他可用端口）。

### 方式二：分别启动

#### 1. 安装后端依赖

```bash
# 进入后端目录
cd backend

# 安装依赖
npm install
```

#### 2. 启动后端服务

```bash
# 启动后端服务器
npm start
```

后端服务将运行在 `http://localhost:3210`。

#### 3. 安装前端依赖

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install
```

#### 4. 启动前端开发服务器

```bash
# 启动前端开发服务器
npm run dev
```

前端服务将运行在 `http://localhost:5273`（或其他可用端口）。

### 访问应用

打开浏览器，访问前端服务地址（如 `http://localhost:5273`）即可使用整个应用。

## API 接口

### 用户相关
- `POST /register` - 用户注册
- `POST /login` - 用户登录

### 文档相关
- `GET /docs?userId=1` - 获取指定用户的所有文档
- `GET /docs/:id?userId=1` - 获取指定用户的单个文档或公开文档
- `POST /docs` - 创建新文档（需要 userId）
- `PUT /docs/:id` - 更新文档（需要 userId）
- `DELETE /docs/:id` - 删除文档（需要 userId）
- `PUT /docs/:id/visibility` - 更新文档可见性

### 分享相关
- `POST /shares` - 创建/更新分享
- `GET /shares/:token` - 通过 token 获取分享的文档
- `GET /shares/doc/:docId` - 获取文档的所有分享
- `DELETE /shares/doc/:docId` - 删除分享

### 社区相关
- `GET /community/docs` - 获取公开文档列表

### 点赞相关
- `POST /docs/:id/like` - 点赞/取消点赞
- `GET /docs/:id/like/status` - 检查用户是否已点赞

### 通知相关
- `GET /notifications` - 获取用户通知
- `PUT /notifications/:id/read` - 标记通知为已读

### 管理员相关
- `GET /admin/docs` - 管理员获取所有文档

## 数据库结构

### 用户表 (users)
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    isAdmin INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 文档表 (docs)
```sql
CREATE TABLE docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    likes INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
);
```

### 分享表 (shares)
```sql
CREATE TABLE shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    docId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    permission TEXT NOT NULL DEFAULT 'read',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id)
);
```

### 点赞表 (likes)
```sql
CREATE TABLE likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    docId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(docId, userId),
    FOREIGN KEY (docId) REFERENCES docs(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id)
);
```

### 通知表 (notifications)
```sql
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    isRead INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id)
);
```

## 注意事项

- **安全**：本项目未实现密码加密存储，仅用于学习和演示
- **数据存储**：使用 SQLite 本地文件存储，适合小量数据
- **用户状态**：使用 localStorage 存储用户登录状态
- **协同编辑**：使用 Yjs 实现实时协同编辑功能
- **WebSocket**：使用 WebSocket 实现实时通信

## 项目特色

- **轻量级**：使用 SQLite 本地存储，无需额外数据库服务
- **功能完整**：包含文档编辑、分享、社区等核心功能
- **协同编辑**：支持多人实时编辑同一文档
- **响应式设计**：适配不同屏幕尺寸
- **易于部署**：前后端分离，部署简单

## 未来优化方向

- 实现密码加密存储
- 添加用户头像功能
- 增加文档搜索功能
- 实现文档版本历史
- 支持更多文件格式导入/导出
- 添加团队协作功能
- 优化性能和安全性
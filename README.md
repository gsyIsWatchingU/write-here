# WriteHere - 轻量级在线文档协作平台

一个类似语雀的轻量级线上文档编辑器，包含前后端与 SQLite 数据库，支持**个人文档管理、社区公开文档、分享链接、协作申请/审批、实时协同编辑**与**WebSocket 实时通知**。

## 项目启动方式

### 环境要求
- **Node.js**：建议 18+（本项目在 Node 20 上验证过）
- **包管理器**：推荐 `npm`（根目录提供一键脚本）

### 一键启动（推荐）
在项目根目录执行：

```bash
# 首次运行：安装根目录 + 前端 + 后端依赖
npm run install:all

# 同时启动前后端（concurrently）
npm run dev
```

- **后端**：`http://localhost:3210`
- **前端**：Vite dev server（控制台会输出端口，通常是 `http://localhost:5173` 附近）

### 分别启动（开发/调试更直观）

```bash
# 1) 启动后端
cd backend
npm install
npm run start

# 2) 启动前端（新开一个终端）
cd ../frontend
npm install
npm run dev
```

## 技术栈

### 前端
- **框架**：Vue 3（Composition API）
- **构建**：Vite
- **路由**：Vue Router 4
- **富文本编辑器**：TipTap 2（基于 ProseMirror）
- **协同编辑**：Yjs + y-websocket（多端实时同步、光标/在线成员）
- **样式**：原生 CSS（CSS 变量 + scoped）
- **其他**：Lowlight（代码块高亮）

### 后端
- **运行时**：Node.js
- **框架**：Express
- **数据库**：SQLite（本地文件 `db/docs.db`）
- **WebSocket**：
  - y-websocket：承载 Yjs 协同编辑同步
  - ws：承载通知 WebSocket（`/notifications`）
- **工具**：uuid（分享 token）

## 项目结构

```
write-here/
├── frontend/                 # 前端（Vue3 + Vite）
│   ├── src/
│   │   ├── components/       # 通用组件（如 EditorToolbar）
│   │   ├── router/           # 路由与鉴权守卫
│   │   ├── utils/            # api 封装、localStorage 用户态
│   │   └── views/            # 页面：Home/Community/Editor/SharedDoc/Admin/Login
│   ├── index.html
│   └── vite.config.js
├── backend/                  # 后端（Express + SQLite + WS）
│   ├── server.js             # 单文件服务：REST API + WS + DB 初始化/迁移
│   └── package.json
├── db/
│   └── docs.db               # SQLite 数据库文件
└── package.json              # 根目录一键脚本（dev / install:all）
```

## 项目重难点（值得学习的地方）

### 1）“协作申请 → 作者审批 → 权限生效”的闭环设计
- **协作表 `collaborations`** 通过 `status(pending/approved/rejected)` 管理状态流转，并用 `(docId, userId)` 唯一键保证同一人对同一文档只有一条协作关系。
- **再次申请**：当被拒绝后允许重新申请，会把原记录更新回 `pending`，避免重复插入导致唯一键冲突。

### 2）编辑权限与 UI 的强一致（避免“看得到就能改”）
这是在线文档系统最容易踩坑的点：**后端放行了读，但前端默认可编辑**就会造成越权编辑的错觉或数据写入失败。
- 本项目在编辑页统一计算 `isOwner/canEdit`：
  - **作者**：可见性、分享、保存、工具栏等编辑能力全量开放
  - **协作者（approved）**：允许编辑（协同模式）
  - **未获批准/无协作权限**：仅可读，且**隐藏编辑工具栏与可见性编辑入口**

### 3）两套 WebSocket 并存：协同编辑与通知互不干扰
- **`/ws`**：Yjs 协同编辑同步（多人实时编辑、光标、在线用户）
- **`/notifications`**：轻量通知通道（点赞/协作申请/审批结果等），前端用小红点/计数提升可见性

### 4）分享链接支持只读/可编辑两种模式
- 通过 `shares.token` 暴露外链，并在分享页根据 `permission(read/edit)`：
  - **只读**：编辑器不可编辑
  - **可编辑**：挂载 Yjs provider，进入协同编辑

---

### 备注
- **安全性**：当前为学习/演示项目，登录密码未做加密哈希；生产环境需补充加密、鉴权中间件、限流、CSRF/XSS 等。
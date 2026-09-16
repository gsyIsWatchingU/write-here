# Horizon Docs - 轻量级在线文档协作平台

一个类似语雀的轻量级线上文档编辑器，使用四站共用的邮箱账号并在本站直接登录，支持**个人文档管理、算法题面发布、Markdown 导入与标题识别、社区公开文档、分享链接、协作申请/审批、实时协同编辑、评论线程、点赞、@提及**与**WebSocket 实时通知**。

## 项目启动方式

### 环境要求
- **Node.js**：建议 18+（本项目在 Node 20 上验证过）
- **包管理器**：推荐 `npm`（根目录提供一键脚本）

### 本地前端开发

线上业务数据只保存在 GPU 服务器。首次本地开发时复制 `frontend/.env.example` 为 `frontend/.env.local`，把其中地址替换为当前 GPU 公网地址，然后执行：

在项目根目录执行：

```bash
# 首次运行：安装依赖
npm run install:all

# 只启动本地前端，REST 与 WebSocket 连接 GPU 后端
npm run dev
```

- **前端**：Vite dev server，默认 `http://localhost:5273`
- **后端与数据库**：仅在 GPU 服务器运行

## GPU 服务器部署

服务器部署脚本、验证命令和运行维护说明见 [`deploy/README.md`](deploy/README.md)。生产环境由 Node.js 在同一端口提供前端页面、REST API 与 WebSocket 服务。

## AI / MCP 接入

1. 登录网站，在“我的文档”点击“`[MCP] AI 接入`”，生成个人 Token。明文只展示一次，可随时撤销。
2. 在仓库根目录执行 `npm install --prefix mcp`。
3. 将以下配置加入支持 stdio MCP 的 AI 客户端，并替换路径、网站地址和 Token：

```json
{
  "mcpServers": {
    "horizon-docs": {
      "command": "node",
      "args": ["<仓库绝对路径>/mcp/src/index.js"],
      "env": {
        "HORIZON_DOCS_URL": "<Horizon Docs 公网地址>",
        "HORIZON_DOCS_TOKEN": "<个人 Token>"
      }
    }
  }
}
```

提供 `list_markdown_documents`、`get_markdown_document`、`create_markdown_document`、`update_markdown_document` 四个工具。新文档默认私密，Markdown 上限 2 MB；Token 只绑定当前用户，不保存账号密码。

普通文档地址使用 32 位随机哈希标识，不暴露递增数据库主键；旧数字地址仍可访问，并会自动替换为哈希地址。

## 语音输入（GPU ASR）

编辑器与可编辑分享页支持快捷键语音转写：

- 快捷键：**双击 `Ctrl`** 开始/停止录音（不用按住）；也可以**按住 `F2`** 说话，松开即转写；或者点击工具栏的麦克风按钮。
- 双击判定会把「按住 `Ctrl`」和 `Ctrl+C` 这类组合排除掉，不会误触发；转写结果插入光标处。
- 单次最长 60 秒，到时自动结束并转写；录音太短（不足 0.4 秒）或没听到内容时不会插入文本。
- 浏览器把麦克风采集为 16 kHz 单声道 PCM 并封装成 WAV，上传本站后端 `/asr/transcribe`；后端再转发给同机 GPU 上的 `Qwen3-ASR-1.7B`（vLLM 的 OpenAI 兼容 `/v1/audio/transcriptions`）。
- 音频只在内存里转发，不落盘、不记录转写内容；接口需要登录会话，未登录返回 401。
- 服务端可用环境变量覆盖：`ASR_URL`（默认 `http://127.0.0.1:8001`）、`ASR_MODEL`（默认 `qwen3-asr-1.7b`）、`ASR_API_KEY`、`ASR_TIMEOUT_MS`、`ASR_MAX_SECONDS`。
- 麦克风需要 HTTPS 或 localhost；公网站点已满足，本地开发请用 `http://localhost:5273`。

## 技术栈

### 前端
- **框架**：Vue 3（Composition API）
- **构建**：Vite
- **路由**：Vue Router 4
- **富文本编辑器**：TipTap 2（基于 ProseMirror）
- **协同编辑**：Yjs + y-websocket（多端实时同步、光标/在线成员）
- **样式**：原生 CSS（参考 CLI List 的极简像素主题）
- **其他**：Lowlight（代码块高亮）

### 后端
- **运行时**：Node.js
- **框架**：Express
- **数据库**：SQLite（GPU 服务器文件 `/workspace/projects/write-here/db/docs.db`）
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
│   │   └── views/            # 页面：文档、题库、编辑、嵌入阅读、社区与管理
│   ├── index.html
│   └── vite.config.js
├── backend/                  # 后端（Express + SQLite + WS）
│   ├── server.js             # 单文件服务：REST API + WS + DB 初始化/迁移
│   └── package.json
├── mcp/                      # stdio MCP 服务：将 AI 工具调用转为受 Token 保护的文档 API
├── db/                       # GPU 服务器运行时数据目录，不纳入 Git
└── package.json              # 根目录一键脚本（dev / install:all）
```

## 项目重难点（值得学习的地方）

### 1）“协作申请 → 作者审批 → 权限生效”的闭环设计
- **协作表 `collaborations`** 通过 `status(pending/approved/rejected)` 管理状态流转，并用 `(docId, userId)` 唯一键保证同一人对同一文档只有一条协作关系。
- **再次申请**：当被拒绝后允许重新申请，会把原记录更新回 `pending`，避免重复插入导致唯一键冲突。

### 2）编辑权限与 UI 的强一致（避免“看得到就能改”）
这是在线文档系统最容易踩坑的点：**后端放行了读，但前端默认可编辑**就会造成越权编辑的错觉或数据写入失败。
- 本项目在编辑页统一计算 `isOwner/canEdit`：
  - **作者**：可见性、分享、实时保存、工具栏等编辑能力全量开放
  - **协作者（approved）**：允许编辑（协同模式）
  - **未获批准/无协作权限**：仅可读，且**隐藏编辑工具栏与可见性编辑入口**

### 3）两套 WebSocket 并存：协同编辑与通知互不干扰
- **`/ws`**：Yjs 协同编辑同步（多人实时编辑、光标、在线用户）
- **`/notifications`**：轻量通知通道（点赞/协作申请/审批结果等），前端用小红点/计数提升可见性

### 4）飞书式评论与消息闭环
- 评论支持线程回复、点赞、解决/重新打开，以及 `@用户名` 提及。
- 文档作者、评论参与者和被提及人会收到实时通知；通知支持未读计数、一键已读、清理已读和跳转到对应评论。
- 私密文档评论沿用作者/协作者/分享令牌权限，不公开泄露讨论内容。

### 5）分享链接支持只读/可编辑两种模式
- 通过 `shares.token` 暴露外链，并在分享页根据 `permission(read/edit)`：
  - **只读**：编辑器不可编辑
  - **可编辑**：挂载 Yjs provider，进入协同编辑

### 6）WriteHere 作为算法题面内容源

- 在“题库”区域创建题目，编辑器仍复用现有 TipTap 与自动保存能力。
- “发布”会冻结标题和正文快照并递增版本；未发布修改不会影响算法训练网站。
- 发布后复制关联链接，Algorithm Lab 通过版本化 JSON API 校验内容，并以隔离 iframe 展示题面。
- 测试用例、代码模板、判题和训练记录仍由 Algorithm Lab 管理。

---

### 账号

- 登录和注册都在 Horizon Docs 页面内完成，后端调用统一账号 API。
- 仅支持邮箱注册，验证码 10 分钟有效；邮箱不可重复。
- 昵称可选，默认取邮箱 `@` 前部分；忘记密码通过注册邮箱重置。

### 备注
- **密码规则**：注册密码至少 8 位。
- **安全性**：新账号密码由统一账号中心哈希保存；Horizon Docs 不保存真实密码。生产环境仍需持续完善限流、CSRF/XSS 和安全监控。
- **保存方式**：编辑标题或正文后自动实时保存，无需手动点击保存。

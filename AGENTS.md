# 项目协作约定

## 项目定位

本仓库是轻量级在线文档协作平台，包含 Vue 3 前端、Node.js 后端和 SQLite 数据库。

## 开始任务时

1. 阅读 `README.md` 和 `docs/STATUS.md`。
2. 执行 `git status`，保留已有未提交修改。
3. 修改接口时同步检查前端调用、后端路由和权限判断。
4. 处理 `db/docs.db` 前先确认数据用途，不覆盖或合并未知数据库状态。

## 目录约定

- `frontend`：Vue 3、Vite、TipTap 和 Yjs 前端。
- `backend/server.js`：REST API、WebSocket、数据库初始化与迁移。
- `db/docs.db`：SQLite 数据文件，可能包含本地业务数据。

## 常用命令

```powershell
npm run install:all
npm run dev
npm --prefix frontend run build
node --check backend/server.js
```

安装依赖会访问网络；启动服务会读写本地数据库。验证时优先使用前端构建和后端语法检查。

## 安全要求

- 不提交 `.env`、令牌、密码或个人敏感数据。
- 不把当前演示级认证方案视为生产安全实现。
- 不提交 `node_modules`、`dist` 或编辑器配置。

## 交接要求

- 每次完成并验证改动后，自动提交当前任务相关改动；除非用户明确要求不提交。
- 离开当前电脑前更新 `docs/STATUS.md`，记录完成项、下一步、问题和验证结果。
- 提交并推送当前分支，确认远程分支包含最新提交。

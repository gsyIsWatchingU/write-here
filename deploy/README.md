# GPU 服务器部署

项目部署在 `/workspace/projects/write-here`，使用持久化 Node.js 运行时。启动脚本会自动识别 Supervisor；没有 Supervisor 时才使用 nohup：

```bash
bash deploy/start.sh
```

- 服务端口：`3210`
- 健康检查：`/health`
- 运行日志：`logs/server.log`
- 部署验证：`node deploy/verify.js`
- 停止服务：`bash deploy/stop.sh`

`db/docs.db` 是唯一业务数据库，只存在于 GPU 服务器运行目录，不纳入 Git，也不接受本机数据库覆盖。服务器或容器重启后，需要重新执行启动脚本。

## GitHub Actions 自动部署

推送或合并到 `main` 后，`.github/workflows/deploy.yml` 会自动执行：

1. 在 GitHub 公共 Runner 安装三套依赖，构建前端并检查后端语法。
2. 由 GPU 服务器上的自托管 Runner 获取只包含 Git 已跟踪文件的发布包。
3. 保留服务器的 `db/`、日志、运行目录和环境变量文件。
4. 重启 Supervisor 服务并执行服务器本机 HTTP、WebSocket 与 SQLite 验证。
5. 通过 Quick Tunnel 再次验证公网 HTTP、两条 WSS、SQLite 与 Supervisor，并把通过验证的 commit 写入 `run/deployed-commit`。

部署任务使用标签为 `write-here-gpu` 的仓库级自托管 Runner。Runner 安装在 `/workspace/.tools/actions-runner-write-here`，由 Supervisor 的 `github-actions-write-here` 进程守护；不需要向 GitHub 保存 GPU SSH 私钥。只有受信任的 `main` 分支代码可以进入部署任务。

Pull Request 只执行构建检查，不部署；只有 `main` 分支通过检查后才会更新服务器。可在 GitHub 的 `Actions → CI/CD → Run workflow` 手动重跑。

每次推送 `main` 后，必须等待流水线成功并核对线上版本：

```bash
git rev-parse HEAD
ssh mygpu "cat /workspace/projects/write-here/run/deployed-commit"
ssh mygpu "cd /workspace/projects/write-here && bash deploy/verify-public.sh"
ssh mygpu "supervisorctl -c /workspace/etc/supervisord.conf status github-actions-write-here"
```

前两个 commit 必须一致，公网验证必须全部通过；否则本次交付未完成。

## 公网访问

GPU 服务器使用与 `research-workbench` 相同的 Supervisor + Cloudflare Quick Tunnel 方案：

- 应用配置：`deploy/supervisor-app.conf`
- 隧道配置：`deploy/cloudflared-quick-tunnel.conf`
- 查看公网地址：`bash deploy/public-url.sh`
- 本地验证：`node deploy/verify.js`
- 公网验证：`bash deploy/verify-public.sh`

Quick Tunnel 地址在隧道或服务器重启后可能变化。需要固定地址时，应迁移到自有域名的 Cloudflare Named Tunnel。

也可以在本机建立 SSH 隧道：

```bash
ssh -N -L 3210:127.0.0.1:3210 mygpu
```

然后访问 `http://127.0.0.1:3210`。当前认证仍为演示实现，未完成密码哈希、会话鉴权和限流前，不应存放真实敏感文档。

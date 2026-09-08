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

`db/docs.db` 为服务器独立数据，不使用本机数据库覆盖。服务器或容器重启后，需要重新执行启动脚本。

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

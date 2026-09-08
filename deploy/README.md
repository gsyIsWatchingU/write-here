# GPU 服务器部署

项目部署在 `/workspace/projects/write-here`，使用持久化 Node.js 运行时：

```bash
bash deploy/start.sh
```

- 服务端口：`3210`
- 健康检查：`/health`
- 运行日志：`logs/server.log`
- 部署验证：`node deploy/verify.js`
- 停止服务：`bash deploy/stop.sh`

`db/docs.db` 为服务器独立数据，不使用本机数据库覆盖。服务器或容器重启后，需要重新执行启动脚本。

公网访问前，需要在 GPU 平台控制台映射或放行 `3210` 端口。尚未映射时，可在本机建立 SSH 隧道：

```bash
ssh -N -L 3210:127.0.0.1:3210 mygpu
```

然后访问 `http://127.0.0.1:3210`。当前认证仍为演示实现，未完成密码哈希、会话鉴权、限流和 HTTPS 前，不应存放真实敏感文档。

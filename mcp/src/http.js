import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer } from './index.js';

// 将 Horizon Docs MCP 服务暴露为 Streamable HTTP 端点，供 ChatGPT 等只支持
// 远程 MCP 的客户端连接（GPT 不能直连本地 stdio 进程）。
// 采用 stateless 模式（每请求新建 transport，官方推荐），复用同一个 McpServer；
// 由 backend 挂载到 /mcp/:secret，:secret 为访问密钥（MCP_HTTP_SECRET），
// 防止公网端点被任意使用；MCP 工具内部仍以 HORIZON_DOCS_TOKEN 鉴权后端 API。
export function createMcpHttpMiddleware(options = {}) {
  const mcpServer = createServer(options.serverOptions || {});

  return async function mcpHttpMiddleware(req, res, next) {
    try {
      if (options.secret && (!req.params || req.params.secret !== options.secret)) {
        return res.status(403).json({ error: 'MCP 访问密钥无效' });
      }

      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP HTTP 请求处理失败:', error);
      if (res.headersSent) res.end();
      else res.status(500).json({ error: error.message || String(error) });
    }
  };
}

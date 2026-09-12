import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'

test('stdio MCP 可完成握手、列出工具并创建 Markdown 文档', async (t) => {
  const requests = []
  const apiServer = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
    })
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 201
    res.end(JSON.stringify({
      id: 42,
      title: 'MCP 文档',
      markdown: '# 正文',
      visibility: 'private',
      url: 'https://docs.example.com/doc/42',
    }))
  })
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), 'src', 'index.js')],
    env: {
      ...getDefaultEnvironment(),
      HORIZON_DOCS_URL: `http://127.0.0.1:${apiServer.address().port}`,
      HORIZON_DOCS_TOKEN: 'whmcp_stdio_test',
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'horizon-docs-test', version: '1.0.0' })
  t.after(async () => {
    await client.close()
    await new Promise((resolve) => apiServer.close(resolve))
  })

  await client.connect(transport)
  const tools = await client.listTools()
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['create_markdown_document', 'get_markdown_document', 'list_markdown_documents', 'update_markdown_document'],
  )

  const call = await client.callTool({
    name: 'create_markdown_document',
    arguments: { title: 'MCP 文档', markdown: '# 正文', visibility: 'private' },
  })
  assert.equal(call.isError, undefined)
  assert.equal(call.structuredContent.result.id, 42)
  assert.deepEqual(requests[0], {
    method: 'POST',
    url: '/mcp-api/documents',
    authorization: 'Bearer whmcp_stdio_test',
    body: { title: 'MCP 文档', markdown: '# 正文', visibility: 'private' },
  })
})

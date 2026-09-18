import test from 'node:test'
import assert from 'node:assert/strict'
import { HorizonDocsClient } from './horizon-client.js'

test('HorizonDocsClient 携带个人 Token 调用文档接口', async () => {
  const calls = []
  const client = new HorizonDocsClient({
    baseUrl: 'https://docs.example.com/',
    token: 'whmcp_test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ id: 7, title: '测试' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const result = await client.createDocument({ title: '测试', markdown: '# 正文', visibility: 'private' })
  assert.equal(result.id, 7)
  assert.equal(calls[0].url, 'https://docs.example.com/mcp-api/documents')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer whmcp_test')
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: '测试', markdown: '# 正文', visibility: 'private' })
})

test('HorizonDocsClient 缺少 Token 时拒绝请求并传递接口错误', async () => {
  const missing = new HorizonDocsClient({ baseUrl: 'https://docs.example.com', token: '' })
  await assert.rejects(() => missing.listDocuments(), /缺少 HORIZON_DOCS_TOKEN/)

  const rejected = new HorizonDocsClient({
    baseUrl: 'https://docs.example.com',
    token: 'whmcp_bad',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'MCP Token 无效或已撤销' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  })
  await assert.rejects(() => rejected.getDocument(1), /MCP Token 无效或已撤销/)
})

test('HorizonDocsClient 支持检索、分段读取、局部修改和排序', async () => {
  const calls = []
  const client = new HorizonDocsClient({
    baseUrl: 'https://docs.example.com',
    token: 'whmcp_test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  await client.listDocuments(10, 'manual')
  await client.searchDocuments({ query: 'Agent MCP', visibility: 'private', limit: 5 })
  await client.readDocument(7, { startLine: 21, lineCount: 40 })
  await client.editDocument(7, { operation: 'replace', oldText: '旧内容', text: '新内容' })
  await client.moveDocument(7, { position: 'before', anchorDocumentId: 8 })

  assert.equal(calls[0].url, 'https://docs.example.com/mcp-api/documents?limit=10&sort=manual')
  assert.equal(calls[1].url, 'https://docs.example.com/mcp-api/documents/search?q=Agent+MCP&visibility=private&limit=5')
  assert.equal(calls[2].url, 'https://docs.example.com/mcp-api/documents/7/read?startLine=21&lineCount=40')
  assert.equal(calls[3].options.method, 'PATCH')
  assert.equal(calls[3].url, 'https://docs.example.com/mcp-api/documents/7/content')
  assert.deepEqual(JSON.parse(calls[3].options.body), { operation: 'replace', oldText: '旧内容', text: '新内容' })
  assert.equal(calls[4].options.method, 'PATCH')
  assert.equal(calls[4].url, 'https://docs.example.com/mcp-api/documents/7/order')
})

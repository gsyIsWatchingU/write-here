#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { HorizonDocsClient } from './horizon-client.js'

function result(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data },
  }
}

function failure(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  }
}

function withErrors(handler) {
  return async (input) => {
    try {
      return await handler(input)
    } catch (error) {
      return failure(error)
    }
  }
}

export function createServer(options = {}) {
  const client = options.client || new HorizonDocsClient({
    baseUrl: process.env.HORIZON_DOCS_URL,
    token: process.env.HORIZON_DOCS_TOKEN,
  })
  const server = new McpServer(
    { name: 'horizon-docs', version: '1.0.0' },
    {
      instructions: '用于管理当前 Token 所属用户的 Horizon Docs 普通文档。创建内容时默认使用 private；只有用户明确要求公开时才设置 public。',
    },
  )

  server.registerTool(
    'list_markdown_documents',
    {
      title: '列出 Horizon Docs 文档',
      description: '列出当前用户最近更新的普通文档，便于获得 documentId。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50).describe('返回数量，默认 50'),
      }),
    },
    withErrors(async ({ limit }) => result(await client.listDocuments(limit))),
  )

  server.registerTool(
    'get_markdown_document',
    {
      title: '读取 Horizon Docs 文档',
      description: '读取当前用户的一篇普通文档。MCP 创建的文档会返回 Markdown 原文；网页创建的旧文档可能只有 HTML。',
      inputSchema: z.object({
        documentId: z.number().int().positive().describe('文档 ID'),
      }),
    },
    withErrors(async ({ documentId }) => result(await client.getDocument(documentId))),
  )

  server.registerTool(
    'create_markdown_document',
    {
      title: '创建 Markdown 文档',
      description: '以当前 Token 所属用户身份，将 Markdown 创建为 Horizon Docs 普通文档。默认私密。',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200).describe('文档标题'),
        markdown: z.string().max(2 * 1024 * 1024).describe('Markdown 原文'),
        visibility: z.enum(['private', 'public']).default('private').describe('private 私密；public 公开'),
      }),
    },
    withErrors(async (input) => result(await client.createDocument(input))),
  )

  server.registerTool(
    'update_markdown_document',
    {
      title: '更新 Markdown 文档',
      description: '更新当前用户的一篇普通文档。只传需要修改的字段，不支持操作他人文档或题库内容。',
      inputSchema: z.object({
        documentId: z.number().int().positive().describe('文档 ID'),
        title: z.string().trim().min(1).max(200).optional().describe('新标题'),
        markdown: z.string().max(2 * 1024 * 1024).optional().describe('完整的新 Markdown 原文'),
        visibility: z.enum(['private', 'public']).optional().describe('新的可见性'),
      }).refine(
        ({ title, markdown, visibility }) => title !== undefined || markdown !== undefined || visibility !== undefined,
        { message: '至少提供 title、markdown 或 visibility 中的一项' },
      ),
    },
    withErrors(async ({ documentId, ...input }) => result(await client.updateDocument(documentId, input))),
  )

  return server
}

serveStdio(() => createServer())

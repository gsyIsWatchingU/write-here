#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { HorizonDocsClient } from './horizon-client.js'

const documentIdentifierSchema = z.union([
  z.string().regex(/^[a-f0-9]{32}$/),
  z.number().int().positive(),
]).describe('文档哈希；兼容旧数字 ID')

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
    { name: 'horizon-docs', version: '1.1.0' },
    {
      instructions: '用于查看、修改和整理当前 Token 所属用户的 Horizon Docs 普通文档。先检索或列出文档，再按需分段读取；局部修改优先使用 edit_markdown_document，并传入读取结果中的 updatedAt 防止覆盖并发更新。创建内容默认使用 private，只有用户明确要求公开时才设置 public。',
    },
  )

  server.registerTool(
    'list_markdown_documents',
    {
      title: '列出 Horizon Docs 文档',
      description: '列出当前用户的普通文档，返回用于后续操作的 documentId 哈希。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50).describe('返回数量，默认 50'),
        sort: z.enum(['updated', 'manual', 'title']).default('updated').describe('updated 最近更新；manual 手工顺序；title 标题'),
      }),
    },
    withErrors(async ({ limit, sort }) => result(await client.listDocuments(limit, sort))),
  )

  server.registerTool(
    'search_markdown_documents',
    {
      title: '搜索 Horizon Docs 文档',
      description: '按标题或正文关键词搜索当前用户的普通文档，返回命中摘要、Markdown 大纲和更新时间。',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(100).describe('要搜索的关键词'),
        visibility: z.enum(['all', 'private', 'public']).default('all').describe('可见性筛选'),
        limit: z.number().int().min(1).max(50).default(20).describe('返回数量，默认 20'),
      }),
    },
    withErrors(async (input) => result(await client.searchDocuments(input))),
  )

  server.registerTool(
    'get_markdown_document',
    {
      title: '读取 Horizon Docs 文档',
      description: '读取当前用户的一篇普通文档。MCP 创建的文档会返回 Markdown 原文；网页创建的旧文档可能只有 HTML。',
      inputSchema: z.object({
        documentId: documentIdentifierSchema,
      }),
    },
    withErrors(async ({ documentId }) => result(await client.getDocument(documentId))),
  )

  server.registerTool(
    'read_document_content',
    {
      title: '分段读取文档正文',
      description: '按行读取文档正文，并返回完整大纲、总行数、是否还有后续内容和 updatedAt。适合读取较长文档。',
      inputSchema: z.object({
        documentId: documentIdentifierSchema,
        startLine: z.number().int().positive().default(1).describe('起始行，从 1 开始'),
        lineCount: z.number().int().min(1).max(500).default(200).describe('读取行数，最多 500'),
      }),
    },
    withErrors(async ({ documentId, ...options }) => result(await client.readDocument(documentId, options))),
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
      description: '更新标题、可见性或完整 Markdown。仅修改局部正文时优先使用 edit_markdown_document，减少覆盖风险。',
      inputSchema: z.object({
        documentId: documentIdentifierSchema,
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

  server.registerTool(
    'edit_markdown_document',
    {
      title: '局部修改 Markdown 文档',
      description: '精确替换、追加或前置正文，不必重传整篇文档。建议把最近读取到的 updatedAt 作为 expectedUpdatedAt 传入。',
      inputSchema: z.object({
        documentId: documentIdentifierSchema,
        operation: z.enum(['replace', 'append', 'prepend']).describe('replace 精确替换；append 末尾追加；prepend 开头插入'),
        oldText: z.string().max(2 * 1024 * 1024).optional().describe('replace 时的原文；默认必须在文档中只出现一次'),
        text: z.string().max(2 * 1024 * 1024).default('').describe('替换后的文本或要追加、前置的文本；replace 时允许为空以删除原文'),
        replaceAll: z.boolean().default(false).describe('原文出现多次时是否全部替换'),
        expectedUpdatedAt: z.string().max(64).optional().describe('最近读取到的 updatedAt，用于阻止覆盖并发更新'),
      }).refine(
        ({ operation, oldText, text }) => operation === 'replace' ? Boolean(oldText) : Boolean(text),
        { message: 'replace 必须提供 oldText；append/prepend 必须提供非空 text' },
      ),
    },
    withErrors(async ({ documentId, ...input }) => result(await client.editDocument(documentId, input))),
  )

  server.registerTool(
    'move_markdown_document',
    {
      title: '调整文档顺序',
      description: '将一篇文档移动到列表开头、末尾，或另一篇文档前后；仅影响当前用户的普通文档顺序。',
      inputSchema: z.object({
        documentId: documentIdentifierSchema.describe('要移动的文档哈希'),
        position: z.enum(['first', 'last', 'before', 'after']).describe('目标位置'),
        anchorDocumentId: documentIdentifierSchema.optional().describe('position 为 before/after 时必填的锚点文档哈希'),
      }).refine(
        ({ documentId, position, anchorDocumentId }) => !['before', 'after'].includes(position)
          || (anchorDocumentId !== undefined && anchorDocumentId !== documentId),
        { message: 'before/after 必须提供另一个 anchorDocumentId' },
      ),
    },
    withErrors(async ({ documentId, ...input }) => result(await client.moveDocument(documentId, input))),
  )

  return server
}

serveStdio(() => createServer())

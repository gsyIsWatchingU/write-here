export class HorizonDocsClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = String(baseUrl || 'http://127.0.0.1:3210').replace(/\/$/, '')
    this.token = String(token || '').trim()
    this.fetchImpl = fetchImpl
  }

  async request(path, options = {}) {
    if (!this.token) throw new Error('缺少 HORIZON_DOCS_TOKEN，请先在网站生成 MCP Token')
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Horizon Docs 请求失败（HTTP ${response.status}）`)
    return data
  }

  listDocuments(limit = 50) {
    return this.request(`/mcp-api/documents?limit=${encodeURIComponent(limit)}`)
  }

  getDocument(id) {
    return this.request(`/mcp-api/documents/${id}`)
  }

  createDocument(input) {
    return this.request('/mcp-api/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  updateDocument(id, input) {
    return this.request(`/mcp-api/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }
}

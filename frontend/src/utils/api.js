const BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '')

// 用户主动退出后，在本次标签页会话里留一个标记：
// 登录页靠它区分「主动退出」与「首次访问」，避免用残留的服务端会话把用户弹回首页。
// 用 sessionStorage 而非 localStorage —— 关掉标签页就该失效。
const LOGOUT_FLAG = 'loggedOut'

export function markLoggedOut() {
  sessionStorage.setItem(LOGOUT_FLAG, '1')
}

export function consumeLoggedOutFlag() {
  const flagged = sessionStorage.getItem(LOGOUT_FLAG) === '1'
  sessionStorage.removeItem(LOGOUT_FLAG)
  return flagged
}

export function getWebSocketUrl(path) {
  const configuredBase = import.meta.env.VITE_WS_BASE_URL?.replace(/\/$/, '')
  if (configuredBase) return `${configuredBase}${path}`

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

export function getUser() {
  const raw = localStorage.getItem('currentUser')
  return raw ? JSON.parse(raw) : null
}

export function setUser(user) {
  localStorage.setItem('currentUser', JSON.stringify(user))
  sessionStorage.removeItem(LOGOUT_FLAG)
}

export async function clearUser() {
  // 本地凭据必须无条件清掉：即使 /logout 请求失败（离线、后端 500、代理断开），
  // 也不能让用户卡在「点了退出但还留在登录态」的状态里。
  localStorage.removeItem('currentUser')
  markLoggedOut()
  try {
    await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'include' })
  } catch (error) {
    // 服务端会话清理失败不阻塞退出；本地已登出，下次请求会因 401 重新引导登录。
    console.warn('退出登录时未能通知服务端，本地会话已清除。', error)
  }
}

async function request(path, options = {}) {
  const token = getUser()?.token
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export const api = {
  me: () => request('/me'),

  requestRegistrationCode: (email) =>
    request('/auth/register-code', { method: 'POST', body: JSON.stringify({ email }) }),

  register: (email, password, code, name) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, code, name }) }),

  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getDocs: (userId) =>
    request(`/docs?userId=${userId}`),

  searchDocs: (userId, q) =>
    request(`/docs/search?userId=${userId}&q=${encodeURIComponent(q)}`),

  getDoc: (id, userId) =>
    request(`/docs/${encodeURIComponent(id)}?userId=${userId}`),

  createDoc: (userId, title, content) =>
    request('/docs', { method: 'POST', body: JSON.stringify({ userId, title, content }) }),

  updateDoc: (id, userId, title, content) =>
    request(`/docs/${id}`, { method: 'PUT', body: JSON.stringify({ userId, title, content }) }),

  deleteDoc: (id, userId) =>
    request(`/docs/${id}?userId=${userId}`, { method: 'DELETE' }),

  reorderDocs: (userId, documentIds) =>
    request('/docs/order', { method: 'PUT', body: JSON.stringify({ userId, documentIds }) }),

  // MCP 接入：Token 只绑定当前登录用户，明文仅在创建时返回。
  getApiTokens: () =>
    request('/api-tokens'),

  createApiToken: (name) =>
    request('/api-tokens', { method: 'POST', body: JSON.stringify({ name }) }),

  revokeApiToken: (id) =>
    request(`/api-tokens/${id}`, { method: 'DELETE' }),

  // 题库相关：需要登录会话；公开题面仅凭不可猜测的关联令牌读取。
  getProblems: () =>
    request('/problem-items'),

  createProblem: (title = '无标题题目') =>
    request('/problem-items', { method: 'POST', body: JSON.stringify({ title }) }),

  publishProblem: (id) =>
    request(`/problem-items/${id}/publish`, { method: 'POST', body: '{}' }),

  unpublishProblem: (id) =>
    request(`/problem-items/${id}/unpublish`, { method: 'POST', body: '{}' }),

  getProblemContent: (id, token) =>
    request(`/problem-content/${id}?token=${encodeURIComponent(token)}`),

  // 分享相关
  createShare: (docId, userId, permission) =>
    request('/shares', { method: 'POST', body: JSON.stringify({ docId, userId, permission }) }),

  getShare: (token) =>
    request(`/shares/${token}`),

  deleteShare: (docId, userId) =>
    request(`/shares/doc/${docId}?userId=${userId}`, { method: 'DELETE' }),

  getDocShares: (docId, userId) =>
    request(`/shares/doc/${docId}?userId=${userId}`),

  // 管理员相关
  getAdminDocs: (userId) =>
    request(`/admin/docs?userId=${userId}`),

  // 社区相关
  getCommunityDocs: (sortBy) =>
    request(`/community/docs?sortBy=${sortBy}`),

  updateDocVisibility: (id, userId, visibility) =>
    request(`/docs/${id}/visibility`, { method: 'PUT', body: JSON.stringify({ userId, visibility }) }),

  // 点赞相关
  toggleLike: (id, userId) =>
    request(`/docs/${id}/like`, { method: 'POST', body: JSON.stringify({ userId }) }),

  checkLikeStatus: (id, userId) =>
    request(`/docs/${id}/like/status?userId=${userId}`),

  // 通知相关
  getNotifications: (userId) =>
    request(`/notifications?userId=${userId}`),

  markNotificationRead: (id, userId) =>
    request(`/notifications/${id}/read`, { method: 'PUT', body: JSON.stringify({ userId }) }),

  markAllNotificationsRead: (userId) =>
    request('/notifications/read-all', { method: 'PUT', body: JSON.stringify({ userId }) }),

  deleteReadNotifications: (userId) =>
    request(`/notifications/read?userId=${userId}`, { method: 'DELETE' }),

  // 协作相关
  requestCollaboration: (docId, userId) =>
    request('/collaborations', { method: 'POST', body: JSON.stringify({ docId, userId }) }),

  getCollaborationRequests: (userId) =>
    request(`/collaborations/requests?userId=${userId}`),

  respondToCollaboration: (id, userId, status) =>
    request(`/collaborations/${id}`, { method: 'PUT', body: JSON.stringify({ userId, status }) }),

  getDocCollaborators: (docId, userId) =>
    request(`/collaborations/doc/${docId}?userId=${userId}`),

  removeCollaborator: (id, userId) =>
    request(`/collaborations/${id}?userId=${userId}`, { method: 'DELETE' }),

  checkCollaborationAccess: (docId, userId) =>
    request(`/collaborations/check?docId=${docId}&userId=${userId}`),

  getCollaborationStatus: (docId, userId) =>
    request(`/collaborations/status?docId=${docId}&userId=${userId}`),

  getMyCollaborationDocs: (userId) =>
    request(`/collaborations/mydocs?userId=${userId}`),

  // 评论相关
  getDocComments: (docId, userId, shareToken = '') =>
    request(`/comments/doc/${docId}?userId=${userId || ''}&shareToken=${encodeURIComponent(shareToken)}`),

  addComment: (docId, userId, content, parentId = null, shareToken = '', anchor = null, replyToUserId = null) =>
    request('/comments', {
      method: 'POST',
      body: JSON.stringify({ docId, userId, content, parentId, shareToken, anchor, replyToUserId }),
    }),

  updateCommentAnchors: (docId, userId, anchors, shareToken = '') =>
    request('/comments/anchors', {
      method: 'PUT',
      body: JSON.stringify({ docId, userId, anchors, shareToken }),
    }),

  deleteComment: (id, userId) =>
    request(`/comments/${id}?userId=${userId}`, { method: 'DELETE' }),

  toggleCommentLike: (id, userId, shareToken = '') =>
    request(`/comments/${id}/like`, { method: 'POST', body: JSON.stringify({ userId, shareToken }) }),

  resolveComment: (id, userId, resolved) =>
    request(`/comments/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ userId, resolved }) }),

  // 语音转写：直接上传 16 kHz 单声道 WAV，由后端转发给 GPU 上的 ASR 服务
  transcribeAudio: async (wav) => {
    const res = await fetch(`${BASE}/asr/transcribe`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'audio/wav' },
      body: wav,
    })
    let data = {}
    try {
      data = await res.json()
    } catch (error) {
      data = {}
    }
    if (!res.ok) throw new Error(data.error || '语音转写失败')
    return data
  },

  // 文档插图：直接上传图片二进制，后端按内容寻址落盘并返回不可变 URL
  uploadImage: async (file, { width, height } = {}) => {
    const token = getUser()?.token
    const res = await fetch(`${BASE}/images/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type || 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(width ? { 'X-Image-Width': String(width) } : {}),
        ...(height ? { 'X-Image-Height': String(height) } : {}),
      },
      body: file,
    })
    let data = {}
    try {
      data = await res.json()
    } catch (error) {
      data = {}
    }
    if (!res.ok) throw new Error(data.error || '图片上传失败')
    return data
  },

  // AI 润色：后端调用本机 claude CLI 接入 GPU 模型 API，对整篇文档润色
  getAiPolishStatus: () =>
    request('/ai/polish/config'),

  polishDocument: (content, instruction) =>
    request('/ai/polish', { method: 'POST', body: JSON.stringify({ content, instruction }) }),
}

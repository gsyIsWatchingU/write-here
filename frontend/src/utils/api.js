const BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '')

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
}

export async function clearUser() {
  try {
    await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'include' })
  } finally {
    localStorage.removeItem('currentUser')
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

  getDoc: (id, userId) =>
    request(`/docs/${id}?userId=${userId}`),

  createDoc: (userId, title, content) =>
    request('/docs', { method: 'POST', body: JSON.stringify({ userId, title, content }) }),

  updateDoc: (id, userId, title, content) =>
    request(`/docs/${id}`, { method: 'PUT', body: JSON.stringify({ userId, title, content }) }),

  deleteDoc: (id, userId) =>
    request(`/docs/${id}?userId=${userId}`, { method: 'DELETE' }),

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
}

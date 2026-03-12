const BASE = 'http://localhost:3210'

export function getUser() {
  const raw = localStorage.getItem('currentUser')
  return raw ? JSON.parse(raw) : null
}

export function setUser(user) {
  localStorage.setItem('currentUser', JSON.stringify(user))
}

export function clearUser() {
  localStorage.removeItem('currentUser')
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

export const api = {
  register: (username, password) =>
    request('/register', { method: 'POST', body: JSON.stringify({ username, password }) }),

  login: (username, password) =>
    request('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

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
  getDocComments: (docId) =>
    request(`/comments/doc/${docId}`),

  addComment: (docId, userId, content) =>
    request('/comments', { method: 'POST', body: JSON.stringify({ docId, userId, content }) }),

  deleteComment: (id, userId) =>
    request(`/comments/${id}?userId=${userId}`, { method: 'DELETE' }),
}

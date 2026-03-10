const BASE = '/api'

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
}

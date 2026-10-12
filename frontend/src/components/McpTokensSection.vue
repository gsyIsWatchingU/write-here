<template>
  <div>
    <p class="mcp-help">Token 代表你的身份，只能管理你自己的普通文档。</p>

    <section class="mcp-section">
      <h4>1. 生成个人 Token</h4>
      <div class="mcp-create-row">
        <input v-model.trim="newTokenName" maxlength="60" placeholder="例如：Codex 桌面端" @keyup.enter="createMcpToken">
        <button class="icon-btn primary" :disabled="creatingToken || !newTokenName" title="生成 Token" aria-label="生成 Token" @click="createMcpToken">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </button>
      </div>
      <div v-if="generatedToken" class="mcp-token-once">
        <strong>请立即复制，关闭后无法再次查看明文：</strong>
        <div class="mcp-copy-row">
          <textarea :value="generatedToken" rows="2" readonly aria-label="新生成的 MCP Token"></textarea>
          <button class="icon-btn primary" title="复制 Token" aria-label="复制 Token" @click="copyMcpText(generatedToken, 'Token')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="0" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
    </section>

    <section class="mcp-section">
      <h4>2. 配置 MCP 客户端</h4>
      <p class="mcp-help">先在本仓库执行 <code>npm install --prefix mcp</code>，再把下面配置加入支持 stdio MCP 的 AI 客户端；将路径占位符替换为仓库绝对路径。</p>
      <div class="mcp-copy-row mcp-config-row">
        <textarea :value="mcpConfigSnippet" rows="11" wrap="soft" readonly aria-label="MCP 客户端配置"></textarea>
        <button class="icon-btn ghost" title="复制配置" aria-label="复制配置" @click="copyMcpText(mcpConfigSnippet, '配置')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="0" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
    </section>

    <section class="mcp-section">
      <div class="mcp-section-title">
        <h4>有效 Token</h4>
        <button class="icon-btn ghost" title="刷新列表" aria-label="刷新列表" @click="loadApiTokens">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
      <p v-if="loadingTokens" class="mcp-help">加载中...</p>
      <p v-else-if="apiTokens.length === 0" class="mcp-help">暂无有效 Token。</p>
      <div v-else class="mcp-token-list">
        <div v-for="token in apiTokens" :key="token.id" class="mcp-token-item">
          <div>
            <strong>{{ token.name }}</strong>
            <code>{{ token.prefix }}</code>
            <small>创建：{{ formatTime(token.createdAt) }} · 最近使用：{{ token.lastUsedAt ? formatTime(token.lastUsedAt) : '从未' }}</small>
          </div>
          <button class="icon-btn danger" title="撤销 Token" aria-label="撤销 Token" @click="revokeMcpToken(token)">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../utils/api'
import { formatServerDateTime } from '../utils/dateTime'

const apiTokens = ref([])
const loadingTokens = ref(false)
const creatingToken = ref(false)
const newTokenName = ref('Codex')
const generatedToken = ref('')

const mcpConfigSnippet = computed(() => JSON.stringify({
  mcpServers: {
    'horizon-docs': {
      command: 'node',
      args: ['<仓库绝对路径>/mcp/src/index.js'],
      env: {
        HORIZON_DOCS_URL: window.location.origin,
        HORIZON_DOCS_TOKEN: generatedToken.value || '<刚生成的 Token>',
      },
    },
  },
}, null, 2))

onMounted(loadApiTokens)

async function loadApiTokens() {
  loadingTokens.value = true
  try {
    apiTokens.value = await api.getApiTokens()
  } catch (e) {
    alert(e.message)
  } finally {
    loadingTokens.value = false
  }
}

async function createMcpToken() {
  if (!newTokenName.value || creatingToken.value) return
  creatingToken.value = true
  try {
    const created = await api.createApiToken(newTokenName.value)
    generatedToken.value = created.token
    newTokenName.value = 'Codex'
    await loadApiTokens()
  } catch (e) {
    alert(e.message)
  } finally {
    creatingToken.value = false
  }
}

async function revokeMcpToken(token) {
  if (!confirm(`确定撤销“${token.name}”吗？使用它的 AI 将立即失去访问权限。`)) return
  try {
    await api.revokeApiToken(token.id)
    await loadApiTokens()
  } catch (e) {
    alert(e.message)
  }
}

async function copyMcpText(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    alert(`${label} 已复制`)
  } catch {
    alert('复制失败，请手动复制')
  }
}

function formatTime(t) {
  return formatServerDateTime(t)
}
</script>

<style scoped>
/* Icon 按钮：与 SettingsEntry 保持一致的像素风方形图标按钮 */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 2px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 80ms steps(2, end), color 80ms steps(2, end), transform 80ms steps(2, end);
  flex: none;
}
.icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-hover);
}
.icon-btn:active:not(:disabled) {
  transform: translate(1px, 1px);
}
.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: square;
  stroke-linejoin: miter;
  flex: none;
}
.icon-btn.primary {
  border-color: var(--primary);
  color: var(--primary);
}
.icon-btn.primary:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
}
.icon-btn.danger {
  color: #c0392b;
  border-color: #c0392b;
}
.icon-btn.danger:hover:not(:disabled) {
  background: #fdf0ef;
  color: #a02f23;
}

.mcp-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.mcp-section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.mcp-section h4 {
  margin: 0;
}
.mcp-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.mcp-help {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  /* 弹窗内容区带 nowrap，help 显式恢复换行，MCP 文档链接等长 URL 断词折行，避免横向溢出 */
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.mcp-create-row,
.mcp-copy-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-top: 10px;
}
.mcp-create-row input,
.mcp-copy-row textarea {
  flex: 1;
}
.mcp-copy-row textarea {
  resize: vertical;
  word-break: break-all;
}
.mcp-token-once {
  margin-top: 12px;
  padding: 12px;
  background: var(--surface-hover);
  border: 2px solid var(--primary);
  font-size: 12px;
}
.mcp-config-row textarea {
  min-height: 210px;
  font-size: 12px;
}
.mcp-config-row {
  align-items: flex-start;
}
.mcp-token-list {
  margin-top: 10px;
  border: 1px solid var(--border);
}
.mcp-token-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.mcp-token-item:last-child {
  border-bottom: none;
}
.mcp-token-item > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.mcp-token-item code,
.mcp-token-item small {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .mcp-create-row,
  .mcp-copy-row {
    flex-direction: column;
  }
}
</style>

<template>
  <div>
    <p class="mcp-help">Token 代表你的身份，只能管理你自己的普通文档。</p>

    <section class="mcp-section">
      <h4>1. 生成个人 Token</h4>
      <div class="mcp-create-row">
        <input v-model.trim="newTokenName" maxlength="60" placeholder="例如：Codex 桌面端" @keyup.enter="createMcpToken">
        <button class="primary" :disabled="creatingToken || !newTokenName" @click="createMcpToken">
          {{ creatingToken ? '生成中...' : '生成 Token' }}
        </button>
      </div>
      <div v-if="generatedToken" class="mcp-token-once">
        <strong>请立即复制，关闭后无法再次查看明文：</strong>
        <div class="mcp-copy-row">
          <textarea :value="generatedToken" rows="2" readonly aria-label="新生成的 MCP Token"></textarea>
          <button class="primary" @click="copyMcpText(generatedToken, 'Token')">复制 Token</button>
        </div>
      </div>
    </section>

    <section class="mcp-section">
      <h4>2. 配置 MCP 客户端</h4>
      <p class="mcp-help">先在本仓库执行 <code>npm install --prefix mcp</code>，再把下面配置加入支持 stdio MCP 的 AI 客户端；将路径占位符替换为仓库绝对路径。</p>
      <div class="mcp-copy-row mcp-config-row">
        <textarea :value="mcpConfigSnippet" rows="11" wrap="off" readonly aria-label="MCP 客户端配置"></textarea>
        <button class="ghost" @click="copyMcpText(mcpConfigSnippet, '配置')">复制配置</button>
      </div>
    </section>

    <section class="mcp-section">
      <div class="mcp-section-title">
        <h4>有效 Token</h4>
        <button class="ghost small" @click="loadApiTokens">刷新</button>
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
          <button class="danger small" @click="revokeMcpToken(token)">撤销</button>
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

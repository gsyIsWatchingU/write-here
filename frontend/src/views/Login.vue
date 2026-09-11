<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="logo brand-logo">
        <img src="/horizon-docs.svg" alt="" aria-hidden="true">
        <span>Horizon Docs</span>
      </h1>
      <p class="subtitle">[ 极简协作文档工作台 ]</p>

      <div class="mode-tabs" role="tablist" aria-label="账号操作">
        <button type="button" :class="{ active: isLogin }" @click="switchMode(true)">登录</button>
        <button type="button" :class="{ active: !isLogin }" @click="switchMode(false)">注册</button>
      </div>

      <form class="login-form" @submit.prevent="handleSubmit">
        <label>
          <span>邮箱</span>
          <input v-model.trim="email" type="email" autocomplete="email" required autofocus>
        </label>
        <label v-if="!isLogin">
          <span>昵称（可选）</span>
          <input v-model.trim="name" type="text" maxlength="40" autocomplete="nickname" placeholder="默认使用邮箱 @ 前的名称">
        </label>
        <label v-if="!isLogin">
          <span>邮箱验证码</span>
          <span class="code-row">
            <input v-model="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required @input="normalizeCode">
            <button type="button" class="secondary code-button" :disabled="codePending" @click="sendCode">
              {{ codePending ? '发送中…' : '发送验证码' }}
            </button>
          </span>
        </label>
        <label>
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            :minlength="isLogin ? 1 : 8"
            :placeholder="isLogin ? '' : '至少 8 位'"
            required
          >
        </label>
        <p v-if="message" class="message">{{ message }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="primary submit-btn" :disabled="pending">
          {{ pending ? '处理中…' : isLogin ? '登录' : '注册并登录' }}
        </button>
      </form>

      <p v-if="isLogin" class="toggle"><a href="/auth/forgot-password">忘记密码</a></p>
      <p class="account-note">邮箱是四个网站共用的唯一账号</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setUser } from '../utils/api'

const router = useRouter()
const isLogin = ref(true)
const email = ref('')
const password = ref('')
const name = ref('')
const code = ref('')
const error = ref('')
const message = ref('')
const pending = ref(false)
const codePending = ref(false)

function switchMode(login) {
  isLogin.value = login
  error.value = ''
  message.value = ''
}

function normalizeCode(event) {
  code.value = event.target.value.replace(/\D/g, '').slice(0, 6)
}

async function sendCode() {
  if (!email.value) {
    error.value = '请先填写邮箱'
    return
  }
  codePending.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await api.requestRegistrationCode(email.value)
    message.value = result.message || '验证码已发送'
  } catch (e) {
    error.value = e.message
  } finally {
    codePending.value = false
  }
}

async function handleSubmit() {
  error.value = ''
  message.value = ''
  pending.value = true
  try {
    const user = isLogin.value
      ? await api.login(email.value, password.value)
      : await api.register(email.value, password.value, code.value, name.value || undefined)
    setUser(user)
    router.push('/')
  } catch (e) {
    error.value = e.message
  } finally {
    pending.value = false
  }
}

onMounted(async () => {
  try {
    const user = await api.me()
    setUser(user)
    router.replace('/')
  } catch {
    // 未登录时停留在当前页面。
  }
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-gray);
}
.login-card {
  width: 440px;
  max-width: 100%;
  padding: 42px 40px;
  background: var(--bg);
  border: 2px solid var(--border);
}
.logo {
  margin-bottom: 4px;
  color: var(--text);
  font-size: 28px;
  font-weight: 700;
  text-align: center;
}
.subtitle {
  margin-bottom: 26px;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}
.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 18px;
  border: 2px solid var(--border);
}
.mode-tabs button {
  min-height: 42px;
  border: 0;
  background: var(--bg);
}
.mode-tabs button + button { border-left: 2px solid var(--border); }
.mode-tabs button.active { background: var(--primary); font-weight: 700; }
.login-form { display: flex; flex-direction: column; gap: 15px; }
.login-form label { display: flex; flex-direction: column; gap: 7px; color: var(--text-secondary); font-size: 13px; }
.login-form input { width: 100%; min-height: 44px; }
.code-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.code-button { min-height: 44px; padding: 0 12px; white-space: nowrap; }
.submit-btn { width: 100%; min-height: 46px; justify-content: center; font-size: 15px; }
.message, .error { margin: 0; font-size: 13px; text-align: center; }
.message { color: var(--primary-strong); }
.error { color: var(--danger); }
.toggle, .account-note { margin: 15px 0 0; font-size: 13px; text-align: center; }
.toggle a { color: var(--primary-strong); }
.account-note { color: var(--text-muted); }

@media (max-width: 600px) {
  .login-card { padding: 34px 22px; }
  .code-row { grid-template-columns: 1fr; }
}
</style>

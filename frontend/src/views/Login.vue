<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="logo brand-logo">
        <img src="/horizon-docs.svg" alt="" aria-hidden="true">
        <span>Horizon Docs</span>
      </h1>
      <p class="subtitle">[ 极简协作文档工作台 ]</p>
      <form @submit.prevent="handleSubmit" class="login-form">
        <input v-model="username" type="text" placeholder="用户名" autofocus />
        <input
          v-model="password"
          type="password"
          :placeholder="isLogin ? '密码' : '密码（至少 6 位）'"
          :minlength="isLogin ? undefined : 6"
        />
        <button type="submit" class="primary submit-btn">{{ isLogin ? '登录' : '注册' }}</button>
      </form>
      <p class="toggle">
        {{ isLogin ? '还没有账号？' : '已有账号？' }}
        <a href="#" @click.prevent="isLogin = !isLogin">{{ isLogin ? '立即注册' : '立即登录' }}</a>
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setUser } from '../utils/api'

const router = useRouter()
const isLogin = ref(true)
const username = ref('')
const password = ref('')
const error = ref('')

async function handleSubmit() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = '请填写用户名和密码'
    return
  }
  if (!isLogin.value && password.value.length < 6) {
    error.value = '密码至少需要 6 位'
    return
  }
  try {
    if (isLogin.value) {
      const user = await api.login(username.value, password.value)
      setUser(user)
      router.push('/')
    } else {
      await api.register(username.value, password.value)
      error.value = ''
      isLogin.value = true
      alert('注册成功，请登录')
    }
  } catch (e) {
    error.value = e.message
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-gray);
}
.login-card {
  background: var(--bg);
  padding: 48px 40px;
  border: 2px solid var(--border);
  border-radius: 0;
  box-shadow: none;
  width: 400px;
  max-width: 90vw;
}
.logo {
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.subtitle {
  text-align: center;
  color: var(--text-muted);
  margin-bottom: 32px;
  font-size: 14px;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.submit-btn {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  justify-content: center;
}
.toggle {
  text-align: center;
  margin-top: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}
.toggle a {
  color: var(--primary);
  text-decoration: none;
}
.toggle a:hover {
  text-decoration: underline;
}
.error {
  text-align: center;
  color: var(--danger);
  margin-top: 12px;
  font-size: 14px;
}
</style>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="logo brand-logo">
        <img src="/horizon-docs.svg" alt="" aria-hidden="true">
        <span>Horizon Docs</span>
      </h1>
      <p class="subtitle">[ 极简协作文档工作台 ]</p>
      <div class="login-form">
        <button type="button" class="primary submit-btn" @click="startSso">使用统一账号登录</button>
      </div>
      <p class="toggle">
        首次使用可在统一账号中心直接注册
      </p>
      <p class="toggle"><a href="/auth/forgot-password">忘记密码</a></p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setUser } from '../utils/api'

const router = useRouter()
const error = ref('')

function startSso() {
  window.location.assign('/auth/sso/start')
}

onMounted(async () => {
  if (new URLSearchParams(window.location.search).get('error')) {
    error.value = '统一登录失败，请重试'
    return
  }
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
  background: var(--bg-gray);
}
.success-toast {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 1000;
  width: min(400px, calc(100vw - 32px));
  min-height: 82px;
  display: grid;
  grid-template-columns: 38px 1fr 28px;
  align-items: center;
  gap: 12px;
  padding: 14px 12px 17px 14px;
  overflow: hidden;
  color: var(--text);
  background: var(--bg);
  border: 2px solid var(--border);
  box-shadow: 6px 6px 0 var(--primary);
}
.success-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  color: var(--text);
  background: var(--primary);
  border: 2px solid var(--border);
  font-size: 20px;
  font-weight: 800;
}
.success-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.success-content strong {
  font-size: 15px;
  line-height: 1.4;
}
.success-content span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.toast-close {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  align-self: start;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  font-size: 22px;
  line-height: 1;
}
.toast-close:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.toast-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 4px;
  background: var(--primary-strong);
  transform-origin: left;
  animation: toast-progress 4s linear forwards;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 160ms steps(3, end), transform 160ms steps(3, end);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
@keyframes toast-progress {
  to { transform: scaleX(0); }
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

@media (max-width: 600px) {
  .success-toast {
    top: 16px;
    right: 16px;
    left: 16px;
    width: auto;
  }
}
</style>

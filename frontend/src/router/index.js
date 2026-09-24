import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/doc/:id',
    name: 'Editor',
    component: () => import('../views/Editor.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/problems',
    name: 'Problems',
    component: () => import('../views/Problems.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/embed/problems/:id',
    name: 'ProblemEmbed',
    component: () => import('../views/ProblemEmbed.vue')
  },
  {
    path: '/share/:token',
    name: 'SharedDoc',
    component: () => import('../views/SharedDoc.vue')
  },
  {
    path: '/community',
    name: 'Community',
    component: () => import('../views/Community.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/Admin.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  // tab/页面切换后回到页首：从长页面（如我的文档）切到短页面（如社区）时，
  // 若沿用旧滚动位置，新页面会先停在半截再被浏览器裁回顶部，看起来像跳动。
  // 浏览器前进/后退仍按 savedPosition 还原原位置。
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    return { top: 0 }
  }
})

router.beforeEach((to, from, next) => {
  const user = localStorage.getItem('currentUser')
  if (to.meta.requiresAuth && !user) {
    next('/login')
  } else {
    next()
  }
})

export default router

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Designer',
    component: () => import('@/views/Designer.vue'),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  const isAuthenticated = Boolean(authStore.accessToken);

  if (to.meta.requiresAuth && !isAuthenticated) {
    return '/login';
  }

  if (to.path === '/login' && isAuthenticated) {
    return '/';
  }

  return true;
});

export default router;

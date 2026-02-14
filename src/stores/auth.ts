import { defineStore } from 'pinia';
import { ref } from 'vue';
import { login as apiLogin, refreshToken as apiRefresh } from '@/api/auth';

export const useAuthStore = defineStore('auth', () => {
  // 从 localStorage 恢复 token：刷新页面后仍然保持登录态
  const accessToken = ref<string | null>(localStorage.getItem('accessToken'));
  const refreshToken = ref<string | null>(localStorage.getItem('refreshToken'));

  // 同时更新内存中的 token 和本地存储
  function setTokens(access: string, refresh: string) {
    accessToken.value = access;
    refreshToken.value = refresh;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }

  // 清空当前登录状态
  function clearTokens() {
    accessToken.value = null;
    refreshToken.value = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  // 调登录接口，成功后保存后端返回的 token
  async function login(username: string, password: string) {
    const res = await apiLogin(username, password);
    if (res.data?.accessToken && res.data?.refreshToken) {
      setTokens(res.data.accessToken, res.data.refreshToken);
      return true;
    }
    return false;
  }

  // 当 accessToken 过期时，尝试使用 refreshToken 换新 token
  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshToken.value) return null;

    try {
      const res = await apiRefresh(refreshToken.value);
      if (res.data?.accessToken) {
        // 刷新成功后只需要更新 accessToken
        accessToken.value = res.data.accessToken;
        localStorage.setItem('accessToken', res.data.accessToken);
        return res.data.accessToken;
      }
    } catch (error) {
      clearTokens();
      throw error;
    }

    clearTokens();
    return null;
  }

  return {
    accessToken,
    refreshToken,
    setTokens,
    clearTokens,
    login,
    refreshAccessToken,
  };
});

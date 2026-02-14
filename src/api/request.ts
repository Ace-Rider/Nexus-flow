import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth';

// 给请求配置额外加一个 _retry 标记，用来防止 401 无限重试
type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const request: AxiosInstance = axios.create({
  baseURL: process.env.VUE_APP_API_BASE || '/api',
  timeout: 15000,
});

// 是否正在刷新 token：同一时刻只允许一个请求负责刷新
let isRefreshing = false;

// 刷新期间失败请求的等待队列：
// 每一项都保存一个 Promise 的 resolve / reject
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}> = [];

// 刷新完成后，统一处理等待中的请求
const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((pending) => {
    if (error) {
      pending.reject(error);
    } else if (token) {
      pending.resolve(token);
    }
  });
  failedQueue = [];
};

request.interceptors.request.use(
  (config: RetryableRequestConfig) => {
    const authStore = useAuthStore();
    if (authStore.accessToken && config.headers) {
      // 请求前自动附加 Bearer Token
      config.headers.Authorization = `Bearer ${authStore.accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

request.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // 当前失败请求的原始配置，后面重发请求要靠它
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    // 如果当前失败的就是 refresh 接口本身，不要再递归刷新
    const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');

    // 不是可恢复的 401，直接把错误抛出去
    if (
      !originalRequest ||
      error.response?.status !== 401 ||
      originalRequest._retry ||
      isRefreshRequest
    ) {
      return Promise.reject(error);
    }

    // 标记为“已经重试过一次”，防止出现无限循环
    originalRequest._retry = true;
    const authStore = useAuthStore();

    if (isRefreshing) {
      // 已经有人在刷新 token：
      // 当前请求先进入等待队列，等刷新完成后再统一处理
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return request(originalRequest);
        })
        .catch((queueError) => Promise.reject(queueError));
    }

    isRefreshing = true;
    try {
      // 真正执行 refreshToken -> accessToken 的兑换
      const newToken = await authStore.refreshAccessToken();
      if (!newToken) {
        // 刷新失败：队列失败、清空登录态、跳回登录页
        processQueue(new Error('Refresh token failed'));
        authStore.clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      // 刷新成功：先唤醒等待队列，再重发当前失败请求
      processQueue(null, newToken);
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
      }
      return request(originalRequest);
    } catch (refreshError) {
      // 刷新过程抛错：所有排队请求失败，退出登录态
      processQueue(refreshError);
      authStore.clearTokens();
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default request;

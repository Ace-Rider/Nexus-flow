import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from '@/api/request';

// 拦截器只依赖 store 的三个成员，mock 掉即可，不拉起真实 Pinia。
// 注意 vi.mock 会被提升到文件顶部，工厂里引用的变量必须来自 vi.hoisted
const { mockAuthStore } = vi.hoisted(() => ({
  mockAuthStore: {
    accessToken: null as string | null,
    refreshAccessToken: vi.fn(),
    clearTokens: vi.fn(),
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

// adapter 收到的每次请求记录（url + Authorization），供断言注入与重发行为
type RecordedCall = { url: string; auth: string | null };
let calls: RecordedCall[] = [];

type MockResponse = { status: number; data?: unknown };

// 每个用例替换自己的应答脚本；status >= 400 时按 axios 语义 reject
let respond: (call: RecordedCall) => MockResponse = () => ({ status: 200 });

const buildError = (config: unknown, status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    config,
    isAxiosError: true,
    response: { status, data: {}, headers: {}, config },
  });

// 替换底层 adapter 模拟 HTTP：拦截器链（token 注入 / 401 刷新）全部真实执行
request.defaults.adapter = async (config) => {
  const url = config.url ?? '';
  const auth = config.headers
    ? ((config.headers.get('Authorization') as string | undefined) ?? null)
    : null;
  const record = { url, auth };
  calls.push(record);
  const result = respond(record);
  if (result.status >= 400) throw buildError(config, result.status);
  return {
    status: result.status,
    data: result.data ?? {},
    headers: {},
    config,
    statusText: 'OK',
  };
};

describe('request 拦截器', () => {
  beforeEach(() => {
    calls = [];
    respond = () => ({ status: 200, data: {} });
    mockAuthStore.accessToken = null;
    mockAuthStore.refreshAccessToken.mockReset();
    mockAuthStore.clearTokens.mockClear();
  });

  describe('请求拦截器', () => {
    it('已登录时自动附加 Bearer Token', async () => {
      mockAuthStore.accessToken = 'token-1';

      await request.get('/data');

      expect(calls[0].auth).toBe('Bearer token-1');
    });

    it('未登录时不附加 Authorization', async () => {
      await request.get('/data');

      expect(calls[0].auth).toBeNull();
    });
  });

  describe('401 无感刷新', () => {
    it('非 401 错误直接透传，不触发刷新', async () => {
      mockAuthStore.accessToken = 'old-token';
      respond = () => ({ status: 500 });

      await expect(request.get('/data')).rejects.toMatchObject({
        response: { status: 500 },
      });
      expect(mockAuthStore.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('401 后刷新成功：用新 token 重发原请求并返回重发结果', async () => {
      mockAuthStore.accessToken = 'old-token';
      // 模拟真实 store：刷新成功后 accessToken 同步更新，重发时拦截器注入的就是新 token
      mockAuthStore.refreshAccessToken.mockImplementation(async () => {
        mockAuthStore.accessToken = 'new-token';
        return 'new-token';
      });
      respond = ({ url, auth }) =>
        url === '/data' && auth === 'Bearer old-token'
          ? { status: 401 }
          : { status: 200, data: { ok: true } };

      const res = await request.get('/data');

      expect(res.data).toEqual({ ok: true });
      expect(mockAuthStore.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(2);
      expect(calls[1].auth).toBe('Bearer new-token');
    });

    it('并发 401：只刷新一次，其余请求排队等待后带新 token 重发', async () => {
      mockAuthStore.accessToken = 'old-token';
      // 刷新挂起，等三个请求的 401 都到达后再放行
      let resolveRefresh!: (token: string) => void;
      mockAuthStore.refreshAccessToken.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      respond = ({ url, auth }) =>
        url === '/data' && auth === 'Bearer old-token'
          ? { status: 401 }
          : { status: 200, data: { ok: true } };

      const pending = [request.get('/data'), request.get('/data'), request.get('/data')];
      await vi.waitFor(() => {
        // 三个请求都已被 adapter 处理（401），且只有第一个拿到了刷新权
        expect(calls).toHaveLength(3);
        expect(mockAuthStore.refreshAccessToken).toHaveBeenCalledTimes(1);
      });

      resolveRefresh('new-token');
      mockAuthStore.accessToken = 'new-token';

      const results = await Promise.all(pending);

      // 刷新仍然只有一次；三次重发全部成功且携带新 token
      expect(mockAuthStore.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(6);
      expect(calls.slice(3).every((call) => call.auth === 'Bearer new-token')).toBe(true);
      results.forEach((res) => expect(res.data).toEqual({ ok: true }));
    });

    it('刷新失败：排队请求全部拒绝并清空登录态', async () => {
      mockAuthStore.accessToken = 'old-token';
      mockAuthStore.refreshAccessToken.mockResolvedValue(null);
      respond = ({ url, auth }) =>
        url === '/data' && auth === 'Bearer old-token' ? { status: 401 } : { status: 200 };

      const results = await Promise.allSettled([
        request.get('/data'),
        request.get('/data'),
      ]);

      expect(mockAuthStore.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockAuthStore.clearTokens).toHaveBeenCalled();
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
    });

    it('刷新接口自身 401：不递归刷新，直接拒绝', async () => {
      respond = () => ({ status: 401 });

      await expect(request.post('/auth/refresh', {})).rejects.toMatchObject({
        response: { status: 401 },
      });
      expect(mockAuthStore.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('重发后仍 401：_retry 防死循环，只刷新一次后透传错误', async () => {
      mockAuthStore.accessToken = 'old-token';
      mockAuthStore.refreshAccessToken.mockResolvedValue('new-token');
      respond = ({ url }) => (url === '/data' ? { status: 401 } : { status: 200 });

      await expect(request.get('/data')).rejects.toMatchObject({
        response: { status: 401 },
      });

      // 原始一次 + 重发一次；重发的 401 因 _retry 标记直接透传
      expect(calls).toHaveLength(2);
      expect(mockAuthStore.refreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });
});

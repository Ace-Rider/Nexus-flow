import { defineConfig, devices } from '@playwright/test';

// E2E 测试配置：
// - 本地复用已在运行的 dev / mock 服务（避免端口冲突），CI 环境全新启动
// - mock 以 --reset 启动：每次 CI 运行都从干净的默认数据开始
// - 串行执行（workers: 1）：所有用例共享同一个 mock 服务，避免流程数据互相干扰
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // list 负责控制台输出，html 负责生成 playwright-report/ 目录：
  // CI 失败时的 artifact 上传依赖该目录，只用 list 时目录不会生成
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node mock-server.js --reset',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:8080',
      reuseExistingServer: !process.env.CI,
    },
  ],
});

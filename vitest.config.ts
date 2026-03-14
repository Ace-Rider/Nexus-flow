import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest 单测配置：与 vite.config.ts 保持相同的 @ 别名，
// happy-dom 提供 localStorage / window 等浏览器能力
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});

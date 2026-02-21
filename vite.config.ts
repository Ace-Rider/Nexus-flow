import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// Vite 配置：取代原 vue.config.js（webpack）
export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板里用到的 <el-*> 组件由插件自动注册并引入对应样式
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // mock 服务地址
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 只拆出 LogicFlow：体积大且几乎不随业务变更，独立 chunk 利于浏览器长期缓存。
        // element-plus 保持默认（与业务代码同 chunk）：实测拆出会破坏按需 tree-shaking，总体积反而膨胀
        manualChunks(id) {
          if (id.includes('@logicflow')) return 'logicflow';
          return undefined;
        },
      },
    },
  },
});

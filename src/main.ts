import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';
// Element Plus 改为按需引入（模板组件见 vue.config.js 中的 unplugin-vue-components 配置），
// 这里补上脚本中直接调用的 ElMessage / ElMessageBox 的样式
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
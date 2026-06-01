# Nexus Flow · 可视化流程编排引擎

## 📂 完整项目结构

```
nexus-flow/
│
├── public/                          # 静态资源（原样复制到构建输出）
│   ├── index.html                  # 应用 HTML 入口
│   └── worker.js                   # Web Worker（处理布局计算）
│
├── src/                            # 源代码目录
│   ├── api/                        # API 层
│   │   ├── auth.ts                # 认证相关 API 接口
│   │   └── request.ts             # Axios 实例封装（拦截器）
│   │
│   ├── assets/                     # 静态资源
│   │   └── main.css               # 全局样式
│   │
│   ├── components/                 # Vue 组件
│   │   └── FlowDesigner.vue       # 核心：流程设计器画布组件
│   │
│   ├── router/                     # 路由配置
│   │   └── index.ts              # 路由定义 + 导航守卫
│   │
│   ├── stores/                     # Pinia 状态管理
│   │   └── auth.ts               # 认证状态（Token 管理）
│   │
│   ├── utils/                      # 工具函数
│   │   └── performance.ts        # 性能优化工具（Worker 调度）
│   │
│   ├── views/                      # 页面组件
│   │   ├── Login.vue             # 登录页面
│   │   └── Designer.vue          # 流程设计主页面
│   │
│   ├── App.vue                    # 根组件
│   ├── main.ts                    # 应用入口
│   └── shims-vue.d.ts            # Vue 模块声明
│
├── .env.development.ts            # 开发环境变量
├── mock-server.js                 # Express Mock 服务器
├── package.json                   # 项目依赖配置
├── tsconfig.json                  # TypeScript 配置
└── vue.config.js                 # Vue CLI 配置
```

---

## 🏗️ 核心模块说明

### 1️⃣ FlowDesigner.vue（核心画布组件）

**文件位置**: `src/components/FlowDesigner.vue`

**职责**: 封装 LogicFlow 流程引擎，提供可视化流程设计能力

**核心功能**:
- 初始化 LogicFlow 实例
- 注册插件（SelectionSelect、Snapline、History）
- 管理节点和边的渲染
- 提供 undo/redo 能力
- 暴露导出/导入 JSON 方法

**关键技术**:
```typescript
// 注册插件
LogicFlow.use(SelectionSelect);  // 框选
LogicFlow.use(Snapline);         // 对齐辅助线
LogicFlow.use(History);          // 历史记录

// 暴露方法给父组件
defineExpose({ undo, redo, getGraphData, setGraphData, exportData, importData });
```

---

### 2️⃣ Designer.vue（设计器主页面）

**文件位置**: `src/views/Designer.vue`

**职责**: 流程设计器的业务层，协调 UI 和数据

**核心功能**:
- 工具栏（撤销/重做/导入/导出/智能布局/保存）
- 加载和保存流程数据
- 调用 Web Worker 执行智能布局
- 管理 FlowDesigner 子组件

**核心方法**:
- `handleSmartLayout()` - 调用 Worker 计算新布局
- `saveFlow()` / `loadFlow()` - 持久化流程数据

---

### 3️⃣ auth.ts（认证状态管理）

**文件位置**: `src/stores/auth.ts`

**职责**: 管理用户认证状态和 Token

**核心功能**:
- 存储 accessToken 和 refreshToken
- 提供登录方法
- 提供 Token 自动刷新方法

**核心逻辑**:
```typescript
// Token 存储在 localStorage 实现持久化
const accessToken = ref<string | null>(localStorage.getItem('accessToken'));
const refreshToken = ref<string | null>(localStorage.getItem('refreshToken'));
```

---

### 4️⃣ request.ts（Axios 封装）

**文件位置**: `src/api/request.ts`

**职责**: HTTP 请求的统一封装和拦截处理

**核心功能**:
- 请求拦截：自动注入 Authorization Header
- 响应拦截：处理 401 未授权，自动刷新 Token
- 刷新 Token 队列管理：避免并发刷新

**关键机制**:
```typescript
// 标记是否正在刷新 Token
let isRefreshing = false;
// 存储等待 Token 的请求
let failedQueue: Array<{ resolve, reject }>[];

// 401 时自动刷新 Token
if (error.response?.status === 401) {
    // 排队等待或发起刷新请求
}
```

---

### 5️⃣ performance.ts（性能优化工具）

**文件位置**: `src/utils/performance.ts`

**职责**: 性能优化相关工具函数

**核心功能**:
- `measureLatency()` - 测量函数执行耗时
- `runLayoutInWorker()` - 将密集计算分发到 Web Worker

**Worker 通信机制**:
```typescript
const worker = new Worker('/worker.js');
worker.postMessage({ type: 'LAYOUT', data: { nodes, width, height } });
worker.onmessage = (e) => {
    if (e.data.type === 'LAYOUT_RESULT') {
        resolve(e.data.data);  // 接收计算结果
        worker.terminate();    // 销毁 Worker
    }
};
```

---

### 6️⃣ worker.js（Web Worker）

**文件位置**: `public/worker.js`

**职责**: 在独立线程执行布局算法，不阻塞主线程

**算法**: 简化的网格布局
```javascript
const cols = Math.ceil(Math.sqrt(nodes.length));
const row = Math.floor(idx / cols);
const col = idx % cols;
const cellW = width / (cols + 1);
const cellH = height / (cols + 1);
```

---

### 7️⃣ router/index.ts（路由配置）

**文件位置**: `src/router/index.ts`

**职责**: 路由管理和导航守卫

**路由表**:

| 路径 | 组件 | 需要认证 |
|------|------|----------|
| `/login` | Login.vue | ❌ |
| `/` | Designer.vue | ✅ |

**导航守卫逻辑**:
```typescript
// 未登录访问需认证页面 → 重定向到 /login
// 已登录访问登录页 → 重定向到 /
if (to.meta.requiresAuth && !isAuthenticated) {
    next('/login');
}
```

---

### 8️⃣ Login.vue（登录页面）

**文件位置**: `src/views/Login.vue`

**职责**: 用户登录界面

**功能**:
- 表单验证（用户名、密码必填）
- 调用 authStore.login() 进行认证
- 演示模式：任意账号都可登录

---

### 9️⃣ mock-server.js（Mock 服务器）

**文件位置**: `mock-server.js`

**职责**: 模拟后端 API 服务

**接口**:

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 Token |
| POST | `/api/auth/refresh` | 刷新 Token |
| GET | `/api/flows/:id` | 获取流程数据 |
| POST | `/api/flows/:id` | 保存流程数据 |

---

## 🔗 模块依赖关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.vue                                  │
│                           │                                      │
│                           ▼                                      │
│                    router/index.ts                               │
│                     (导航守卫)                                    │
│                    ┌────┴────┐                                   │
│                    ▼         ▼                                   │
│              ┌────────┐  ┌────────┐                              │
│              │ Login  │  │Designer│                              │
│              │.vue    │  │.vue    │                              │
│              └────────┘  └────┬───┘                              │
│                               │                                   │
│                    ┌──────────▼──────────┐                       │
│                    │   FlowDesigner.vue  │                       │
│                    │   (LogicFlow 封装)   │                       │
│                    └──────────┬──────────┘                       │
│                               │                                   │
│         ┌────────────────────┼────────────────────┐              │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│   ┌───────────┐      ┌────────────┐       ┌────────────┐         │
│   │ auth.ts   │      │performance │       │   api/     │         │
│   │ (状态)    │      │    .ts     │       │  request   │         │
│   └─────┬─────┘      └─────┬──────┘       └─────┬──────┘         │
│         │                  │                    │                │
│         ▼                  ▼                    ▼                │
│   ┌───────────┐      ┌───────────┐       ┌───────────┐         │
│   │localStorage│      │ worker.js │       │ axios     │         │
│   └───────────┘      └───────────┘       └─────┬─────┘         │
│                                                  │                │
│                                                  ▼                │
│                                          ┌───────────────┐        │
│                                          │ mock-server   │        │
│                                          │ (port 3000)   │        │
│                                          └───────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 技术栈总结

| 层级 | 技术 | 说明 |
|------|------|------|
| **框架** | Vue 3 | 组合式 API (Composition API) |
| **语言** | TypeScript | 强类型，提升代码质量 |
| **路由** | Vue Router 4 | 官方路由解决方案 |
| **状态** | Pinia | 轻量级状态管理 |
| **UI** | Element Plus | Vue 3 组件库 |
| **流程引擎** | @logicflow/core | 流程图可视化引擎 |
| **HTTP** | Axios | HTTP 请求库 |
| **构建** | Vue CLI 5 | 项目脚手架 |
| **后端** | Express 5 | Mock 服务器 |

---

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run serve
```

### 启动 Mock 服务器（另一个终端）

```bash
node mock-server.js
```

### 访问应用

打开浏览器访问 http://localhost:8080

---

## ⚠️ 已知问题

### 1. ESLint 配置问题
ESLint 配置文件可能缺失或损坏，导致 lint 检查失败。

### 2. graph:transform 事件误用
`FlowDesigner.vue` 中使用 `graph:transform` 事件进行数据同步，该事件在画布平移/缩放时也会触发，可能导致性能问题。

### 3. Token 刷新竞态条件
在 `request.ts` 中，当 Token 刷新失败时，等待队列中的请求处理逻辑存在潜在问题。

### 4. 大量使用 `any` 类型
多处使用 `any` 类型，降低了 TypeScript 的类型安全性。

### 5. Web Worker 路径问题
生产环境部署时，`/worker.js` 路径可能无法正确解析。

---

## 📝 License

Private Project - All Rights Reserved

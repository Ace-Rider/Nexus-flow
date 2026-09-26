# Nexus Flow

一个基于 `Vue 3 + TypeScript + LogicFlow 2.x` 的可视化流程设计器项目。
当前版本支持多流程工作台、流程绘制、节点缩放、批量编辑、智能布局、属性编辑、流程校验、草稿自动保存、版本管理、JSON/PNG 导入导出和快捷键操作。

## 项目定位

这个项目不是单纯“展示一张流程图”，而是实现一个可编辑、可保存、可校验的前端流程设计器。

它目前覆盖了一个小型流程编排工具的核心链路：

- 登录鉴权与路由守卫
- 多流程工作台（新建 / 切换 / 重命名 / 删除）
- 画布绘制与流程编辑
- 节点 / 边属性编辑与批量编辑
- 智能布局与边路线优化
- 流程结构校验
- 本地草稿自动保存与恢复
- 版本管理与历史恢复
- JSON / PNG 导入导出
- Mock 后端读写流程数据

## 技术栈

| 分类       | 技术                                  |
| ---------- | ------------------------------------- |
| 前端框架   | Vue 3                                 |
| 开发语言   | TypeScript                            |
| 构建工具   | Vite 7                                |
| 路由       | Vue Router 4                          |
| 状态管理   | Pinia                                 |
| UI 组件库  | Element Plus（unplugin 自动按需引入） |
| 流程图引擎 | LogicFlow 2.x                         |
| 布局算法   | dagre（分层布局，Worker 后台计算）    |
| 请求库     | Axios                                 |
| Mock 服务  | Express                               |
| 单元测试   | Vitest + happy-dom                    |
| E2E 测试   | Playwright                            |

## 当前功能

### 画布编辑

- 新增矩形节点
- 新增条件节点
- 节点拖拽
- 节点连线
- 节点缩放（拖拽四角控制点，LogicFlow 2.x 内置 Resize）
- 框选多个节点或边
- 删除选中元素
- 撤销 / 重做
- 小地图导航（MiniMap）

### 工作台

- 多流程管理：新建、切换、重命名、删除
- 切换 / 新建前检测未保存修改，弹确认框防误丢
- 节点 / 连线数量实时统计

### 流程能力

- 智能布局
- 边路径二次优化
- 流程结构校验
- 节点 / 边更完整的业务字段编辑
- 多选批量编辑（统一设置审批人、批量切换节点类型）
- 本地草稿自动保存与恢复

### 数据能力

- 导入 JSON（带结构校验，坏数据不会进画布）
- 导出 JSON
- 导出 PNG
- Mock 后端读取流程
- Mock 后端保存流程（持久化到 `mock-data.json`）

### 交互增强

- `Delete` / `Backspace` 删除选中元素
- `Ctrl/Cmd + A` 全选画布内容
- `Ctrl/Cmd + Z` 撤销
- `Ctrl/Cmd + Y` 重做
- `Ctrl/Cmd + Shift + Z` 重做

## 目录结构

```text
nexus-flow/
├─ .github/workflows/
│  └─ ci.yml              # CI：单测 + E2E + 类型检查构建
├─ e2e/
│  └─ designer.spec.ts    # Playwright E2E 用例
├─ src/
│  ├─ api/
│  │  ├─ auth.ts
│  │  └─ request.ts
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ FlowDesigner.vue   # 画布层
│  │  └─ PropertyPanel.vue  # 属性面板（单选 + 批量编辑）
│  ├─ composables/
│  │  ├─ useFlowDraft.ts       # 草稿自动保存 / 恢复
│  │  ├─ useFlowVersions.ts    # 版本快照 / 历史恢复
│  │  └─ useWorkspaceFlows.ts  # 工作台流程列表管理
│  ├─ router/
│  │  └─ index.ts
│  ├─ stores/
│  │  └─ auth.ts
│  ├─ types/
│  │  └─ flow.ts           # 共享强类型定义
│  ├─ utils/
│  │  ├─ edgeRouting.ts    # 折线二次路由纯函数
│  │  ├─ flowValidation.ts # 流程结构校验
│  │  ├─ layout.ts         # dagre 智能布局纯函数
│  │  ├─ performance.ts    # Worker 布局调度
│  │  ├─ storageKeys.ts    # localStorage 键名收口
│  │  └─ version.ts        # 版本管理工具
│  ├─ views/
│  │  ├─ Designer.vue      # 业务层
│  │  └─ Login.vue
│  ├─ workers/
│  │  └─ layoutWorker.ts   # 智能布局 Web Worker 入口
│  ├─ App.vue
│  ├─ main.ts
│  └─ shims-vue.d.ts
├─ mock-server.js          # Mock 服务（Express，数据持久化到 mock-data.json）
├─ playwright.config.ts
├─ vite.config.ts
├─ vitest.config.ts
├─ package.json
├─ tsconfig.json
└─ README.md
```

## 核心模块说明

### `src/views/Designer.vue`

设计器主页面，负责页面级业务编排，具体逻辑拆分到 composables：

- 工具栏按钮交互
- 流程加载与保存
- 流程校验
- 属性面板状态管理
- 智能布局调用
- JSON / PNG 导入导出

它是整个项目的“业务层”。

### `src/composables/`

从 Designer.vue 拆出的业务逻辑单元：

- `useFlowDraft`：草稿自动保存、恢复、未保存修改检测
- `useFlowVersions`：版本快照、历史列表、恢复（恢复前自动备份当前内容）
- `useWorkspaceFlows`：流程列表、新建 / 切换 / 重命名 / 删除

### `src/components/FlowDesigner.vue`

对 `LogicFlow` 的封装，是画布核心组件：

- 初始化 LogicFlow 实例（含框选、小地图插件，节点缩放）
- 监听节点、边、历史记录、选区变化
- 暴露新增、删除、导入导出、布局应用、批量更新等方法
- 同步当前选中元素
- 提供 PNG 导出能力

它是整个项目的“画布层”。

### `src/components/PropertyPanel.vue`

右侧属性面板组件：

- 单选时根据选中元素类型显示节点 / 边表单
- 多选时切换为批量编辑表单（统一设置审批人、批量切换节点类型）
- 将输入中的表单值同步给父组件
- 点击“应用修改 / 批量应用”后由父组件统一写回画布

### `src/utils/flowValidation.ts`

流程结构校验，与画布解耦，可独立测试。

### `src/utils/performance.ts`

性能优化和 Worker 调度：

- `runLayoutInWorker()` 把布局计算交给 Web Worker
- 避免大图布局时阻塞主线程

### `src/utils/version.ts`

流程版本管理：

- 保存当前流程快照
- 读取和删除历史版本
- 限制版本数量，避免本地存储无限增长

### `src/utils/layout.ts`

智能布局的纯函数实现，内部基于 dagre 分层布局：

- 无有效连线时退化为居中网格布局
- 自动过滤无效边和自环
- 计算结果整体居中，并夹在画布边界内

### `src/workers/layoutWorker.ts`

布局 Web Worker 入口，由 Vite 打包成独立产物：

- 只做消息协议包装（`LAYOUT` / `LAYOUT_RESULT`）
- 真正的布局计算复用 `layout.ts` 的纯函数

### `src/api/request.ts`

Axios 请求封装：

- 自动注入 token
- 统一处理 401
- refresh token 队列化处理

### `src/stores/auth.ts`

Pinia 鉴权状态：

- 维护 `accessToken`
- 维护 `refreshToken`
- 提供登录与刷新 token 能力

## 关键交互链路

### 1. 点击节点后，属性面板如何联动

```text
点击节点
-> LogicFlow 触发 node:click
-> FlowDesigner.vue 发出 selection-change
-> Designer.vue 执行 onSelectionChange
-> 更新 selectedElement 和 propertyForm
-> PropertyPanel.vue 根据当前数据渲染对应表单
```

### 2. 点击“应用修改”后，如何写回节点/边

```text
点击应用修改
-> PropertyPanel.vue 发出 apply
-> Designer.vue 执行 applyPropertyChanges
-> 通过 designerRef 调用 FlowDesigner 暴露的方法
-> FlowDesigner.vue 调用 lf.updateText / lf.setProperties
-> refreshState()
-> emitSelectionChange(...)
-> 画布数据和当前表单一起同步更新
```

### 3. 智能布局链路

```text
点击智能布局
-> Designer.vue 获取当前图数据
-> 调用 runLayoutInWorker()
-> layoutWorker 在后台线程用 dagre 计算新的节点坐标
-> FlowDesigner.vue 应用节点位置
-> 再执行边路径优化
-> fitView 展示整张图
```

## 流程校验规则

当前已经实现的基础校验包括：

- 空流程校验
- 坏连线校验
- 起点缺失校验
- 终点缺失校验
- 孤立节点校验
- 图不连通校验

校验入口有两个：

- 工具栏手动点击“校验流程”
- 点击“保存流程”前自动校验

## 属性面板支持字段

### 节点（单选）

- 名称：`text`
- 审批人：`properties.assignee`
- 描述：`properties.description`
- 超时时间：`properties.timeoutMinutes`
- 备注：`properties.remark`

### 多选批量编辑

- 统一设置审批人：`properties.assignee`
- 批量切换节点类型：矩形 / 条件

### 边

- 连线文本：`text`
- 条件表达式：`properties.condition`
- 优先级：`properties.priority`
- 备注：`properties.remark`

这些属性会随着：

- 本地草稿
- JSON 导出
- Mock 保存

一起持久化。

## 测试

### 单元测试

```bash
npm test
```

Vitest 驱动，覆盖流程校验规则、版本管理、工作台流程逻辑等纯逻辑模块。

### E2E 测试

```bash
npm run test:e2e
```

Playwright 驱动，覆盖三条链路：

- 冒烟：登录进入设计器
- 核心链路：新流程 → 画图（节点 + 连线）→ 保存 → 恢复版本
- 工作台：流程重命名 / 删除确认 / 多选批量设置审批人

运行时会自动拉起 Mock 服务（3000）和 Vite dev（8080）；本地已运行的服务会被复用，CI 环境则全新启动并以 `--reset` 重置 Mock 数据。

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端

```bash
npm run dev
```

默认地址：

```text
http://localhost:8080
```

### 3. 启动 Mock 服务

```bash
npm run mock
```

默认地址：

```text
http://localhost:3000
```

Mock 数据持久化在 `mock-data.json`（已 gitignore）；想重置回默认数据：

```bash
npm run mock -- --reset
```

## Mock 接口

| 方法 | 路径                | 说明                                |
| ---- | ------------------- | ----------------------------------- |
| POST | `/api/auth/login`   | 登录，返回 mock token               |
| POST | `/api/auth/refresh` | 刷新 access token                   |
| GET  | `/api/flows/:id`    | 获取流程数据                        |
| POST | `/api/flows/:id`    | 保存流程数据（写入 mock-data.json） |

Mock 登录规则：

- 用户名和密码只要都非空，就允许登录

## 默认体验说明

- 首次进入设计器时，如果后端没有流程数据，会使用默认图或空图
- 如果本地存在未保存草稿，会提示是否恢复
- 恢复历史版本前会自动备份当前画布内容，恢复后可再撤销

## 常用命令

```bash
npm run dev        # 启动前端开发服务器（serve 为兼容别名）
npm run mock       # 启动 Mock 服务（--reset 重置数据）
npm test           # 单元测试
npm run test:e2e   # E2E 测试
npm run lint       # 代码检查
npm run build      # 类型检查 + 生产构建
```

## License

Private Project - All Rights Reserved

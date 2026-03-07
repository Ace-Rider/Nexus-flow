# Nexus Flow

一个基于 `Vue 3 + TypeScript + LogicFlow` 的可视化流程设计器项目。  
当前版本已经支持流程绘制、智能布局、属性编辑、流程校验、草稿自动保存、版本管理、JSON/PNG 导出、多选删除和快捷键操作。

## 项目定位

这个项目不是单纯“展示一张流程图”，而是实现一个可编辑、可保存、可校验的前端流程设计器。

它目前覆盖了一个小型流程编排工具的核心链路：

- 登录鉴权与路由守卫
- 画布绘制与流程编辑
- 节点/边属性编辑
- 智能布局与边路线优化
- 流程结构校验
- 本地草稿自动保存与恢复
- 版本管理与历史恢复
- JSON / PNG 导入导出
- Mock 后端读写流程数据

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 |
| 开发语言 | TypeScript |
| 路由 | Vue Router 4 |
| 状态管理 | Pinia |
| UI 组件库 | Element Plus |
| 流程图引擎 | LogicFlow |
| 请求库 | Axios |
| Mock 服务 | Express |
| 构建工具 | Vue CLI 5 |

## 当前功能

### 画布编辑

- 新增矩形节点
- 新增条件节点
- 节点拖拽
- 节点连线
- 框选多个节点或边
- 删除选中元素
- 撤销 / 重做

### 流程能力

- 智能布局
- 边路径二次优化
- 流程结构校验
- 节点 / 边属性编辑
- 节点 / 边更完整的业务字段编辑
- 本地草稿自动保存与恢复

### 数据能力

- 导入 JSON
- 导出 JSON
- 导出 PNG
- Mock 后端读取流程
- Mock 后端保存流程

### 交互增强

- `Delete` / `Backspace` 删除选中元素
- `Ctrl/Cmd + Z` 撤销
- `Ctrl/Cmd + Y` 重做
- `Ctrl/Cmd + Shift + Z` 重做

## 目录结构

```text
nexus-flow/
├─ public/
│  ├─ index.html
│  └─ worker.js
├─ src/
│  ├─ api/
│  │  ├─ auth.ts
│  │  └─ request.ts
│  ├─ assets/
│  │  └─ main.css
│  ├─ components/
│  │  ├─ FlowDesigner.vue
│  │  └─ PropertyPanel.vue
│  ├─ router/
│  │  └─ index.ts
│  ├─ stores/
│  │  └─ auth.ts
│  ├─ types/
│  │  └─ flow.ts
│  ├─ utils/
│  │  ├─ version.ts
│  │  └─ performance.ts
│  ├─ views/
│  │  ├─ Designer.vue
│  │  └─ Login.vue
│  ├─ App.vue
│  ├─ main.ts
│  └─ shims-vue.d.ts
├─ mock-server.js
├─ request文件笔记.md
├─ worker.md
├─ package.json
├─ tsconfig.json
├─ vue.config.js
└─ README.md
```

## 核心模块说明

### `src/views/Designer.vue`

设计器主页面，负责页面级业务编排：

- 工具栏按钮交互
- 流程加载与保存
- 流程校验
- 草稿自动保存与恢复
- 版本管理与历史恢复
- 属性面板状态管理
- 智能布局调用
- JSON / PNG 导入导出

它是整个项目的“业务层”。

### `src/components/FlowDesigner.vue`

对 `LogicFlow` 的封装，是画布核心组件：

- 初始化 LogicFlow 实例
- 注册框选插件
- 监听节点、边、历史记录、选区变化
- 暴露新增、删除、导入导出、布局应用等方法
- 同步当前选中元素
- 更新节点 / 边文本和属性
- 提供 PNG 导出能力

它是整个项目的“画布层”。

### `src/components/PropertyPanel.vue`

右侧属性面板组件：

- 根据当前选中元素显示不同表单
- 支持节点属性编辑
- 支持边属性编辑
- 将输入中的表单值同步给父组件
- 点击“应用修改”后由父组件统一写回画布

### `src/types/flow.ts`

流程图共享类型定义文件，统一了：

- `GraphNode`
- `GraphEdge`
- `GraphData`
- `SelectedElement`
- `PropertyForm`

### `src/utils/performance.ts`

负责性能优化和 Worker 调度：

- `runLayoutInWorker()` 把布局计算交给 Web Worker
- 避免大图布局时阻塞主线程

### `src/utils/version.ts`

负责流程版本管理：

- 保存当前流程快照
- 读取和删除历史版本
- 限制版本数量，避免本地存储无限增长

### `public/worker.js`

智能布局算法运行在这里：

- 处理节点层级与位置计算
- 计算适合当前画布的节点坐标
- 将结果返回给主线程更新 LogicFlow

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
-> worker.js 计算新的节点坐标
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

### 节点

- 名称：`text`
- 审批人：`properties.assignee`
- 描述：`properties.description`
- 超时时间：`properties.timeoutMinutes`
- 备注：`properties.remark`

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

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端

```bash
npm run serve
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

## Mock 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录，返回 mock token |
| POST | `/api/auth/refresh` | 刷新 access token |
| GET | `/api/flows/:id` | 获取流程数据 |
| POST | `/api/flows/:id` | 保存流程数据 |

Mock 登录规则：

- 用户名和密码只要都非空，就允许登录

## 默认体验说明

- 首次进入设计器时，如果后端没有流程数据，会使用默认图或空图
- 如果本地存在未保存草稿，会提示是否恢复
- 右侧属性面板当前只支持单选编辑，不支持批量编辑

## 常用命令

```bash
npm run serve
npm run mock
npm run lint
npm run build
```

## License

Private Project - All Rights Reserved

# 智能布局 Worker 详细讲解

这份文档对应文件：

- [src/utils/layout.ts](C:/Users/25329/Desktop/nexus-flow/src/utils/layout.ts:1) —— 布局算法本体（纯函数）
- [src/workers/layoutWorker.ts](C:/Users/25329/Desktop/nexus-flow/src/workers/layoutWorker.ts:1) —— Web Worker 入口
- [src/utils/performance.ts](C:/Users/25329/Desktop/nexus-flow/src/utils/performance.ts:1) —— 主线程的调度封装

它的核心任务只有一句话：

“主线程把节点和边发给 Worker，Worker 在后台用 dagre 算出更合适的节点坐标，再把结果发回主线程。”

---

## 1. 三个文件怎么分工

```text
Designer.vue（业务层）
  -> performance.ts 的 runLayoutInWorker()   派活：发消息、等结果
    -> layoutWorker.ts（Worker 线程）          接活：解析消息协议
      -> layout.ts 的 computeLayout()         干活：真正的布局计算
```

- `performance.ts` 是“派活的人”：创建 Worker、发送 `LAYOUT` 消息、拿到结果后销毁 Worker
- `layoutWorker.ts` 是“传话的人”：只做消息协议的包装，一行算法都不含
- `layout.ts` 是“真正干活的人”：纯函数，输入节点和边，输出坐标

这样拆分的意义在于：`computeLayout` 不依赖任何浏览器 / 画布环境，可以直接在 Vitest 里单测（见 `src/utils/__tests__/layout.test.ts`）。

---

## 2. 消息协议

主线程发过去的消息：

```js
{
  type: "LAYOUT",
  data: { nodes, edges, width, height }
}
```

Worker 算完发回来的消息：

```js
{
  type: "LAYOUT_RESULT",
  data: [{ id, x, y }, ...]   // 每个节点的中心点新坐标
}
```

`layoutWorker.ts` 收到非 `LAYOUT` 类型的消息会直接忽略，收到 `LAYOUT` 后调用 `computeLayout`，把结果回传。参数缺省值（`width = 1200`、`height = 800`）和旧版 worker.js 保持一致，主线程漏传也能算出结果。

---

## 3. computeLayout 的完整流程

`computeLayout(nodes, edges, width, height)` 按下面的顺序工作：

1. **空图提前返回**：没有节点就没有布局可言，直接返回 `[]`
2. **统一节点尺寸**：宽高缺省补 `100 × 80`，同时保证不小于 `80 × 60`（布局计算必须知道节点尺寸）
3. **过滤非法边**：起点 / 终点不存在的边、自环边全部丢弃，防止坏数据干扰图结构分析
4. **没有有效连线时走网格兜底**：节点之间推断不出前后关系，就退化成均匀网格 + 整体居中
5. **其余情况交给 dagre**：分层布局，再把结果平移到画布中心

---

## 4. 为什么用 dagre 替换手写算法

旧版 `public/worker.js` 有 530 行手写实现：Tarjan 强连通分量（去环）→ 缩点成分量图 → 拓扑分层 → 多轮上下扫描优化同层顺序 → 手工排布坐标。

这些其实都是图布局领域的经典问题，dagre 一个库全部内置了：

| 旧版手写逻辑 | dagre 对应能力 |
| --- | --- |
| Tarjan 找强连通分量去环 | 内置 acyclic 模块自动去环 |
| 拓扑推进算层级 | 内置 ranking（网络单纯形等排名算法） |
| 多轮扫描优化同层顺序、减少交叉 | 内置 ordering（中位数启发式） |
| 手工计算层间距、居中 | 内置 positioning，产出节点坐标 |

参数也做了映射，保持视觉表现接近旧版：

- `rankdir: 'LR'` —— 从左往右分层，和旧版“第 0 层在最左边”一致
- `ranksep: 170` —— 层与层的横向间距，对应旧版 `layerGap`
- `nodesep: 48` —— 同层节点的纵向间距，对应旧版 `nodeGap`

替换后的收益：核心算法从 530 行降到 0 行（全部由 dagre 提供），出问题可以依赖社区修复，单测只需覆盖参数映射和兜底逻辑。

---

## 5. dagre 结果怎么落到画布上

dagre 算出的坐标在它自己的坐标系里，不能直接用，`buildDagreLayout` 做了两步加工：

1. **整体居中**：先算出所有节点的包围盒，再平移 `(offsetX, offsetY)`，让整张图落在画布正中间
2. **夹边界**：每个节点中心再 `clamp` 一次，保证不跑出 `[marginX, width - marginX] × [marginY, height - marginY]` 的留白范围；画布比内容还小时（`min > max`）不夹，避免挤出错误坐标

网格兜底 `buildGridLayout` 用同样的思路：列数取节点数平方根向上取整，格距用最大节点尺寸撑开，最后整体居中。

---

## 6. Worker 是怎么被打包的

旧版 `worker.js` 放在 `public/` 目录，作为静态资源原样下发——这意味着它不能 import npm 包，手写算法出不来。

现在改成 `src/workers/layoutWorker.ts`，`performance.ts` 里用 Vite 的 `?worker` 导入：

```ts
import LayoutWorker from '@/workers/layoutWorker?worker';

const worker = new LayoutWorker();
```

Vite 会把这个 TS 文件（连同它 import 的 dagre）打包成独立产物（构建后是 `dist/assets/layoutWorker-*.js`，约 93 kB），开发和构建行为一致，TypeScript 类型和 `@/` 别名也都能用。

---

## 7. 一句话总结

智能布局 = `dagre` 负责图算法 + `layout.ts` 负责参数映射和兜底 + `layoutWorker.ts` 负责消息协议 + `performance.ts` 负责调度，四层各司其职，任何一层都可以单独测试。

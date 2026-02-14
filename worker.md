# worker.js 详细讲解

这份文档对应文件：[public/worker.js](C:/Users/25329/Desktop/nexus-flow/public/worker.js:1)

它的核心任务只有一句话：

“主线程把节点和边发给 Worker，Worker 在后台算出更合适的节点坐标，再把结果发回主线程。”

---

## 1. 它在项目里扮演什么角色

`worker.js` 不是 Vue 组件，也不是直接操作 LogicFlow 画布的文件，它更像一个“后台计算员”。

主线程做的事情是：

- 收集当前图的节点和边
- 调用 `runLayoutInWorker(...)`
- 把数据通过 `postMessage` 发给 Worker
- 等待 Worker 算完返回结果
- 再把新坐标应用到画布上

Worker 做的事情是：

- 接收布局任务
- 分析节点和边的关系
- 计算每个节点的新位置
- 把结果发回主线程

所以可以把它理解成：

- [src/utils/performance.ts](C:/Users/25329/Desktop/nexus-flow/src/utils/performance.ts:1) 是“派活的人”
- [public/worker.js](C:/Users/25329/Desktop/nexus-flow/public/worker.js:1) 是“真正干活的人”

---

## 2. 入口：接收主线程消息

文件开头：

```js
self.addEventListener("message", (e) => {
  const { type, data } = e.data;
  if (type !== "LAYOUT") {
    return;
  }
```

这里的意思是：

1. `self` 表示当前 Worker 自己
2. `addEventListener("message", ...)` 表示监听主线程发来的消息
3. `e` 是消息事件对象
4. 真正的数据在 `e.data` 里面
5. 这里只处理 `type === "LAYOUT"` 的消息

主线程发来的数据大概长这样：

```js
{
  type: "LAYOUT",
  data: {
    nodes,
    edges,
    width,
    height
  }
}
```

所以 Worker 的第一步不是立刻布局，而是先判断：

“这是不是给我的布局任务？”

---

## 3. 读取参数和提前返回

接下来这段：

```js
const { nodes = [], edges = [], width = 1200, height = 800 } = data;
if (!nodes.length) {
  self.postMessage({ type: "LAYOUT_RESULT", data: [] });
  return;
}
```

意思是：

- 从消息数据中取出节点、边、画布宽高
- 如果没有节点，就没必要继续计算
- 直接把空数组发回主线程

这是一种很常见的写法，叫“提前返回”，目的是避免无意义计算。

---

## 4. 一组布局常量

```js
const marginX = 140;
const marginY = 100;
const layerGap = 170;
const componentGap = 80;
const nodeGap = 48;
const sweepCount = 4;
```

这些常量不负责“算不算得出来”，它们负责“布局看起来舒不舒服”。

- `marginX` / `marginY`：画布边缘留白
- `layerGap`：层和层之间的横向间距
- `componentGap`：分量和分量之间的纵向间距
- `nodeGap`：同一个分量内部节点之间的间距
- `sweepCount`：顺序优化来回扫描的轮数

---

## 5. 几个辅助函数

### 5.1 `clamp`

```js
const clamp = (value, min, max) => {
  if (min > max) return value;
  return Math.max(min, Math.min(value, max));
};
```

作用：把一个值限制在指定范围内。

比如某个节点算出来太靠左，就至少把它推回到 `marginX`。

### 5.2 `average`

```js
const average = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
```

作用：求平均值。

后面层内排序时，会计算“相邻分量的平均顺序”，这个函数就是给那个步骤服务的。

### 5.3 `normalizeNode`

```js
const normalizeNode = (node) => {
  return {
    ...node,
    width: Math.max(node.width || 100, 80),
    height: Math.max(node.height || 80, 60),
  };
};
```

作用：统一节点结构，补齐最基本的宽高。

因为布局计算必须知道节点尺寸，否则没法算间距、没法算中心点。

---

## 6. 建立索引表

这几行非常关键：

```js
const normalizedNodes = nodes.map(normalizeNode);
const nodeById = new Map(...);
const nodeIds = new Set(...);
const nodeOrder = new Map(...);
const nodePosition = new Map(...);
```

它们本质上是在给后续计算建立“快速查找结构”。

### 6.1 `normalizedNodes`

标准化后的节点数组，后续布局统一使用它。

### 6.2 `nodeById`

`id -> 节点对象`

作用：通过节点 id 快速拿到节点。

### 6.3 `nodeIds`

节点 id 的集合。

作用：快速判断某个节点 id 是否存在。

### 6.4 `nodeOrder`

`id -> 原始顺序`

作用：当两个节点比较时，如果别的条件一样，就按原始顺序兜底，减少布局跳动。

### 6.5 `nodePosition`

`id -> 原始位置`

作用：后面排序时尽量参考节点原来所在的位置，让自动布局结果不要和用户眼中的顺序差太远。

---

## 7. 过滤非法边

```js
const validEdges = edges.filter((edge) => {
  return (
    nodeIds.has(edge.sourceNodeId) &&
    nodeIds.has(edge.targetNodeId) &&
    edge.sourceNodeId !== edge.targetNodeId
  );
});
```

这一步是在做数据清洗，只保留合法边：

- 起点存在
- 终点存在
- 不是自己连自己

如果不做这一步，后面的图结构分析可能会被错误数据干扰。

---

## 8. 没有边时为什么退化成网格布局

`buildGridLayout()` 的意思不是“高级智能布局”，而是一个兜底方案。

如果图里一个有效边都没有，就说明：

- 节点之间没有流程关系
- 没法推断谁在前、谁在后
- 也就没必要跑复杂的分层算法

这时最合理的策略反而是：

- 计算一个网格
- 把节点均匀摆进去
- 再整体居中

所以它的思路是：

1. 根据节点数量估算列数和行数
2. 找到最大节点宽高
3. 算出每一格之间的间距
4. 算出总内容宽高
5. 把整块内容居中到画布里

这就是为什么没有边时，布局结果看上去更像“整齐平铺”。

---

## 9. 建立图的出边和入边关系

```js
const outgoing = new Map(normalizedNodes.map((node) => [node.id, []]));
const incoming = new Map(normalizedNodes.map((node) => [node.id, []]));

validEdges.forEach((edge) => {
  outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
  incoming.get(edge.targetNodeId).push(edge.sourceNodeId);
});
```

这里开始真正进入“图结构分析”。

- `outgoing`：某个节点连向哪些节点
- `incoming`：哪些节点连向某个节点

例如：

```text
A -> B -> C
```

那么：

- `outgoing[A] = [B]`
- `incoming[B] = [A]`
- `outgoing[B] = [C]`
- `incoming[C] = [B]`

后面找前驱、找后继、找环路，都会依赖这两张表。

---

## 10. 为什么要用 Tarjan 算法

这是整份文件里最偏算法的一段，但你先记住它解决的问题：

“如果图里有环怎么办？”

例如：

```text
A -> B
B -> C
C -> A
```

这种图不是单向往前走的，因为节点之间会绕回来。

如果直接把这种图硬按普通流程图去分层，会很不稳定，也不太合理。

所以这里使用 Tarjan 算法，把“互相能绕回去的一组节点”视为一个整体，这个整体就叫：

**强连通分量**

可以先这样理解：

- 没有环时，一个节点通常就是一个分量
- 有环时，一组互相可达的节点会被合并成一个分量

这样做的价值是：

先把复杂有环图压缩成更容易处理的“分量图”。

---

## 11. `strongConnect` 在做什么

这一段：

```js
const strongConnect = (nodeId) => {
  ...
};
```

它是 Tarjan 算法的核心 DFS 过程。

它主要会做这些事：

1. 给当前节点记录一个访问序号 `nodeIndex`
2. 给当前节点记录一个 `lowLink`
3. 把当前节点压进栈里
4. 继续递归访问它的后继节点
5. 更新当前节点能回溯到的最小编号
6. 如果发现当前节点是一个分量的根，就从栈里把这一整组节点弹出来

你不需要一开始就死磕每个细节，先记一句话：

`strongConnect` 的目标是“找出哪些节点应该被归成同一个强连通分量”。

---

## 12. 为什么后面要构建 `nodeToComponent` 和 `componentById`

当 Tarjan 找出多个强连通分量后，代码会建立两张表：

- `nodeToComponent`
- `componentById`

它们的作用分别是：

- `nodeToComponent`：从节点找到它属于哪个分量
- `componentById`：从分量 id 找到这个分量的详细信息

每个分量对象里大概会有：

- `id`
- `nodes`
- `incoming`
- `outgoing`

也就是说，从这一刻开始，程序的关注点不再只是“节点和节点的关系”，而是开始关注：

“分量和分量的关系”。

---

## 13. 为什么还要把边提升到“分量层级”

```js
validEdges.forEach((edge) => {
  const sourceComponentId = nodeToComponent.get(edge.sourceNodeId);
  const targetComponentId = nodeToComponent.get(edge.targetNodeId);
  if (sourceComponentId === targetComponentId) {
    return;
  }

  componentById.get(sourceComponentId).outgoing.add(targetComponentId);
  componentById.get(targetComponentId).incoming.add(sourceComponentId);
});
```

这一步的意思是：

- 如果一条边的起点和终点都在同一个分量里，那它属于“分量内部关系”，不用拿来做分量之间的布局
- 只有跨分量的边，才会影响分量之间的前后顺序

所以这一步相当于把“节点图”压缩成“分量图”。

---

## 14. 分层：决定谁在前、谁在后

接下来程序要做的事情是：

“给每个分量安排一个层级。”

这里的层级可以理解成：

- 第 0 层在最左边
- 第 1 层在右边一点
- 第 2 层再往右

也就是决定一个分量应该落在第几列。

核心思路是：

1. 先找入度为 0 的分量作为起点
2. 再往后逐层推进
3. 谁被前面的分量指向，谁通常就应该在更后一层

这和普通流程图“开始 -> 中间 -> 结束”的阅读顺序是一致的。

---

## 15. 为什么要准备队列 `queue`

```js
const queue = components
  .filter((component) => component.incoming.size === 0)
  ...
```

这里是在找所有“没有前驱分量”的分量。

这些分量天然更像流程起点，所以适合作为第一批进入分层计算的对象。

如果一个都找不到，说明图可能整体带环。那代码就会退一步，挑一个“最像起点”的分量先开始。

判断“最像起点”的依据是：

- 出边多一些
- 入边少一些

也就是更像“往后发散”的节点。

---

## 16. `while (queue.length)` 在干什么

这段逻辑是在做类似拓扑推进的事情：

1. 从队列里取出一个分量
2. 看它能连到哪些后继分量
3. 把这些后继分量的层级至少设置为“当前层 + 1”
4. 不断往后推

最后会得到一张表：

`componentLayer`

它的含义就是：

`分量 id -> 它属于第几层`

所以这一段的结果不是具体坐标，而是先确定“逻辑上的横向顺序”。

---

## 17. `layers` 是干什么的

```js
const layers = new Map();
```

前面 `componentLayer` 是：

- 一个分量对应一个层号

这里 `layers` 则是把它反过来整理成：

- 一个层号对应这一层有哪些分量

这样后面就能很方便地做：

- 第 0 层内部排序
- 第 1 层内部排序
- 第 2 层内部排序

---

## 18. 为什么同一层里还要排序

即使两个分量都在第 1 层，它们也还需要决定：

- 谁在上面
- 谁在下面

这一步如果随便排，连线就可能交叉很多，看起来会很乱。

所以这里会先按原始位置排一个初始顺序，再做进一步优化。

初始排序的好处是：

- 布局结果更稳定
- 不会每次自动布局都大幅跳动

---

## 19. `getPrevNeighbors` 和 `getNextNeighbors`

这两个函数的作用分别是：

- `getPrevNeighbors(componentId)`：找到当前分量上一层的前驱分量
- `getNextNeighbors(componentId)`：找到当前分量下一层的后继分量

注意，它们不是简单拿全部 `incoming` / `outgoing`，而是只保留“真正跨层”的邻居。

因为层内排序优化，关心的是“和前后层的关系”。

---

## 20. 为什么要正向扫和反向扫

这一段是整个层内排序优化的关键：

```js
for (let sweep = 0; sweep < sweepCount; sweep += 1) {
  // 正向扫描
  // 反向扫描
}
```

它的思路可以理解成：

### 正向扫描

当前层的分量，参考前一层邻居的大致位置来调整自己。

比如：

- 如果当前分量连接的前驱大多在上方
- 那它也更适合排在上面一些

### 反向扫描

再反过来，参考后一层邻居的位置修正一遍。

比如：

- 如果当前分量连向的后继大多在下方
- 那它也可以适当往下排

### 为什么要来回多轮

因为一轮调整后，别的层的顺序也变了，继续扫几轮通常能让整体更协调。

这一步的目标就是：

**尽量减少交叉线，让图更顺眼。**

---

## 21. `getComponentMetrics` 是算什么的

```js
const getComponentMetrics = (componentId) => {
  ...
};
```

这个函数负责统计一个分量的尺寸。

因为分量不一定只有一个节点，它可能是一组节点竖着堆起来，所以它需要两个指标：

- `width`
- `height`

其中：

- `width` 取这个分量里最宽节点的宽度
- `height` 是所有节点高度加起来，再加上节点之间的间距

为什么要算这个？

因为后面要决定：

- 每一层至少需要多宽
- 每个分量在纵向要占多少空间

---

## 22. 横向排布：每层放在哪

后面这些变量：

- `layerWidths`
- `totalWidth`
- `currentLeft`
- `layerCenters`

它们一起解决的问题是：

“每一层应该放在画布横向的哪个位置？”

整体流程是：

1. 算每层需要的最大宽度
2. 把所有层的宽度和层间距加起来，得到整张图总宽度
3. 用总宽度去做整体居中
4. 从左到右计算出每一层的中心 `x`

所以这一步是在算“列中心线”。

---

## 23. 纵向排布：每层内部怎么居中

后面这些变量：

- `layerHeights`
- `maxLayerHeight`
- `topStart`

负责的是纵向居中。

思路是：

1. 先算出每一层所有分量加起来总共有多高
2. 找到最高的那一层
3. 以它为参照，把所有层都尽量垂直居中

这样不同层即使节点数量不一样，看上去也不会东倒西歪。

---

## 24. 最终的 `positions` 是怎么来的

真正生成结果的是这段：

```js
positions.push({
  id: nodeId,
  x: layerX,
  y: clamp(y, marginY, Math.max(marginY, height - marginY)),
});
```

这表示最终给每个节点生成：

- 它自己的 `id`
- 它应该落在哪个横坐标 `x`
- 它应该落在哪个纵坐标 `y`

这里的坐标来源是：

- `x`：由该节点所属分量所在层决定
- `y`：由该节点在分量内部的堆叠位置决定

同一个分量里的节点会这样排：

- 第一个节点放上面
- 第二个节点在下面一点
- 第三个节点再往下

它们之间的间距就是 `nodeGap`。

所以你现在看到的智能布局，不只是“居中”，而是：

- 先按流程关系分层
- 再按分量内部竖向堆叠
- 最后整体居中

---

## 25. 为什么最后要 `postMessage`

最后一段：

```js
self.postMessage({
  type: "LAYOUT_RESULT",
  data: positions.length ? positions : buildGridLayout(),
});
```

表示 Worker 计算完后，要把结果再发回主线程。

这条消息的结构是：

```js
{
  type: "LAYOUT_RESULT",
  data: positions
}
```

主线程那边的 `worker.onmessage` 收到这条消息后，就能拿到：

- 哪些节点该移动
- 分别移动到什么位置

然后再把这些新坐标应用到 LogicFlow 画布上。

---

## 26. 整个文件的完整流程

你可以把 `worker.js` 的执行流程记成下面这 10 步：

1. 主线程发送 `LAYOUT` 消息
2. Worker 收到消息并取出节点、边、宽高
3. 补齐节点尺寸，建立索引表
4. 过滤非法边
5. 如果没有边，就直接走网格布局
6. 如果有边，就建立 `outgoing` / `incoming`
7. 用 Tarjan 找强连通分量
8. 把原图压缩成“分量图”，并给分量分层
9. 优化每层内部的顺序，减少交叉
10. 算出每个节点的最终 `x / y`，再发回主线程

---

## 27. 一句话总结

这份 `worker.js` 并不是简单把节点“摆到中间”。

它真正做的是：

先分析图结构，再把有环节点压成分量，再给分量分层，再优化顺序，最后计算每个节点的坐标并回传。

所以它是这个项目“智能布局”能力的核心计算文件。

/**
 * 智能布局性能基准脚本
 *
 * 运行：npm run bench:layout
 *
 * 直接在 Node 中调用 computeLayout 纯函数（与 Worker 里跑的是同一段代码），
 * 测量不同规模、不同形状的图布局耗时，用来量化「布局计算放到 Web Worker」的
 * 必要性：如果同步执行，主线程会被阻塞同样的时长。
 *
 * 覆盖三条计算路径：
 * - 链式图：n 节点串成一条线，走 dagre 分层
 * - 分叉图：近似二叉树，走 dagre 分层
 * - 无连线：dagre 推断不出前后关系，走网格兜底
 */
import { computeLayout, type LayoutEdge, type LayoutNode } from '../src/utils/layout.ts';

// 与设计器实际调用的画布尺寸保持一致（Designer.vue 取容器尺寸，常见桌面分辨率下约 1200x800）
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

// 每组参数跑几次取中位数，抹平单次抖动
const RUNS = 5;

// 链式图：节点 i 连向节点 i+1
const buildChainGraph = (size: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } => {
  const nodes: LayoutNode[] = Array.from({ length: size }, (_, index) => ({
    id: `n${index}`,
    width: 100,
    height: 80,
  }));
  const edges: LayoutEdge[] = Array.from({ length: size - 1 }, (_, index) => ({
    sourceNodeId: `n${index}`,
    targetNodeId: `n${index + 1}`,
  }));
  return { nodes, edges };
};

// 分叉图：节点 i 连向 2i+1 和 2i+2（近似完全二叉树）
const buildBranchGraph = (size: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } => {
  const nodes: LayoutNode[] = Array.from({ length: size }, (_, index) => ({
    id: `n${index}`,
    width: 100,
    height: 80,
  }));
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < size; i++) {
    for (const child of [2 * i + 1, 2 * i + 2]) {
      if (child < size) {
        edges.push({ sourceNodeId: `n${i}`, targetNodeId: `n${child}` });
      }
    }
  }
  return { nodes, edges };
};

// 无连线图：布局退化为均匀网格
const buildIsolatedGraph = (size: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } => ({
  nodes: Array.from({ length: size }, (_, index) => ({
    id: `n${index}`,
    width: 100,
    height: 80,
  })),
  edges: [],
});

type GraphShape = {
  name: string;
  build: (size: number) => { nodes: LayoutNode[]; edges: LayoutEdge[] };
};

const SHAPES: GraphShape[] = [
  { name: '链式', build: buildChainGraph },
  { name: '分叉', build: buildBranchGraph },
  { name: '无连线（网格兜底）', build: buildIsolatedGraph },
];

const SIZES = [100, 500, 1000];

const measure = (nodes: LayoutNode[], edges: LayoutEdge[]) => {
  // 预热一次，让 V8 完成 JIT 编译，避免首帧耗时污染数据
  computeLayout(nodes, edges, CANVAS_WIDTH, CANVAS_HEIGHT);

  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    computeLayout(nodes, edges, CANVAS_WIDTH, CANVAS_HEIGHT);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  return { median, max: times[times.length - 1] };
};

// 输出 markdown 表格，方便直接贴进 README
const rows: string[] = [];
for (const shape of SHAPES) {
  for (const size of SIZES) {
    const { nodes, edges } = shape.build(size);
    const { median, max } = measure(nodes, edges);
    rows.push(
      `| ${shape.name} | ${size} | ${edges.length} | ${median.toFixed(1)} | ${max.toFixed(1)} |`,
    );
    process.stdout.write(`.`);
  }
}
process.stdout.write('\n\n');

console.log('| 图形状 | 节点数 | 边数 | 中位耗时 (ms) | 最大耗时 (ms) |');
console.log('| ------ | ------ | ---- | ------------- | ------------- |');
for (const row of rows) {
  console.log(row);
}
console.log(`\n环境：Node ${process.version}，每组 ${RUNS} 次取中位数，画布 ${CANVAS_WIDTH}x${CANVAS_HEIGHT}`);

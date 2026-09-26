import dagre from 'dagre';

// 智能布局的纯函数实现：
// 输入节点和边，输出每个节点的新坐标，不依赖画布实例，方便单测覆盖。
// 分层、去环、同层排序这些图论问题全部交给 dagre，这里只负责参数映射和兜底。

// 布局输入的节点结构：宽高缺省时用兜底值补齐
export type LayoutNode = {
  id: string;
  width?: number;
  height?: number;
  [key: string]: any;
};

// 布局输入的边结构：只关心起点和终点
export type LayoutEdge = {
  sourceNodeId: string;
  targetNodeId: string;
};

// 布局结果：每个节点的中心点新坐标
export type NodePosition = {
  id: string;
  x: number;
  y: number;
};

// —— 布局参数：与旧版手写算法保持一致，避免视觉表现突变 ——
// 画布左右留白（节点中心距边缘的最小距离）
const MARGIN_X = 140;
// 画布上下留白
const MARGIN_Y = 100;
// 层与层之间的横向间距，对应 dagre 的 ranksep
const LAYER_GAP = 170;
// 网格布局里行与行的纵向间距
const ROW_GAP = 80;
// 同层节点之间的纵向间距，对应 dagre 的 nodesep
const NODE_GAP = 48;
// 节点宽高缺省值与最小尺寸
const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 80;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 60;

// 把数值限制在范围内；范围不合法（min > max）时原样返回，避免小画布下挤出 NaN
const clamp = (value: number, min: number, max: number) => {
  if (min > max) return value;
  return Math.max(min, Math.min(value, max));
};

// 统一节点尺寸：缺省补默认值，同时保证不小于最小尺寸
type SizedNode = {
  id: string;
  width: number;
  height: number;
};

const normalizeNodes = (nodes: LayoutNode[]): SizedNode[] =>
  nodes.map((node) => ({
    id: node.id,
    width: Math.max(node.width || DEFAULT_WIDTH, MIN_WIDTH),
    height: Math.max(node.height || DEFAULT_HEIGHT, MIN_HEIGHT),
  }));

// 只保留起点、终点都存在且不是自环的边，防止坏数据干扰布局
const filterValidEdges = (edges: LayoutEdge[], nodeIds: Set<string>) =>
  edges.filter(
    (edge) =>
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId) &&
      edge.sourceNodeId !== edge.targetNodeId,
  );

// 网格布局：没有任何有效连线时，节点之间推断不出前后关系，
// 退化为均匀网格并整体居中，效果上就是“整齐平铺”
const buildGridLayout = (nodes: SizedNode[], width: number, height: number): NodePosition[] => {
  // 列数取节点数的平方根向上取整，让网格尽量接近正方形
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);

  // 用最大节点尺寸撑开格距，保证任意两个节点都不会重叠
  const maxNodeWidth = Math.max(...nodes.map((node) => node.width), DEFAULT_WIDTH);
  const maxNodeHeight = Math.max(...nodes.map((node) => node.height), DEFAULT_HEIGHT);
  const colGap = maxNodeWidth + LAYER_GAP;
  const rowGap = maxNodeHeight + ROW_GAP;

  const contentWidth = Math.max((cols - 1) * colGap, 0);
  const contentHeight = Math.max((rows - 1) * rowGap, 0);

  // 把整块网格居中到画布里；画布装不下时从留白处开始往右排
  const startX = clamp(
    (width - contentWidth) / 2,
    MARGIN_X,
    Math.max(MARGIN_X, width - MARGIN_X),
  );
  const startY = clamp(
    (height - contentHeight) / 2,
    MARGIN_Y,
    Math.max(MARGIN_Y, height - MARGIN_Y),
  );

  return nodes.map((node, index) => ({
    id: node.id,
    x: clamp(startX + (index % cols) * colGap, MARGIN_X, width - MARGIN_X),
    y: clamp(startY + Math.floor(index / cols) * rowGap, MARGIN_Y, height - MARGIN_Y),
  }));
};

// dagre 分层布局：LR 方向（从左往右），dagre 内部会自动去环、分层并优化同层顺序
const buildDagreLayout = (
  nodes: SizedNode[],
  edges: LayoutEdge[],
  width: number,
  height: number,
): NodePosition[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'LR',
    nodesep: NODE_GAP,
    ranksep: LAYER_GAP,
  });
  // dagre 的边标签是必填项，这里用空对象占位
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: node.width, height: node.height });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.sourceNodeId, edge.targetNodeId);
  });

  dagre.layout(graph);

  // dagre 返回的坐标在自己的画布坐标系里，先取出节点中心点
  const placed = nodes.map((node) => {
    const point = graph.node(node.id) as { x: number; y: number };
    return { id: node.id, x: point.x, y: point.y, width: node.width, height: node.height };
  });

  // 计算内容包围盒，把整张图平移到画布中心
  const minX = Math.min(...placed.map((item) => item.x - item.width / 2));
  const maxX = Math.max(...placed.map((item) => item.x + item.width / 2));
  const minY = Math.min(...placed.map((item) => item.y - item.height / 2));
  const maxY = Math.max(...placed.map((item) => item.y + item.height / 2));
  const offsetX = (width - (maxX - minX)) / 2 - minX;
  const offsetY = (height - (maxY - minY)) / 2 - minY;

  // 最后再夹一次边界：画布装不下时，节点中心也不会跑出留白范围
  return placed.map((item) => ({
    id: item.id,
    x: clamp(item.x + offsetX, MARGIN_X, width - MARGIN_X),
    y: clamp(item.y + offsetY, MARGIN_Y, height - MARGIN_Y),
  }));
};

// 智能布局入口：无节点返回空结果；无有效连线走网格兜底；其余交给 dagre 分层布局
export const computeLayout = (
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width = 1200,
  height = 800,
): NodePosition[] => {
  if (!nodes.length) return [];

  const sizedNodes = normalizeNodes(nodes);
  const nodeIds = new Set(sizedNodes.map((node) => node.id));
  const validEdges = filterValidEdges(edges, nodeIds);

  if (!validEdges.length) {
    return buildGridLayout(sizedNodes, width, height);
  }

  return buildDagreLayout(sizedNodes, validEdges, width, height);
};

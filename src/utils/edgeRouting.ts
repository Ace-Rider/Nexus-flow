import type { GraphEdge } from '@/types/flow';

// 路由计算依赖的节点几何信息（坐标来自模型，宽高为兜底后的实际尺寸）
export type RouteNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoutePoint = {
  x: number;
  y: number;
};

// 一条边重算后的几何属性，供画布 updateAttributes 写回
export type RoutedEdgeGeometry = {
  startPoint: RoutePoint;
  endPoint: RoutePoint;
  pointsList: RoutePoint[];
};

// —— 通道几何参数集中在这里，方便统一调整 ——
// 同源出边在中间横向通道上的层间距
const LANE_GAP = 42;
// 多条边汇入同一终点时的错位间距
const MERGE_GAP = 18;
// 计算分流/汇入缺口时假定的最小边长
const MIN_ROUTE_DISTANCE = 80;
// 分流点离起点的距离范围：边长 * 比例，夹在 [min, max]
const SOURCE_GAP_RATIO = 0.22;
const SOURCE_GAP_MIN = 42;
const SOURCE_GAP_MAX = 104;
// 汇入点离终点的距离范围
const TARGET_GAP_RATIO = 0.18;
const TARGET_GAP_MIN = 36;
const TARGET_GAP_MAX = 88;
// 分流点与汇入点之间的最小水平通道宽度
const MIN_CHANNEL = 36;
// 判定走纵向折线的阈值系数：
// 水平距离 < 两节点较宽者 * 0.9，且垂直距离 > 两节点较高者 * 0.6
const VERTICAL_WIDTH_FACTOR = 0.9;
const VERTICAL_HEIGHT_FACTOR = 0.6;

// 统一把坐标处理成整数，避免折点出现很多小数
const round = (value: number) => Math.round(value);
const toPoint = (x: number, y: number): RoutePoint => ({ x: round(x), y: round(y) });

// 去掉重复点和落在同一直线上的无效中间点，让 pointsList 更干净
const dedupePoints = (points: RoutePoint[]) => {
  const compact = points.filter((point, index) => {
    if (index === 0) return true;
    const prev = points[index - 1];
    return prev.x !== point.x || prev.y !== point.y;
  });

  return compact.filter((point, index) => {
    if (index === 0 || index === compact.length - 1) return true;
    const prev = compact[index - 1];
    const next = compact[index + 1];
    const sameVertical = prev.x === point.x && point.x === next.x;
    const sameHorizontal = prev.y === point.y && point.y === next.y;
    return !sameVertical && !sameHorizontal;
  });
};

// 生成纵向折线：从上下边缘进出，中间只保留一段横向折线
const buildVerticalRoute = (source: RouteNode, target: RouteNode): RoutedEdgeGeometry => {
  const direction = target.y >= source.y ? 1 : -1;
  const startPoint = toPoint(source.x, source.y + (direction * source.height) / 2);
  const endPoint = toPoint(target.x, target.y - (direction * target.height) / 2);
  const midY = round((startPoint.y + endPoint.y) / 2);
  const pointsList = dedupePoints([
    startPoint,
    toPoint(startPoint.x, midY),
    toPoint(endPoint.x, midY),
    endPoint,
  ]);

  return { startPoint, endPoint, pointsList };
};

// 生成横向折线：先从起点分流，再走中间 lane，最后在终点附近汇入
const buildHorizontalRoute = (
  source: RouteNode,
  target: RouteNode,
  outgoingIndex: number,
  branchCount: number,
  incomingIndex: number,
  mergeCount: number,
): RoutedEdgeGeometry => {
  const direction = target.x >= source.x ? 1 : -1;
  const startPoint = toPoint(source.x + (direction * source.width) / 2, source.y);
  const endPoint = toPoint(target.x - (direction * target.width) / 2, target.y);

  // 同源出边按序分摊中间通道高度层；同终点入边按序在终点上方错位汇入
  const branchOffset = branchCount > 1 ? (outgoingIndex - (branchCount - 1) / 2) * LANE_GAP : 0;
  const mergeOffset = mergeCount > 1 ? (incomingIndex - (mergeCount - 1) / 2) * MERGE_GAP : 0;
  // laneY 表示这条边在中间横向主通道上走的那条“高度层”
  const laneY = round(source.y + branchOffset);

  const horizontalDistance = Math.abs(target.x - source.x);
  const distance = Math.max(horizontalDistance, MIN_ROUTE_DISTANCE);
  const sourceGap = Math.min(SOURCE_GAP_MAX, Math.max(SOURCE_GAP_MIN, distance * SOURCE_GAP_RATIO));
  const targetGap = Math.min(TARGET_GAP_MAX, Math.max(TARGET_GAP_MIN, distance * TARGET_GAP_RATIO));
  let splitX = round(startPoint.x + direction * sourceGap);
  let mergeX = round(endPoint.x - direction * targetGap);

  // splitX 和 mergeX 过近时，强行拉开一段最小通道，避免折线挤成一团
  if (
    (direction > 0 && splitX > mergeX - MIN_CHANNEL) ||
    (direction < 0 && splitX < mergeX + MIN_CHANNEL)
  ) {
    const centerX = round((startPoint.x + endPoint.x) / 2);
    splitX = centerX - direction * Math.ceil(MIN_CHANNEL / 2);
    mergeX = centerX + direction * Math.ceil(MIN_CHANNEL / 2);
  }

  const entryY = round(endPoint.y + mergeOffset);
  const pointsList = dedupePoints([
    startPoint,
    toPoint(splitX, startPoint.y),
    toPoint(splitX, laneY),
    toPoint(mergeX, laneY),
    toPoint(mergeX, entryY),
    toPoint(mergeX, endPoint.y),
    endPoint,
  ]);

  return { startPoint, endPoint, pointsList };
};

// 二次优化折线走向（纯函数）：
// 先按节点位置重新分配每条边的“分流/汇流通道”，再去掉重复折点。
// 入参只依赖节点几何和边列表，不触碰画布实例，方便单测覆盖。
// 返回 edgeId -> 新几何属性的映射；端点缺失的边会被跳过。
export const routeEdges = (nodes: RouteNode[], edges: GraphEdge[]) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  // outgoingMap：某个节点发出的所有边；incomingMap：某个节点流入的所有边
  const outgoingMap = new Map<string, GraphEdge[]>();
  const incomingMap = new Map<string, GraphEdge[]>();

  edges.forEach((edge) => {
    if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) return;
    if (!outgoingMap.has(edge.sourceNodeId)) {
      outgoingMap.set(edge.sourceNodeId, []);
    }
    if (!incomingMap.has(edge.targetNodeId)) {
      incomingMap.set(edge.targetNodeId, []);
    }
    outgoingMap.get(edge.sourceNodeId)?.push(edge);
    incomingMap.get(edge.targetNodeId)?.push(edge);
  });

  // 排序结果只依赖 nodeMap，循环外预排序一次，避免每条边都重复 slice+sort：
  // 同源出边按目标节点位置排序，同终点入边按来源节点位置排序
  const sortedOutgoing = new Map<string, GraphEdge[]>();
  const sortedIncoming = new Map<string, GraphEdge[]>();
  outgoingMap.forEach((group, nodeId) => {
    sortedOutgoing.set(
      nodeId,
      group.slice().sort((a, b) => {
        const targetA = nodeMap.get(a.targetNodeId);
        const targetB = nodeMap.get(b.targetNodeId);
        if (!targetA || !targetB) return 0;
        if (targetA.y !== targetB.y) return targetA.y - targetB.y;
        return targetA.x - targetB.x;
      }),
    );
  });
  incomingMap.forEach((group, nodeId) => {
    sortedIncoming.set(
      nodeId,
      group.slice().sort((a, b) => {
        const sourceA = nodeMap.get(a.sourceNodeId);
        const sourceB = nodeMap.get(b.sourceNodeId);
        if (!sourceA || !sourceB) return 0;
        if (sourceA.y !== sourceB.y) return sourceA.y - sourceB.y;
        return sourceA.x - sourceB.x;
      }),
    );
  });

  const result = new Map<string, RoutedEdgeGeometry>();

  edges.forEach((edge) => {
    const source = nodeMap.get(edge.sourceNodeId);
    const target = nodeMap.get(edge.targetNodeId);
    if (!source || !target) return;

    const horizontalDistance = Math.abs(target.x - source.x);
    const verticalDistance = Math.abs(target.y - source.y);
    // 更接近上下方向时，优先走纵向折线；否则走横向主通道
    const isVerticalRoute =
      horizontalDistance < Math.max(source.width, target.width) * VERTICAL_WIDTH_FACTOR &&
      verticalDistance > Math.max(source.height, target.height) * VERTICAL_HEIGHT_FACTOR;

    if (isVerticalRoute) {
      result.set(edge.id, buildVerticalRoute(source, target));
      return;
    }

    // 同一起点的出边已按目标节点位置预排序，决定谁走上面的通道、谁走下面的通道
    const sourceOutgoing = sortedOutgoing.get(edge.sourceNodeId) || [];
    // 同一终点的入边已按来源节点位置预排序，决定汇入终点时的错位顺序
    const targetIncoming = sortedIncoming.get(edge.targetNodeId) || [];
    // findIndex 未命中时取 0，与“不参与排序竞争”的语义一致
    const outgoingIndex = Math.max(0, sourceOutgoing.findIndex((item) => item.id === edge.id));
    const incomingIndex = Math.max(0, targetIncoming.findIndex((item) => item.id === edge.id));

    result.set(
      edge.id,
      buildHorizontalRoute(
        source,
        target,
        outgoingIndex,
        sourceOutgoing.length,
        incomingIndex,
        targetIncoming.length,
      ),
    );
  });

  return result;
};

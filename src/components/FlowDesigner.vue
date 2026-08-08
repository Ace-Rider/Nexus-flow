<template>
  <div ref="container" class="flow-designer"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import LogicFlow from '@logicflow/core';
import '@logicflow/core/es/index.css';
import { MiniMap, SelectionSelect } from '@logicflow/extension';
import '@logicflow/extension/es/index.css';
import type { FlowClipboardData, GraphData, SelectedElement } from '@/types/flow';

type AddNodeType = 'rect' | 'diamond';

export type NodeTemplate = {
  type: AddNodeType;
  text: string;
  properties?: Record<string, any>;
};

type LayoutNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: any;
};

type LayoutGraphData = {
  nodes: LayoutNode[];
  edges: any[];
};

type NodePosition = {
  id: string;
  x: number;
  y: number;
};

type Point = {
  x: number;
  y: number;
};

const props = defineProps<{
  modelValue?: GraphData | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: GraphData): void;
  (e: 'history-change', canUndo: boolean, canRedo: boolean): void;
  (e: 'selection-change', value: SelectedElement): void;
}>();

// 画布容器 DOM，LogicFlow 实例会挂载到这里
const container = ref<HTMLElement | null>(null);

let lf: LogicFlow | null = null;
let nodeSequence = 4;
let removeKeyboardFocusListener: (() => void) | null = null;
let removeDocumentKeydownListener: (() => void) | null = null;
let clipboard: FlowClipboardData | null = null;
let pasteSequence = 1;
// 平移/缩放只改变视口，不改变图内容；
// graph:transform 会连续触发，这里用防抖避免拖动画布时每帧全量克隆图数据。
let transformSyncTimer: number | null = null;

// 启用框选插件，支持拖拽框选多个节点或连线
LogicFlow.use(SelectionSelect);

// 连线约束：禁止节点连接到自己，避免出现自环
const customConnectRule = (source: any, target: any) => source.id !== target.id;

// 父组件还没传真实数据时，先渲染一份默认示例图
const defaultGraphData: GraphData = {
  nodes: [
    { id: '1', type: 'rect', x: 100, y: 100, text: '开始' },
    { id: '2', type: 'rect', x: 300, y: 200, text: '审批' },
    { id: '3', type: 'rect', x: 500, y: 100, text: '结束' },
  ],
  edges: [
    { id: 'edge1', sourceNodeId: '1', targetNodeId: '2', type: 'polyline' },
    { id: 'edge2', sourceNodeId: '2', targetNodeId: '3', type: 'polyline' },
  ],
};

// LogicFlow 2.x 的 render 参数是 LogicFlow.GraphConfigData（节点 type 必填），
// 而画布数据里 type 是可选字段：渲染前统一兜底
const toRenderData = (data: GraphData): never =>
  ({
    nodes: data.nodes.map((node) => ({ ...node, type: node.type ?? 'rect' })),
    edges: data.edges,
  }) as never;

// 把当前画布里的整张图同步给父组件的 v-model
const emitGraphData = () => {
  if (!lf) return;
  emit('update:modelValue', lf.getGraphData() as GraphData);
};

// 防抖版 emitGraphData：仅在平移/缩放停止一小段时间后同步一次
const scheduleTransformSync = () => {
  if (transformSyncTimer !== null) {
    window.clearTimeout(transformSyncTimer);
  }
  transformSyncTimer = window.setTimeout(() => {
    transformSyncTimer = null;
    emitGraphData();
  }, 300);
};

// 把撤销/重做是否可用同步给父组件，控制工具栏按钮状态
const emitHistoryState = () => {
  if (!lf) return;
  emit('history-change', lf.history.undoAble(), lf.history.redoAble());
};

// 统一刷新入口：只要图或历史状态发生变化，就重新同步给父组件
const refreshState = () => {
  emitGraphData();
  emitHistoryState();
};

// 把当前选中的元素同步给父组件，右侧属性面板会根据这个结果切换表单内容。
const emitSelectionChange = (value?: SelectedElement) => {
  if (value !== undefined) {
    emit('selection-change', value);
    return;
  }

  if (!lf) {
    emit('selection-change', null);
    return;
  }

  const selected = lf.getSelectElements(true) as GraphData;
  const total = selected.nodes.length + selected.edges.length;

  if (total === 0) {
    emit('selection-change', null);
    return;
  }

  if (total > 1) {
    emit('selection-change', {
      kind: 'multiple',
      data: selected,
    });
    return;
  }

  if (selected.nodes.length === 1) {
    emit('selection-change', {
      kind: 'node',
      data: selected.nodes[0],
    });
    return;
  }

  emit('selection-change', {
    kind: 'edge',
    data: selected.edges[0],
  });
};

// 根据当前节点数量，为新节点计算一个默认落点，避免刚新增时完全重叠
const getNextNodePosition = () => {
  const graphData =
    (lf?.getGraphData() as GraphData | undefined) || { nodes: [] as any[], edges: [] as any[] };
  const nodeCount = graphData.nodes.length;
  const width = container.value?.clientWidth || 1200;
  const height = container.value?.clientHeight || 800;

  return {
    x: 120 + (nodeCount % 4) * 180,
    y: 120 + Math.floor(nodeCount / 4) * 120,
    maxX: width - 120,
    maxY: height - 80,
  };
};

// 把新节点坐标限制在画布范围内，避免刚创建就超出可视区域
const clampNodePosition = (x: number, y: number) => {
  const { maxX, maxY } = getNextNodePosition();
  return {
    x: Math.min(x, maxX),
    y: Math.min(y, maxY),
  };
};

// 新增节点的通用流程：算默认位置 -> 创建节点 -> 自动选中 -> 同步状态
const addNode = (type: AddNodeType, text: string) => {
  if (!lf) return null;

  const next = getNextNodePosition();
  const position = clampNodePosition(next.x, next.y);
  const model = lf.addNode({
    id: `node_${Date.now()}_${nodeSequence++}`,
    type,
    x: position.x,
    y: position.y,
    text,
  });

  lf.selectElementById(model.id);
  refreshState();
  emitSelectionChange({
    kind: 'node',
    data: model.getData(),
  });
  return model;
};

// 支持从模板批量创建节点，便于左侧节点库直接投放常用流程节点
const addNodeFromTemplate = (template: NodeTemplate) => {
  if (!lf) return null;

  const model = addNode(template.type, template.text);
  if (!model) return null;

  if (template.properties) {
    lf.setProperties(model.id, template.properties);
    refreshState();
  }

  const element = lf.getDataById(model.id);
  if (element) {
    emitSelectionChange({
      kind: 'node',
      data: element as any,
    });
  }

  return model;
};

const addRectNode = () => addNode('rect', '新节点');
const addDiamondNode = () => addNode('diamond', '条件');

// 复制前先把选中的节点、边整理成一份剪贴板快照：
// 只复制“选中节点之间互相连接的边”，避免粘贴出残缺连线。
const copySelectedElements = () => {
  if (!lf) return null;

  const selected = lf.getSelectElements(true) as GraphData;
  if (selected.nodes.length === 0 && selected.edges.length === 0) {
    clipboard = null;
    return null;
  }

  const selectedNodeIds = new Set(selected.nodes.map((node) => node.id));
  const copiedEdges = selected.edges.filter(
    (edge) =>
      selectedNodeIds.has(edge.sourceNodeId) && selectedNodeIds.has(edge.targetNodeId),
  );

  const minX = selected.nodes.length > 0 ? Math.min(...selected.nodes.map((node) => node.x)) : 0;
  const minY = selected.nodes.length > 0 ? Math.min(...selected.nodes.map((node) => node.y)) : 0;

  clipboard = {
    nodes: selected.nodes.map((node) => ({
      ...node,
      properties: node.properties ? { ...node.properties } : undefined,
      text:
        typeof node.text === 'object' && node.text
          ? { ...node.text }
          : node.text,
    })),
    edges: copiedEdges.map((edge) => ({
      ...edge,
      properties: edge.properties ? { ...edge.properties } : undefined,
      text:
        typeof edge.text === 'object' && edge.text
          ? { ...edge.text }
          : edge.text,
    })),
    anchor: {
      x: minX,
      y: minY,
    },
  };

  return clipboard;
};

// 基于已有节点 id 生成新 id，避免复制粘贴后和原图冲突
const createPastedId = (prefix: string) => `${prefix}_${Date.now()}_${pasteSequence++}`;

// 粘贴时整体向右下偏移一点，让用户能直观看到“新复制出来的一份”
const pasteClipboardElements = () => {
  if (!lf || !clipboard || clipboard.nodes.length === 0) return 0;

  const graphData = lf.getGraphData() as GraphData;
  const existingNodeIds = new Set(graphData.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(graphData.edges.map((edge) => edge.id));
  const idMap = new Map<string, string>();
  const offsetX = 48;
  const offsetY = 36;
  const pastedNodeIds: string[] = [];
  const pastedEdgeIds: string[] = [];

  clipboard.nodes.forEach((node) => {
    let nextId = createPastedId('node');
    while (existingNodeIds.has(nextId)) {
      nextId = createPastedId('node');
    }
    existingNodeIds.add(nextId);
    idMap.set(node.id, nextId);

    lf?.addNode({
      ...node,
      id: nextId,
      // 画布数据的节点一定有 type；这里兜底 rect 以满足 NodeConfig 类型要求
      type: node.type ?? 'rect',
      x: node.x + offsetX,
      y: node.y + offsetY,
      properties: node.properties ? { ...node.properties } : undefined,
      text:
        typeof node.text === 'object' && node.text
          // LogicFlow 的 TextConfig 要求对象带 x/y；画布数据的 text 对象均由 LogicFlow 生成，运行时必然携带
          ? ({ ...node.text, value: node.text.value ?? '' } as { x: number; y: number; value: string })
          : node.text,
    });
    pastedNodeIds.push(nextId);
  });

  clipboard.edges.forEach((edge) => {
    const sourceNodeId = idMap.get(edge.sourceNodeId);
    const targetNodeId = idMap.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) return;

    let nextId = createPastedId('edge');
    while (existingEdgeIds.has(nextId)) {
      nextId = createPastedId('edge');
    }
    existingEdgeIds.add(nextId);

    lf?.addEdge({
      ...edge,
      id: nextId,
      sourceNodeId,
      targetNodeId,
      properties: edge.properties ? { ...edge.properties } : undefined,
      text:
        typeof edge.text === 'object' && edge.text
          // LogicFlow 的边文本配置要求对象带 x/y；画布数据的 text 对象均由 LogicFlow 生成，运行时必然携带
          ? ({ ...edge.text, value: edge.text.value ?? '' } as { x: number; y: number; value: string })
          : edge.text,
    });
    pastedEdgeIds.push(nextId);
  });

  lf.clearSelectElements();
  pastedNodeIds.forEach((id) => lf?.selectElementById(id, true));
  pastedEdgeIds.forEach((id) => lf?.selectElementById(id, true));
  refreshState();
  emitSelectionChange();

  return pastedNodeIds.length + pastedEdgeIds.length;
};

// “重复创建”本质上是复制后立即粘贴，保留一份连续搭图的高效操作
const duplicateSelectedElements = () => {
  const copied = copySelectedElements();
  if (!copied) return 0;
  return pasteClipboardElements();
};

// 删除当前选中的节点和边，返回删除数量给父组件做提示
const deleteSelectedElements = () => {
  if (!lf) return 0;

  const selected = lf.getSelectElements(true) as GraphData;
  const edgeIds = selected.edges.map((edge) => edge.id);
  const nodeIds = selected.nodes.map((node) => node.id);
  const total = edgeIds.length + nodeIds.length;

  if (total === 0) return 0;

  edgeIds.forEach((id) => lf?.deleteEdge(id));
  nodeIds.forEach((id) => lf?.deleteNode(id));
  lf.clearSelectElements();
  refreshState();
  emitSelectionChange(null);
  return total;
};

// 全选当前画布里的所有节点和连线，方便批量处理
const selectAllElements = () => {
  if (!lf) return 0;

  const graphData = lf.getGraphData() as GraphData;
  if (graphData.nodes.length === 0 && graphData.edges.length === 0) {
    return 0;
  }

  lf.clearSelectElements();
  graphData.nodes.forEach((node) => {
    lf?.selectElementById(node.id, true);
  });
  graphData.edges.forEach((edge) => {
    lf?.selectElementById(edge.id, true);
  });

  emitSelectionChange();
  return graphData.nodes.length + graphData.edges.length;
};

// 取消当前选中状态，快捷键或页面按钮都可以调用
const clearSelection = () => {
  if (!lf) return;
  lf.clearSelectElements();
  emitSelectionChange(null);
};

// 点击问题列表时，把节点或连线定位到画布中心，方便快速排查
const focusElement = (id: string) => {
  if (!lf) return;
  lf.selectElementById(id);
  lf.focusOn({ id });
};

// 撤销/重做后主动刷新一次父组件状态，确保按钮和图数据同步
const undo = () => {
  lf?.undo();
  refreshState();
};

const redo = () => {
  lf?.redo();
  refreshState();
};

// 直接返回当前画布里的原始图数据
const getGraphData = () => lf?.getGraphData();

// 更新节点或边的显示文本：
// 例如节点标题、连线文字都走这条更新链路。
const updateElementText = (id: string, value: string) => {
  if (!lf) return;
  lf.updateText(id, value);
  refreshState();

  const element = lf.getDataById(id);
  if (!element) return;

  emitSelectionChange({
    kind: 'sourceNodeId' in element ? 'edge' : 'node',
    data: element as any,
  });
};

// 更新节点或边的自定义业务属性：
// 这部分数据会进入 properties，后续保存 JSON、保存后端时会一起带上。
const updateElementProperties = (id: string, properties: Record<string, any>) => {
  if (!lf) return;
  lf.setProperties(id, properties);
  refreshState();

  const element = lf.getDataById(id);
  if (!element) return;

  emitSelectionChange({
    kind: 'sourceNodeId' in element ? 'edge' : 'node',
    data: element as any,
  });
};

// 批量更新多个节点的业务属性（属性面板多选批量编辑用）：
// setProperties 是整体覆盖，所以每个节点先取旧属性再合并传入的字段。
const batchUpdateNodeProperties = (ids: string[], properties: Record<string, any>) => {
  if (!lf || ids.length === 0) return 0;

  let updated = 0;
  // 用 for...of 而不是 forEach：循环体和守卫在同一作用域，TS 的空值收窄直接生效
  for (const id of ids) {
    const model = lf.getNodeModelById(id);
    if (!model) continue;
    lf.setProperties(id, { ...(model.properties || {}), ...properties });
    updated += 1;
  }

  if (updated > 0) {
    refreshState();
    emitSelectionChange();
  }
  return updated;
};

// 批量切换节点类型（rect <-> diamond）：
// LogicFlow 会保留节点的位置、文本和已有属性。
const batchChangeNodeType = (ids: string[], type: string) => {
  if (!lf || ids.length === 0) return 0;

  let changed = 0;
  for (const id of ids) {
    if (!lf.getNodeModelById(id)) continue;
    lf.changeNodeType(id, type);
    changed += 1;
  }

  if (changed > 0) {
    refreshState();
    emitSelectionChange();
  }
  return changed;
};

// 给智能布局准备数据：在普通图数据基础上补上节点宽高
const getLayoutGraphData = () => {
  if (!lf) return null;

  const graphData = lf.getGraphData() as GraphData;
  const nodes = graphData.nodes.map((node) => {
    const model = lf?.getNodeModelById(node.id);
    return {
      ...node,
      width: model?.width || 100,
      height: model?.height || 80,
    };
  });

  return {
    nodes,
    edges: graphData.edges,
  } as LayoutGraphData;
};

// 自动缩放视图，让整张图尽量完整出现在可视区域中
const fitView = () => {
  lf?.fitView(40, 40);
};

// 把布局算法算出的新坐标真正应用到 LogicFlow 节点模型上
const applyNodePositions = (positions: NodePosition[]) => {
  if (!lf) return null;

  positions.forEach((position) => {
    try {
      lf?.graphModel.moveNode2Coordinate(position.id, position.x, position.y);
    } catch (error) {
      console.warn(`Failed to move node ${position.id}`, error);
    }
  });

  refreshState();
  return lf.getGraphData() as GraphData;
};

// 二次优化折线走向：
// 先按节点位置重新分配每条边的“分流/汇流通道”，再去掉重复折点
const optimizeEdgeRoutes = () => {
  if (!lf) return null;

  const graphData = lf.getGraphData() as GraphData;
  const nodeMap = new Map(
    graphData.nodes.map((node) => {
      const model = lf?.getNodeModelById(node.id);
      return [
        node.id,
        {
          ...node,
          x: model?.x ?? node.x,
          y: model?.y ?? node.y,
          width: model?.width ?? 100,
          height: model?.height ?? 80,
        },
      ];
    }),
  );

  // outgoingMap：某个节点发出的所有边
  // incomingMap：某个节点流入的所有边
  const outgoingMap = new Map<string, any[]>();
  const incomingMap = new Map<string, any[]>();

  graphData.edges.forEach((edge) => {
    if (!outgoingMap.has(edge.sourceNodeId)) {
      outgoingMap.set(edge.sourceNodeId, []);
    }
    if (!incomingMap.has(edge.targetNodeId)) {
      incomingMap.set(edge.targetNodeId, []);
    }
    outgoingMap.get(edge.sourceNodeId)?.push(edge);
    incomingMap.get(edge.targetNodeId)?.push(edge);
  });

  // 排序结果只依赖 nodeMap，循环外预排序一次，避免每条边都重复 slice+sort
  const sortedOutgoing = new Map<string, any[]>();
  const sortedIncoming = new Map<string, any[]>();
  outgoingMap.forEach((edges, nodeId) => {
    sortedOutgoing.set(
      nodeId,
      edges.slice().sort((a, b) => {
        const targetA = nodeMap.get(a.targetNodeId);
        const targetB = nodeMap.get(b.targetNodeId);
        if (!targetA || !targetB) return 0;
        if (targetA.y !== targetB.y) return targetA.y - targetB.y;
        return targetA.x - targetB.x;
      }),
    );
  });
  incomingMap.forEach((edges, nodeId) => {
    sortedIncoming.set(
      nodeId,
      edges.slice().sort((a, b) => {
        const sourceA = nodeMap.get(a.sourceNodeId);
        const sourceB = nodeMap.get(b.sourceNodeId);
        if (!sourceA || !sourceB) return 0;
        if (sourceA.y !== sourceB.y) return sourceA.y - sourceB.y;
        return sourceA.x - sourceB.x;
      }),
    );
  });

  // 统一把坐标处理成整数，避免折点出现很多小数
  const round = (value: number) => Math.round(value);
  const toPoint = (x: number, y: number): Point => ({ x: round(x), y: round(y) });

  // 去掉重复点和落在同一直线上的无效中间点，让 pointsList 更干净
  const dedupePoints = (points: Point[]) => {
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

  graphData.edges.forEach((edge) => {
    const source = nodeMap.get(edge.sourceNodeId);
    const target = nodeMap.get(edge.targetNodeId);
    const edgeModel = lf?.getEdgeModelById(edge.id);

    if (!source || !target || !edgeModel) return;

    // 同一起点的出边已按目标节点位置预排序，决定谁走上面的通道、谁走下面的通道
    const sourceOutgoing = sortedOutgoing.get(edge.sourceNodeId) || [];

    // 同一终点的入边已按来源节点位置预排序，决定汇入终点时的错位顺序
    const targetIncoming = sortedIncoming.get(edge.targetNodeId) || [];

    const outgoingIndex = Math.max(0, sourceOutgoing.findIndex((item) => item.id === edge.id));
    const incomingIndex = Math.max(0, targetIncoming.findIndex((item) => item.id === edge.id));

    const horizontalDistance = Math.abs(target.x - source.x);
    const verticalDistance = Math.abs(target.y - source.y);
    // 更接近上下方向时，优先走纵向折线；否则走横向主通道
    const isVerticalRoute =
      horizontalDistance < Math.max(source.width, target.width) * 0.9 &&
      verticalDistance > Math.max(source.height, target.height) * 0.6;

    if (isVerticalRoute) {
      // 纵向走线：从上下边缘进出，中间只保留一段横向折线
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

      lf?.updateAttributes(edge.id, {
        startPoint,
        endPoint,
        pointsList,
      });
      return;
    }

    // 横向走线：先从起点分流，再走中间 lane，最后在终点附近汇入
    const direction = target.x >= source.x ? 1 : -1;
    const startPoint = toPoint(source.x + (direction * source.width) / 2, source.y);
    const endPoint = toPoint(target.x - (direction * target.width) / 2, target.y);
    const branchCount = sourceOutgoing.length;
    const mergeCount = targetIncoming.length;
    const laneGap = 42;
    const branchOffset =
      branchCount > 1 ? (outgoingIndex - (branchCount - 1) / 2) * laneGap : 0;
    const mergeOffset =
      mergeCount > 1 ? (incomingIndex - (mergeCount - 1) / 2) * 18 : 0;
    // laneY 表示这条边在中间横向主通道上走的那条“高度层”
    const laneY = round(source.y + branchOffset);
    const distance = Math.max(horizontalDistance, 80);
    const sourceGap = Math.min(104, Math.max(42, distance * 0.22));
    const targetGap = Math.min(88, Math.max(36, distance * 0.18));
    let splitX = round(startPoint.x + direction * sourceGap);
    let mergeX = round(endPoint.x - direction * targetGap);
    const minimumChannel = 36;

    // splitX 和 mergeX 过近时，强行拉开一段最小通道，避免折线挤成一团
    if (
      (direction > 0 && splitX > mergeX - minimumChannel) ||
      (direction < 0 && splitX < mergeX + minimumChannel)
    ) {
      const centerX = round((startPoint.x + endPoint.x) / 2);
      splitX = centerX - direction * Math.ceil(minimumChannel / 2);
      mergeX = centerX + direction * Math.ceil(minimumChannel / 2);
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

    lf?.updateAttributes(edge.id, {
      startPoint,
      endPoint,
      pointsList,
    });
  });

  refreshState();
  return lf.getGraphData() as GraphData;
};

// 用一整份图数据重绘画布，同时把最新状态再同步回父组件
const setGraphData = (data: GraphData) => {
  lf?.render(toRenderData(data));
  refreshState();
};

// 导出为格式化后的 JSON 字符串，便于查看和持久化
const exportData = () => (lf ? JSON.stringify(lf.getGraphData(), null, 2) : '');

// 从 JSON 字符串恢复流程图
// 除了 JSON 语法，还校验基本结构和边引用，避免坏数据渲染坏画布
const importData = (json: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    console.error('Failed to import flow JSON', error);
    throw error;
  }

  const data = parsed as Partial<GraphData> | null;
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Invalid flow data structure');
  }

  // 丢弃缺少 id 的节点，以及引用不存在节点或自环的边
  const validNodes = data.nodes.filter((node) => node && node.id != null);
  const nodeIds = new Set(validNodes.map((node) => node.id));
  const validEdges = data.edges.filter(
    (edge) =>
      edge &&
      edge.sourceNodeId != null &&
      edge.targetNodeId != null &&
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId) &&
      edge.sourceNodeId !== edge.targetNodeId,
  );

  lf?.render(toRenderData({ nodes: validNodes, edges: validEdges } as GraphData));
  refreshState();
};

// 递归把 SVG 上每个元素的计算后样式写回内联 style
// 这样导出时即使脱离当前页面 CSS，图片样式也尽量保持不变
const inlineSvgStyles = (sourceEl: Element, targetEl: Element) => {
  // 获取浏览器最终算出来的样式
  // 当前元素的样式对象
  const computedStyle = window.getComputedStyle(sourceEl);
  // 把所有样式拼成一整条 CSS 字符串
  const styleText = Array.from(computedStyle)
    .map((styleName) => `${styleName}:${computedStyle.getPropertyValue(styleName)};`)
    .join('');

  targetEl.setAttribute('style', styleText);

  // 克隆节点对应位置的子元素
  Array.from(sourceEl.children).forEach((child, index) => {
    const clonedChild = targetEl.children[index];
    if (clonedChild) {
      inlineSvgStyles(child, clonedChild);
    }
  });
};

// 拿到 SVG -> 克隆并内联样式 -> 画到 canvas -> 导出 PNG
const exportPngDataUrl = async () => {
  if (!container.value) return null;

  const svg = container.value.querySelector('svg');
  if (!svg) return null;

  const rect = container.value.getBoundingClientRect();
  const width = Math.max(Math.round(rect.width || svg.clientWidth || 1), 1);
  const height = Math.max(Math.round(rect.height || svg.clientHeight || 1), 1);
  const clonedSvg = svg.cloneNode(true) as SVGSVGElement;

  // 先把 SVG 变成一份“自带样式”的独立资源，再转图片
  inlineSvgStyles(svg, clonedSvg);
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clonedSvg.setAttribute('width', `${width}`);
  clonedSvg.setAttribute('height', `${height}`);

  if (!clonedSvg.getAttribute('viewBox')) {
    clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  // 把 svg 转成字符串和临时地址，再加载到 Image 里画到 canvas 上，最后导出 PNG 数据 URL
  // 序列化后的 SVG 字符串
  const svgText = new XMLSerializer().serializeToString(clonedSvg);
  // 把字符串包装成一个 SVG 文件对象，生成一个临时 URL 地址
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  // 浏览器创建的临时资源地址，指向上面那个 SVG 文件对象
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    // 等图片异步加载成功后再绘制到 canvas，所以这里包了一层 Promise
    // SVG加载成功后画到canvas上，最后再从canvas上导出pngDataUrl，这个 URL 就是最终导出的 PNG 图片数据了
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        // 高清屏下按 devicePixelRatio 放大画布，导出的图片会更清晰
        const ratio = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(Math.round(width * ratio), 1);
        canvas.height = Math.max(Math.round(height * ratio), 1);
        // // 2D 绘图上下文
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context is not available'));
          return;
        }

        ctx.scale(ratio, ratio);
        // 先铺白底，避免导出的 PNG 背景透明
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        // 把加载好的 SVG 图片画到 canvas 上
        ctx.drawImage(image, 0, 0, width, height);
        // 把 canvas 转成pngDataUrl，这个 URL 就是最终导出的 PNG 图片数据了
        resolve(canvas.toDataURL('image/png'));
      };

      image.onerror = () => {
        reject(new Error('Failed to load SVG for export'));
      };

      image.src = svgUrl;
    });

    // 传给父组件触发下载
    return dataUrl;
  } catch (error) {
    console.error('Failed to export PNG', error);
    return null;
  } finally {
    // 释放前面创建的临时 URL，避免内存泄漏
    URL.revokeObjectURL(svgUrl);
  }
};

// LogicFlow 的快捷键（mousetrap）只监听画布容器：焦点落在工具栏按钮或 body 上时，
// Delete / Backspace / Ctrl+A 会完全失效。这里补一层 document 级监听兜底，
// 同时从 LogicFlow keyboard 配置里移除对应两项，避免同一按键触发两次。
const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (!lf || lf.graphModel.textEditElement) return;

  // 正在输入框（模板搜索、属性表单等）里打字时不接管按键
  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      return;
    }
  }

  // 弹窗/抽屉打开时（Element Plus 会给 body 加锁滚类）不响应画布快捷键，
  // 避免版本管理抽屉背后误删画布元素
  if (document.body.classList.contains('el-popup-parent--hidden')) return;

  const mod = event.ctrlKey || event.metaKey;

  if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
    // 只有真的删掉了元素才拦截默认行为，避免影响浏览器的其它按键场景
    if (deleteSelectedElements() > 0) {
      event.preventDefault();
    }
    return;
  }

  if (mod && !event.shiftKey && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault();
    selectAllElements();
  }
};

onMounted(() => {
  if (!container.value) return;

  // 初始化 LogicFlow 实例：真正的画布就是在这里创建出来的
  lf = new LogicFlow({
    container: container.value,
    grid: true,
    width: container.value.clientWidth,
    height: container.value.clientHeight,
    edgeType: 'polyline',
    // LogicFlow 2.x 内置的节点缩放：拖拽节点四角控制点即可调整宽高
    allowResize: true,
    animation: {
      edge: true,
      node: false,
    },
    keyboard: {
      enabled: true,
      shortcuts: [
        // Delete/Backspace 和 Ctrl/Cmd+A 已迁移到 document 级监听（见 handleDocumentKeydown），
        // 解决焦点不在画布容器上时快捷键失效的问题
        {
          // Ctrl/Cmd + C 复制当前选中元素
          keys: ['ctrl + c', 'cmd + c'],
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            copySelectedElements();
          },
          action: 'keydown',
        },
        {
          // Ctrl/Cmd + V 粘贴一份复制结果
          keys: ['ctrl + v', 'cmd + v'],
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            pasteClipboardElements();
          },
          action: 'keydown',
        },
        {
          // Ctrl/Cmd + D 快速重复创建当前选中元素
          keys: ['ctrl + d', 'cmd + d'],
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            duplicateSelectedElements();
          },
          action: 'keydown',
        },
        {
          // Esc 取消当前选中，方便快速收起多选框状态
          keys: 'esc',
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            clearSelection();
          },
          action: 'keydown',
        },
        {
          // 额外补上 Ctrl/Cmd + Shift + Z 作为 redo 快捷键
          keys: ['ctrl + shift + z', 'cmd + shift + z'],
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            redo();
          },
          action: 'keydown',
        },
      ],
    },
    plugins: [SelectionSelect, MiniMap],
    edgeGenerator: (sourceNode, targetNode) => {
      if (!customConnectRule(sourceNode, targetNode)) return false;
      // 当前项目统一使用折线，便于后面做路由优化
      return 'polyline';
    },
  });

  // 监听 LogicFlow 内部变化，再同步回 Vue 的状态系统
  lf.on('history:change', emitHistoryState);
  lf.on('node:add', refreshState);
  lf.on('node:delete', refreshState);
  lf.on('edge:add', refreshState);
  lf.on('edge:delete', refreshState);
  lf.on('graph:transform', scheduleTransformSync);
  lf.on('text:update', refreshState);
  // 选中节点、连线、多选框选或点击空白时，把选中结果同步给父组件。
  lf.on('node:click', ({ data }) => {
    emitSelectionChange({
      kind: 'node',
      data,
    });
  });
  lf.on('edge:click', ({ data }) => {
    emitSelectionChange({
      kind: 'edge',
      data,
    });
  });
  lf.on('selection:selected', () => emitSelectionChange());
  lf.on('blank:click', () => emitSelectionChange(null));

  // LogicFlow 2.x 框选插件默认不启用，需要显式打开；
  // 这里在初始化时开启框选，与升级前的行为保持一致
  // （插件实例在类型声明上是宽泛的 Extension 联合类型，经 unknown 收窄到实际插件接口）
  (lf.extension.selectionSelect as unknown as { open: () => void } | undefined)?.open();
  // 2.x 的 MiniMap 同样改为默认隐藏，需要显式 show
  (lf.extension.miniMap as unknown as { show: () => void } | undefined)?.show();

  // 让画布在点击后拿到焦点，这样键盘快捷键才能稳定生效
  const graphContainer = lf.container;
  const focusGraphContainer = () => graphContainer.focus();
  graphContainer.addEventListener('pointerdown', focusGraphContainer);
  removeKeyboardFocusListener = () => {
    graphContainer.removeEventListener('pointerdown', focusGraphContainer);
  };
  focusGraphContainer();

  // Delete / Backspace / Ctrl+A 挂到 document 级，焦点不在画布上也能生效
  document.addEventListener('keydown', handleDocumentKeydown);
  removeDocumentKeydownListener = () => {
    document.removeEventListener('keydown', handleDocumentKeydown);
  };

  // 父组件有数据就渲染父组件的数据，没有就先用默认示例图
  lf.render(toRenderData(props.modelValue || defaultGraphData));
  // LogicFlow 2.x 的 MiniMap 存在竞态：内部可能在挂载容器就绪前就把 isShow
  // 置为 true（DOM 实际未创建），导致后续 show() 被 if (!isShow) 短路而永不渲染；
  // 而 hide() 又会因内部 lfMap 未初始化抛错。这里在主画布渲染完成后（容器已注入）
  // 直接复位 isShow 再 show，让插件重新走完整的挂载流程
  setTimeout(() => {
    if (!lf) return;
    const miniMap = lf.extension.miniMap as unknown as
      | { isShow?: boolean; show?: () => void }
      | undefined;
    if (!miniMap) return;
    miniMap.isShow = false;
    miniMap.show?.();
  }, 0);
  emitHistoryState();
  emitGraphData();
  emitSelectionChange(null);
});

onBeforeUnmount(() => {
  // 组件销毁时移除事件并销毁 LogicFlow 实例，避免泄漏
  removeKeyboardFocusListener?.();
  removeKeyboardFocusListener = null;
  removeDocumentKeydownListener?.();
  removeDocumentKeydownListener = null;
  if (transformSyncTimer !== null) {
    window.clearTimeout(transformSyncTimer);
    transformSyncTimer = null;
  }
  lf?.destroy();
});

// 返回画布容器的实际尺寸，供父组件做布局计算，避免父组件用 DOM 选择器刺穿组件边界
const getContainerSize = () => ({
  width: container.value?.clientWidth || 1200,
  height: container.value?.clientHeight || 800,
});

// 暴露给父组件的方法：
// 父组件通过 designerRef 调用这些方法，控制画布、导出数据、触发布局等
defineExpose({
  undo,
  redo,
  getGraphData,
  getLayoutGraphData,
  fitView,
  applyNodePositions,
  optimizeEdgeRoutes,
  getContainerSize,
  setGraphData,
  exportData,
  importData,
  exportPngDataUrl,
  updateElementText,
  updateElementProperties,
  batchUpdateNodeProperties,
  batchChangeNodeType,
  addRectNode,
  addDiamondNode,
  addNodeFromTemplate,
  deleteSelectedElements,
  selectAllElements,
  clearSelection,
  focusElement,
  copySelectedElements,
  pasteClipboardElements,
  duplicateSelectedElements,
});
</script>

<style scoped>
.flow-designer {
  width: 100%;
  height: 100%;
  background: #f5f7fa;
}
</style>

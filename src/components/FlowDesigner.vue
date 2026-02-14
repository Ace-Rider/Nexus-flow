<template>
  <div ref="container" class="flow-designer"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import LogicFlow from '@logicflow/core';
import '@logicflow/core/dist/style/index.css';
import { SelectionSelect } from '@logicflow/extension';
import '@logicflow/extension/lib/style/index.css';

type GraphData = {
  nodes: any[];
  edges: any[];
};

type AddNodeType = 'rect' | 'diamond';

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
}>();

const container = ref<HTMLElement | null>(null);
let lf: LogicFlow | null = null;
let nodeSequence = 4;
let removeKeyboardFocusListener: (() => void) | null = null;

// 启用框选插件：支持鼠标拖拽框选多个节点或边
LogicFlow.use(SelectionSelect);

// 连线约束：禁止节点连接到自己，避免自环
const customConnectRule = (source: any, target: any) => source.id !== target.id;

// 默认示例图：父组件未传入数据时先渲染这一份
const defaultGraphData: GraphData = {
  nodes: [
    { id: '1', type: 'rect', x: 100, y: 100, text: '\u5f00\u59cb' },
    { id: '2', type: 'rect', x: 300, y: 200, text: '\u5ba1\u6279' },
    { id: '3', type: 'rect', x: 500, y: 100, text: '\u7ed3\u675f' },
  ],
  edges: [
    { id: 'edge1', sourceNodeId: '1', targetNodeId: '2', type: 'polyline' },
    { id: 'edge2', sourceNodeId: '2', targetNodeId: '3', type: 'polyline' },
  ],
};

// 把当前画布数据同步给父组件的 v-model
const emitGraphData = () => {
  if (!lf) return;
  emit('update:modelValue', lf.getGraphData() as GraphData);
};

// 同步撤销/重做状态，供父组件控制按钮可用性
const emitHistoryState = () => {
  if (!lf) return;
  emit('history-change', lf.history.undoAble(), lf.history.redoAble());
};

// 图数据或历史状态变化时，统一刷新给父组件
const refreshState = () => {
  emitGraphData();
  emitHistoryState();
};

// 根据当前节点数量，计算新增节点的默认摆放位置
const getNextNodePosition = () => {
  const graphData = (lf?.getGraphData() as GraphData | undefined) || { nodes: [] as any[], edges: [] as any[] };
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

// 限制节点坐标不要跑出画布边界
const clampNodePosition = (x: number, y: number) => {
  const { maxX, maxY } = getNextNodePosition();
  return {
    x: Math.min(x, maxX),
    y: Math.min(y, maxY),
  };
};

// 新增节点通用流程：算位置 -> 创建节点 -> 选中节点 -> 同步状态
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
  return model;
};

const addRectNode = () => addNode('rect', '\u65b0\u8282\u70b9');
const addDiamondNode = () => addNode('diamond', '\u6761\u4ef6');

// 删除当前选中的节点和边，并返回删除数量
const deleteSelectedElements = () => {
  if (!lf) return 0;

  const selected = lf.getSelectElements(true) as GraphData;
  const edgeIds = selected.edges.map((edge) => edge.id);
  const nodeIds = selected.nodes.map((node) => node.id);
  const total = edgeIds.length + nodeIds.length;

  if (total === 0) return 0;

  // 先删边，再删节点，避免关联关系出问题
  edgeIds.forEach((id) => lf?.deleteEdge(id));
  nodeIds.forEach((id) => lf?.deleteNode(id));
  lf.clearSelectElements();
  refreshState();
  return total;
};

onMounted(() => {
  if (!container.value) return;

  // 初始化 LogicFlow 实例：这一步会真正创建画布
  lf = new LogicFlow({
    container: container.value,
    grid: true,
    width: container.value.clientWidth,
    height: container.value.clientHeight,
    edgeType: 'polyline',
    keyboard: {
      enabled: true,
      shortcuts: [
        {
          keys: 'delete',
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            deleteSelectedElements();
          },
          action: 'keydown',
        },
        {
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
    plugins: [SelectionSelect],
    edgeGenerator: (sourceNode, targetNode) => {
      // 先校验连线规则，不允许自连接
      if (!customConnectRule(sourceNode, targetNode)) return false;
      // 默认生成折线
      return 'polyline';
    },
  });

  // 监听画布内部变化，把状态同步回 Vue
  lf.on('history:change', emitHistoryState);
  lf.on('node:add', refreshState);
  lf.on('node:delete', refreshState);
  lf.on('edge:add', refreshState);
  lf.on('edge:delete', refreshState);
  lf.on('graph:transform', emitGraphData);
  lf.on('text:update', refreshState);

  // 父组件有数据就渲染父组件的数据，没有就渲染默认图
  lf.openSelectionSelect?.();


  const graphContainer = lf.container;
  const focusGraphContainer = () => graphContainer.focus();
  graphContainer.addEventListener('pointerdown', focusGraphContainer);
  removeKeyboardFocusListener = () => {
    graphContainer.removeEventListener('pointerdown', focusGraphContainer);
  };
  focusGraphContainer();

  lf.render(props.modelValue || defaultGraphData);
  emitHistoryState();
  emitGraphData();
});

onBeforeUnmount(() => {
  removeKeyboardFocusListener?.();
  removeKeyboardFocusListener = null;
  lf?.destroy();
});

// 撤销后要刷新状态，确保父组件按钮状态同步
const undo = () => {
  lf?.undo();
  refreshState();
};

// 重做后要刷新状态，确保父组件按钮状态同步
const redo = () => {
  lf?.redo();
  refreshState();
};

// 直接返回当前画布的原始图数据
const getGraphData = () => lf?.getGraphData();

// 提供给布局算法使用：在普通图数据基础上补上节点宽高
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

// 让画布自动缩放，尽量把整张图显示完整
const fitView = () => {
  lf?.fitView(40, 40);
};

// 把布局算法算出的新坐标真正落到节点上
const applyNodePositions = (positions: NodePosition[]) => {
  if (!lf) return null;

  positions.forEach((position) => {
    try {
      lf.graphModel.moveNode2Coordinate(position.id, position.x, position.y);
    } catch (error) {
      console.warn(`Failed to move node ${position.id}`, error);
    }
  });

  refreshState();
  return lf.getGraphData() as GraphData;
};

// 对边线进行二次优化，减少长横线和重叠拐点
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
    })
  );

  // outgoingMap：每个节点的出边分组
  // incomingMap：每个节点的入边分组
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

  // 统一把坐标处理成整数
  const round = (value: number) => Math.round(value);
  const toPoint = (x: number, y: number): Point => ({ x: round(x), y: round(y) });

  // 去掉重复点和位于同一直线上的无意义中间点
  const dedupePoints = (points: Point[]) => {
    // 筛选掉重复的点
    const compact = points.filter((point, index) => {
      if (index === 0) return true;
      const prev = points[index - 1];
      return prev.x !== point.x || prev.y !== point.y;
    });
    // 筛选掉在同一直线上的点
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

    // 同一起点的出边：按目标节点位置排序，决定谁先分流
    const sourceOutgoing = (outgoingMap.get(edge.sourceNodeId) || []).slice().sort((a, b) => {
      const targetA = nodeMap.get(a.targetNodeId);
      const targetB = nodeMap.get(b.targetNodeId);
      if (!targetA || !targetB) return 0;
      if (targetA.y !== targetB.y) return targetA.y - targetB.y;
      return targetA.x - targetB.x;
    });

    // 同一终点的入边：按起始节点位置排序，决定谁先汇入
    const targetIncoming = (incomingMap.get(edge.targetNodeId) || []).slice().sort((a, b) => {
      const sourceA = nodeMap.get(a.sourceNodeId);
      const sourceB = nodeMap.get(b.sourceNodeId);
      if (!sourceA || !sourceB) return 0;
      if (sourceA.y !== sourceB.y) return sourceA.y - sourceB.y;
      return sourceA.x - sourceB.x;
    });

    const outgoingIndex = Math.max(0, sourceOutgoing.findIndex((item) => item.id === edge.id));
    const incomingIndex = Math.max(0, targetIncoming.findIndex((item) => item.id === edge.id));

    // 先判断这条边更适合横向走线还是纵向走线
    const horizontalDistance = Math.abs(target.x - source.x);
    const verticalDistance = Math.abs(target.y - source.y);
    const isVerticalRoute =
      horizontalDistance < Math.max(source.width, target.width) * 0.9 &&
      verticalDistance > Math.max(source.height, target.height) * 0.6;

    if (isVerticalRoute) {
      // 纵向路线：从上/下边缘进出，中间走一段横线
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

      lf.updateAttributes(edge.id, {
        startPoint,
        endPoint,
        pointsList,
      });
      return;
    }

    // 横向路线：从左右边缘进出，中间分车道
    const direction = target.x >= source.x ? 1 : -1;
    const startPoint = toPoint(source.x + (direction * source.width) / 2, source.y);
    const endPoint = toPoint(target.x - (direction * target.width) / 2, target.y);
    // 起始节点的出边数量
    const branchCount = sourceOutgoing.length;
    // 终止节点的入边数量
    const mergeCount = targetIncoming.length;
    // 中间车道边的上下偏移量，保证多条边不重叠
    const laneGap = 42;
    const branchOffset = branchCount > 1
      ? (outgoingIndex - (branchCount - 1) / 2) * laneGap  //距离中间车道的竖直偏移量
      : 0;
    const mergeOffset = mergeCount > 1
      ? (incomingIndex - (mergeCount - 1) / 2) * 18       //距离终点竖轴的竖直偏移量
      : 0;
    // laneY：这条边中间横向通道所在的高度
    const laneY = round(source.y + branchOffset);
    const distance = Math.max(horizontalDistance, 80);
    const sourceGap = Math.min(104, Math.max(42, distance * 0.22));
    const targetGap = Math.min(88, Math.max(36, distance * 0.18));
    let splitX = round(startPoint.x + direction * sourceGap);
    let mergeX = round(endPoint.x - direction * targetGap);
    const minimumChannel = 36;

    if ((direction > 0 && splitX > mergeX - minimumChannel) || (direction < 0 && splitX < mergeX + minimumChannel)) {
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

    lf.updateAttributes(edge.id, {
      startPoint,
      endPoint,
      pointsList,
    });
  });

  refreshState();
  return lf.getGraphData() as GraphData;
};

// 用一份完整流程图数据重绘画布
const setGraphData = (data: GraphData) => {
  lf?.render(data);
  refreshState();
};

// 导出当前流程图为格式化后的 JSON 字符串
const exportData = () => (lf ? JSON.stringify(lf.getGraphData(), null, 2) : '');

// 从 JSON 字符串恢复流程图
const importData = (json: string) => {
  try {
    const data = JSON.parse(json) as GraphData;
    lf?.render(data);
    refreshState();
  } catch (error) {
    console.error('瀵煎叆娴佺▼鏁版嵁澶辫触', error);
    throw error;
  }
};

// 把这些方法暴露给父组件，父组件可以通过 ref 直接调用
defineExpose({
  undo,
  redo,
  getGraphData,
  getLayoutGraphData,
  fitView,
  applyNodePositions,
  optimizeEdgeRoutes,
  setGraphData,
  exportData,
  importData,
  addRectNode,
  addDiamondNode,
  deleteSelectedElements,
});
</script>

<style scoped>
.flow-designer {
  width: 100%;
  height: 100%;
  background: #f5f7fa;
}
</style>

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

// 画布容器 DOM，LogicFlow 实例会挂载到这里
const container = ref<HTMLElement | null>(null);

let lf: LogicFlow | null = null;
let nodeSequence = 4;
let removeKeyboardFocusListener: (() => void) | null = null;

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

// 把当前画布里的整张图同步给父组件的 v-model
const emitGraphData = () => {
  if (!lf) return;
  emit('update:modelValue', lf.getGraphData() as GraphData);
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
  return model;
};

const addRectNode = () => addNode('rect', '新节点');
const addDiamondNode = () => addNode('diamond', '条件');

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
  return total;
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
      lf.graphModel.moveNode2Coordinate(position.id, position.x, position.y);
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

    // 同一起点的出边先按目标节点位置排序，决定谁走上面的通道、谁走下面的通道
    const sourceOutgoing = (outgoingMap.get(edge.sourceNodeId) || []).slice().sort((a, b) => {
      const targetA = nodeMap.get(a.targetNodeId);
      const targetB = nodeMap.get(b.targetNodeId);
      if (!targetA || !targetB) return 0;
      if (targetA.y !== targetB.y) return targetA.y - targetB.y;
      return targetA.x - targetB.x;
    });

    // 同一终点的入边先按来源节点位置排序，决定汇入终点时的错位顺序
    const targetIncoming = (incomingMap.get(edge.targetNodeId) || []).slice().sort((a, b) => {
      const sourceA = nodeMap.get(a.sourceNodeId);
      const sourceB = nodeMap.get(b.sourceNodeId);
      if (!sourceA || !sourceB) return 0;
      if (sourceA.y !== sourceB.y) return sourceA.y - sourceB.y;
      return sourceA.x - sourceB.x;
    });

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

      lf.updateAttributes(edge.id, {
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

    lf.updateAttributes(edge.id, {
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
  lf?.render(data);
  refreshState();
};

// 导出为格式化后的 JSON 字符串，便于查看和持久化
const exportData = () => (lf ? JSON.stringify(lf.getGraphData(), null, 2) : '');

// 从 JSON 字符串恢复流程图
const importData = (json: string) => {
  try {
    const data = JSON.parse(json) as GraphData;
    lf?.render(data);
    refreshState();
  } catch (error) {
    console.error('Failed to import flow JSON', error);
    throw error;
  }
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

onMounted(() => {
  if (!container.value) return;

  // 初始化 LogicFlow 实例：真正的画布就是在这里创建出来的
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
          // Delete / Backspace 删除当前选中元素
          keys: 'delete',
          callback: (event: KeyboardEvent) => {
            if (!lf || lf.graphModel.textEditElement) return;
            event.preventDefault();
            deleteSelectedElements();
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
    plugins: [SelectionSelect],
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
  lf.on('graph:transform', emitGraphData);
  lf.on('text:update', refreshState);

  lf.openSelectionSelect?.();

  // 让画布在点击后拿到焦点，这样键盘快捷键才能稳定生效
  const graphContainer = lf.container;
  const focusGraphContainer = () => graphContainer.focus();
  graphContainer.addEventListener('pointerdown', focusGraphContainer);
  removeKeyboardFocusListener = () => {
    graphContainer.removeEventListener('pointerdown', focusGraphContainer);
  };
  focusGraphContainer();

  // 父组件有数据就渲染父组件的数据，没有就先用默认示例图
  lf.render(props.modelValue || defaultGraphData);
  emitHistoryState();
  emitGraphData();
});

onBeforeUnmount(() => {
  // 组件销毁时移除事件并销毁 LogicFlow 实例，避免泄漏
  removeKeyboardFocusListener?.();
  removeKeyboardFocusListener = null;
  lf?.destroy();
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
  setGraphData,
  exportData,
  importData,
  exportPngDataUrl,
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

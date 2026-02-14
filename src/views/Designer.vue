<template>
  <div class="designer-container">
    <div class="toolbar">
      <el-button-group>
        <el-button @click="undo" :disabled="!canUndo" type="primary" plain>撤销</el-button>
        <el-button @click="redo" :disabled="!canRedo" type="primary" plain>重做</el-button>
      </el-button-group>

      <el-divider direction="vertical" />

      <el-button-group>
        <el-button @click="handleAddRectNode" type="primary">新增节点</el-button>
        <el-button @click="handleAddDiamondNode" type="warning">新增条件</el-button>
        <el-button @click="handleDeleteSelected" type="danger" plain>删除选中</el-button>
      </el-button-group>

      <el-divider direction="vertical" />

      <el-button @click="handleExport" type="success" plain>导出 JSON</el-button>
      <el-button @click="handleImport" type="warning" plain>导入 JSON</el-button>
      <el-button @click="handleExportImage" type="success">导出 PNG</el-button>
      <el-button @click="handleSmartLayout" type="info" plain :loading="layoutLoading">
        智能布局
      </el-button>
      <el-button @click="handleValidateFlow" type="info">校验流程</el-button>

      <el-divider direction="vertical" />

      <el-button @click="saveFlow" type="primary">保存流程</el-button>
    </div>

    <div class="toolbar-hint">
      可拖动节点位置，在空白区域拖拽可框选多个节点或连线，Delete / Backspace 可删除选中元素，
      Ctrl 或 Cmd + Z / Y 可撤销或重做，编辑中的流程会自动保存为本地草稿
    </div>

    <FlowDesigner
      ref="designerRef"
      v-model="flowData"
      @history-change="onHistoryChange"
    />
  </div>
</template>

<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import FlowDesigner from '@/components/FlowDesigner.vue';
import { fetchFlowData, saveFlowData } from '@/api/auth';
import { runLayoutInWorker } from '@/utils/performance';

type GraphNode = {
  id: string;
  x: number;
  y: number;
  text?: string | { value?: string };
  [key: string]: any;
};

type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  [key: string]: any;
};

type LayoutNode = GraphNode & {
  width: number;
  height: number;
};

type LayoutGraphData = {
  nodes: LayoutNode[];
  edges: GraphEdge[];
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type DraftPayload = {
  data: GraphData;
  updatedAt: string;
};

// 指向 FlowDesigner 子组件实例，后面通过它直接调用画布暴露出来的方法
const designerRef = ref<InstanceType<typeof FlowDesigner>>();
// 页面级的流程图状态：既作为 v-model 传给子组件，也接收子组件回传的最新图数据
const flowData = ref<GraphData | null>(null);
const canUndo = ref(false);
const canRedo = ref(false);
const layoutLoading = ref(false);

const currentFlowId = 'demo-flow-001';
// 新增功能 1：本地草稿按“流程 id”分别存储，避免多个流程互相覆盖
const draftStorageKey = `nexus-flow:draft:${currentFlowId}`;
// 新增功能 1：自动保存做一个短暂防抖，避免拖动节点时频繁写 localStorage
const draftDelay = 800;

let draftTimer: number | null = null;
// 记录上一次已经落到本地的图快照，内容没变时就不重复写入
let lastDraftSnapshot = '';

// 子组件会通过 history-change 事件把撤销/重做可用状态同步上来
const onHistoryChange = (undoable: boolean, redoable: boolean) => {
  canUndo.value = undoable;
  canRedo.value = redoable;
};

const undo = () => designerRef.value?.undo();
const redo = () => designerRef.value?.redo();

// 把整张图转成字符串，方便做“内容是否变化”的比较
const getGraphSnapshot = (data: GraphData) => JSON.stringify(data);

// 校验报错时优先展示节点文本，没有文本再退回节点 id，提示会更友好
const getNodeLabel = (node: GraphNode) => {
  if (typeof node.text === 'string') return node.text;
  if (node.text && typeof node.text === 'object' && typeof node.text.value === 'string') {
    return node.text.value;
  }
  return node.id;
};

// 新增功能 1：读取本地草稿；如果草稿损坏，顺手清掉错误数据
const readDraft = () => {
  const raw = localStorage.getItem(draftStorageKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DraftPayload;
  } catch (error) {
    console.warn('Failed to parse local draft', error);
    localStorage.removeItem(draftStorageKey);
    return null;
  }
};

// 新增功能 1：把当前流程图保存为本地草稿
const writeDraft = (data: GraphData) => {
  const snapshot = getGraphSnapshot(data);
  if (snapshot === lastDraftSnapshot) return;

  const payload: DraftPayload = {
    data,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(draftStorageKey, JSON.stringify(payload));
  lastDraftSnapshot = snapshot;
};

// 新增功能 1：正式保存成功后清空对应草稿，避免旧草稿覆盖新数据
const clearDraft = () => {
  localStorage.removeItem(draftStorageKey);
  lastDraftSnapshot = '';
};

// 统一的数据应用入口：同时更新画布渲染结果和当前页面的响应式状态
const applyFlowData = (data: GraphData) => {
  designerRef.value?.setGraphData(data);
  flowData.value = data;
  lastDraftSnapshot = getGraphSnapshot(data);
};

// 把所有校验错误整理成弹窗列表，而不是只弹第一条
const showValidationIssues = async (issues: string[]) => {
  try {
    await ElMessageBox.alert(
      h(
        'div',
        issues.map((issue, index) =>
          h('p', { style: 'margin: 0 0 8px;' }, `${index + 1}. ${issue}`),
        ),
      ),
      '流程校验未通过',
      {
        confirmButtonText: '我知道了',
        type: 'warning',
      },
    );
  } catch (action) {
    if (action !== 'close' && action !== 'cancel') {
      throw action;
    }
  }
};


// 这里主要检查：空流程、坏连线、缺少起点/终点、孤立节点、整图不连通
const validateFlowData = (data: GraphData) => {
  const issues: string[] = [];
  const { nodes, edges } = data;

  if (nodes.length === 0) {
    issues.push('当前流程没有任何节点，至少需要一个节点');
    return { valid: false, issues };
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inDegree = new Map(nodes.map((node) => [node.id, 0]));
  const outDegree = new Map(nodes.map((node) => [node.id, 0]));
  // 连通性校验时把图看成“无向图”，只关心是否连成一片
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));

  edges.forEach((edge) => {
    const sourceExists = nodeMap.has(edge.sourceNodeId);
    const targetExists = nodeMap.has(edge.targetNodeId);

    if (!sourceExists || !targetExists) {
      issues.push(`连线 ${edge.id} 连接了不存在的节点，请重新检查该连线`);
      return;
    }

    // source -> target 这条边会让 source 出度 +1、target 入度 +1
    outDegree.set(edge.sourceNodeId, (outDegree.get(edge.sourceNodeId) || 0) + 1);
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) || 0) + 1);
    // 双向写入邻接表，后面 BFS 才能检查“是不是一整块图”
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  });

  // 找到起点和终点
  const startNodes = nodes.filter((node) => (inDegree.get(node.id) || 0) === 0);
  const endNodes = nodes.filter((node) => (outDegree.get(node.id) || 0) === 0);

  if (startNodes.length === 0) {
    issues.push('流程中没有起点节点，至少需要一个入度为 0 的节点');
  }

  if (endNodes.length === 0) {
    issues.push('流程中没有终点节点，至少需要一个出度为 0 的节点');
  }

  // 孤立节点
  const isolatedNodes = nodes.filter((node) => {
    const indegree = inDegree.get(node.id) || 0;
    const outdegree = outDegree.get(node.id) || 0;
    return nodes.length > 1 && indegree === 0 && outdegree === 0;
  });

  if (isolatedNodes.length > 0) {
    issues.push(`存在孤立节点：${isolatedNodes.map((node) => getNodeLabel(node)).join('、')}`);
  }

  // 已访问节点集合
  const visited = new Set<string>();
  // 待访问队列
  const pending = [nodes[0].id];

  // 从任意一个节点出发做 BFS，看看最终能覆盖多少节点
  while (pending.length > 0) {
    const currentId = pending.shift();
    if (!currentId || visited.has(currentId)) continue;

    // 当前节点没有访问问过就加入已访问队列
    visited.add(currentId);
    // 将当前节点的所有未访问过的邻居节点加入待访问队列
    adjacency.get(currentId)?.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        pending.push(neighborId);
      }
    });
  }

  // 将未被访问到的孤立节点找出来
  if (visited.size !== nodes.length) {
    const disconnectedNodes = nodes
      .filter((node) => !visited.has(node.id))
      .map((node) => getNodeLabel(node));
    issues.push(`流程图不是连通的，未连接到主流程的节点有：${disconnectedNodes.join('、')}`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

const handleAddRectNode = () => {
  designerRef.value?.addRectNode();
  ElMessage.success('已新增节点');
};

const handleAddDiamondNode = () => {
  designerRef.value?.addDiamondNode();
  ElMessage.success('已新增条件节点');
};

const handleDeleteSelected = () => {
  const deletedCount = designerRef.value?.deleteSelectedElements() || 0;
  if (deletedCount === 0) {
    ElMessage.warning('请先选中要删除的节点或连线');
    return;
  }

  ElMessage.success(`已删除 ${deletedCount} 个元素`);
};

// 手动校验入口
const handleValidateFlow = async () => {
  const data = designerRef.value?.getGraphData() as GraphData | undefined;
  if (!data) {
    ElMessage.warning('当前没有可校验的流程数据');
    return;
  }

  const result = validateFlowData(data);
  if (result.valid) {
    ElMessage.success('流程校验通过');
    return;
  }

  await showValidationIssues(result.issues);
};

// 导出当前流程图为 JSON 文件，方便做数据备份或导入到别的环境
const handleExport = () => {
  const json = designerRef.value?.exportData();
  if (!json) return;

  const blob = new Blob([json], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `flow_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  ElMessage.success('导出成功');
};


// 具体的“SVG -> Canvas -> PNG”转换在子组件里完成，这里只负责触发下载
const handleExportImage = async () => {
  const pngDataUrl = await designerRef.value?.exportPngDataUrl();
  if (!pngDataUrl) {
    ElMessage.error('导出图片失败，当前画布没有可导出的内容');
    return;
  }

  const link = document.createElement('a');
  link.href = pngDataUrl;
  link.download = `${currentFlowId}_${Date.now()}.png`;
  link.click();
  ElMessage.success('图片导出成功');
};

// 从本地选择一个 JSON 文件，并把其中的流程数据恢复到当前画布
const handleImport = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';

  input.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        // FileReader 读到的是字符串，再交给子组件解析并渲染
        const content = loadEvent.target?.result as string;
        designerRef.value?.importData(content);
        ElMessage.success('导入成功');
      } catch (error) {
        ElMessage.error('导入失败，JSON 文件格式不正确');
      }
    };

    reader.readAsText(file);
  };

  input.click();
};

// 智能布局：先拿到带宽高的节点数据，交给 Worker 计算，再把新坐标应用回画布
const handleSmartLayout = async () => {
  if (!designerRef.value) return;

  const graphData = designerRef.value.getLayoutGraphData() as LayoutGraphData | null;
  if (!graphData || graphData.nodes.length === 0) {
    ElMessage.warning('当前没有可布局的节点');
    return;
  }

  layoutLoading.value = true;
  const start = performance.now();

  try {
    // 画布容器尺寸会作为布局边界，避免节点被排到可视区域外
    const container = document.querySelector('.flow-designer') as HTMLElement | null;
    const width = container?.clientWidth || 1200;
    const height = container?.clientHeight || 800;
    const newPositions = await runLayoutInWorker(graphData.nodes, graphData.edges, width, height);

    // 第一步只调整节点坐标
    designerRef.value.applyNodePositions(newPositions);

    // 第二步再根据新坐标重新整理折线走向，减少重叠和长横线
    const newGraphData = designerRef.value.optimizeEdgeRoutes?.() as GraphData | null;
    if (newGraphData) {
      flowData.value = newGraphData;
    }

    // 自动缩放视图，让布局后的整张图尽量完整展示在可视区域内
    designerRef.value.fitView();

    const duration = performance.now() - start;
    ElMessage.success(`智能布局完成，耗时 ${duration.toFixed(2)}ms`);
  } catch (error) {
    ElMessage.error('布局计算失败');
    console.error(error);
  } finally {
    layoutLoading.value = false;
  }
};

// 保存流程到后端
// 保存前先跑校验，不合格的数据不允许直接提交
// 保存成功后清掉本地草稿，因为这份数据已经正式落库
const saveFlow = async () => {
  if (!designerRef.value) return;

  const data = designerRef.value.getGraphData() as GraphData;
  const validation = validateFlowData(data);
  if (!validation.valid) {
    await showValidationIssues(validation.issues);
    return;
  }

  try {
    await saveFlowData(currentFlowId, data);
    clearDraft();
    ElMessage.success('流程保存成功');
  } catch (error: any) {
    ElMessage.error(`保存失败：${error.message || '未知错误'}`);
  }
};

// 页面加载时先尝试读取后端流程，再检查是否有本地草稿可恢复
const loadFlow = async () => {
  try {
    const res = await fetchFlowData(currentFlowId);
    if (res.data) {
      applyFlowData(res.data);
      ElMessage.success('流程加载成功');
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('未找到流程，使用默认数据');
    } else {
      ElMessage.warning('流程加载失败，已使用默认数据');
    }
  }

  const draft = readDraft();
  if (!draft) return;

  try {
    // 本地草稿恢复交给用户确认，避免无意覆盖后端数据
    await ElMessageBox.confirm(
      `检测到 ${new Date(draft.updatedAt).toLocaleString()} 保存的本地草稿，是否恢复？`,
      '恢复草稿',
      {
        confirmButtonText: '恢复草稿',
        cancelButtonText: '忽略草稿',
        type: 'info',
      },
    );
    applyFlowData(draft.data);
    ElMessage.success('已恢复本地草稿');
  } catch (error) {
    lastDraftSnapshot = getGraphSnapshot(draft.data);
  }
};

// 监听整张图的变化并自动保存草稿
watch(
  flowData,
  (value) => {
    if (!value) return;

    if (draftTimer) {
      window.clearTimeout(draftTimer);
    }

    // 每次图数据变化都重新计时，只在“短暂停止编辑”后保存一次
    draftTimer = window.setTimeout(() => {
      writeDraft(value);
    }, draftDelay);
  },
  {
    deep: true,
  },
);

onMounted(() => {
  // 页面进入后加载一次流程图
  loadFlow();
});

onBeforeUnmount(() => {
  // 组件销毁时清掉未执行的定时器，避免销毁后仍然尝试写草稿
  if (draftTimer) {
    window.clearTimeout(draftTimer);
  }
});
</script>

<style scoped>
.designer-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.toolbar {
  padding: 12px 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  z-index: 10;
}

.toolbar-hint {
  padding: 10px 20px;
  font-size: 13px;
  color: #606266;
  border-bottom: 1px solid #f0f2f5;
  background: #fcfcfc;
}

.flow-designer {
  flex: 1;
}
</style>

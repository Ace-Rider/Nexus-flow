<template>
  <div class="designer-container">
    <div class="toolbar">
      <el-button-group>
        <el-button @click="undo" :disabled="!canUndo" type="primary" plain>撤销</el-button>
        <el-button @click="redo" :disabled="!canRedo" type="primary" plain>重做</el-button>
      </el-button-group>

      <el-divider direction="vertical" />

      <el-button-group>
        <el-button @click="handleAddRectNode" type="primary">&#x65B0;&#x589E;&#x8282;&#x70B9;</el-button>
        <el-button @click="handleAddDiamondNode" type="warning">&#x65B0;&#x589E;&#x6761;&#x4EF6;</el-button>
        <el-button @click="handleDeleteSelected" type="danger" plain>&#x5220;&#x9664;&#x9009;&#x4E2D;</el-button>
      </el-button-group>

      <el-divider direction="vertical" />

      <el-button @click="handleExport" type="success" plain>&#x5BFC;&#x51FA; JSON</el-button>
      <el-button @click="handleImport" type="warning" plain>&#x5BFC;&#x5165; JSON</el-button>
      <el-button @click="handleSmartLayout" type="info" plain :loading="layoutLoading">
        &#x667A;&#x80FD;&#x5E03;&#x5C40;
      </el-button>

      <el-divider direction="vertical" />

      <el-button @click="saveFlow" type="primary">&#x4FDD;&#x5B58;&#x6D41;&#x7A0B;</el-button>
    </div>

    <div class="toolbar-hint">
      &#x53EF;&#x62D6;&#x52A8;&#x8282;&#x70B9;&#x4F4D;&#x7F6E;&#xFF0C;&#x5728;&#x7A7A;&#x767D;&#x533A;&#x57DF;&#x62D6;&#x62FD;&#x53EF;&#x6846;&#x9009;&#x591A;&#x4E2A;&#x8282;&#x70B9;&#x6216;&#x8FDE;&#x7EBF;&#xFF0C;Delete / Backspace &#x53EF;&#x5220;&#x9664;&#x9009;&#x4E2D;&#x5143;&#x7D20;&#xFF0C;Ctrl&#x6216;Cmd + Z / Y &#x53EF;&#x64A4;&#x9500;&#x6216;&#x91CD;&#x505A;&#x3002;
    </div>

    <FlowDesigner
      ref="designerRef"
      v-model="flowData"
      @history-change="onHistoryChange"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import FlowDesigner from '@/components/FlowDesigner.vue';
import { fetchFlowData, saveFlowData } from '@/api/auth';
import { runLayoutInWorker } from '@/utils/performance';

type GraphNode = {
  id: string;
  x: number;
  y: number;
  [key: string]: any;
};

type LayoutNode = GraphNode & {
  width: number;
  height: number;
};

type LayoutGraphData = {
  nodes: LayoutNode[];
  edges: any[];
};

type GraphData = {
  nodes: GraphNode[];
  edges: any[];
};

// 指向 FlowDesigner 子组件实例，后面通过 ref 调用它暴露的方法
const designerRef = ref<InstanceType<typeof FlowDesigner>>();
// 页面级流程图状态：既能作为初始值传给子组件，也能接收子组件更新
const flowData = ref<GraphData | null>(null);
const canUndo = ref(false);
const canRedo = ref(false);
const layoutLoading = ref(false);
const currentFlowId = 'demo-flow-001';

// 子组件通过 history-change 事件把撤销/重做状态同步给父组件
const onHistoryChange = (undoable: boolean, redoable: boolean) => {
  canUndo.value = undoable;
  canRedo.value = redoable;
};

const undo = () => designerRef.value?.undo();
const redo = () => designerRef.value?.redo();

// 新增普通矩形节点
const handleAddRectNode = () => {
  designerRef.value?.addRectNode();
  ElMessage.success('\u5df2\u65b0\u589e\u8282\u70b9');
};

// 新增条件节点
const handleAddDiamondNode = () => {
  designerRef.value?.addDiamondNode();
  ElMessage.success('\u5df2\u65b0\u589e\u6761\u4ef6\u8282\u70b9');
};

// 删除当前选中的元素
const handleDeleteSelected = () => {
  const deletedCount = designerRef.value?.deleteSelectedElements() || 0;
  if (deletedCount === 0) {
    ElMessage.warning('\u8bf7\u5148\u9009\u4e2d\u8981\u5220\u9664\u7684\u8282\u70b9\u6216\u8fde\u7ebf');
    return;
  }
  ElMessage.success(`\u5df2\u5220\u9664 ${deletedCount} \u4e2a\u5143\u7d20`);
};

// 导出当前流程图为 JSON 文件
const handleExport = () => {
  const json = designerRef.value?.exportData();
  if (!json) return;

  // Blob 把字符串包装成浏览器可下载文件对象
  const blob = new Blob([json], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `flow_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  ElMessage.success('\u5bfc\u51fa\u6210\u529f');
};

// 从本地 JSON 文件恢复流程图
const handleImport = () => {
  // 动态创建文件输入框，避免页面上额外放隐藏 input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    // FileReader 负责把本地文件读成字符串
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        // 读取结果是 JSON 文本，交给子组件恢复成流程图
        const content = loadEvent.target?.result as string;
        designerRef.value?.importData(content);
        ElMessage.success('\u5bfc\u5165\u6210\u529f');
      } catch (error) {
        ElMessage.error('\u5bfc\u5165\u5931\u8d25\uff0cJSON \u6587\u4ef6\u683c\u5f0f\u4e0d\u6b63\u786e');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

// 智能布局：让节点按流程关系重新排布，边线再做一次优化
const handleSmartLayout = async () => {
  if (!designerRef.value) return;

  // 给布局算法准备一份带宽高的图数据
  const graphData = designerRef.value.getLayoutGraphData() as LayoutGraphData | null;
  if (!graphData || graphData.nodes.length === 0) {
    ElMessage.warning('\u5f53\u524d\u6ca1\u6709\u53ef\u5e03\u5c40\u7684\u8282\u70b9');
    return;
  }

  layoutLoading.value = true;
  const start = performance.now();
  try {
    // 读取画布容器大小，作为布局计算边界
    const container = document.querySelector('.flow-designer') as HTMLElement | null;
    const width = container?.clientWidth || 1200;
    const height = container?.clientHeight || 800;

    // 在 Worker 中计算节点新坐标，避免阻塞主线程
    const newPositions = await runLayoutInWorker(graphData.nodes, graphData.edges, width, height);

    // 将布局结果真正应用到画布上
    designerRef.value.applyNodePositions(newPositions);

    // 再优化一次边线，让折线更自然
    const newGraphData = designerRef.value.optimizeEdgeRoutes?.() as GraphData | null;
    if (newGraphData) {
      flowData.value = newGraphData;
    }

    // 自动缩放视图，确保布局结果完整可见
    designerRef.value.fitView();

    const duration = performance.now() - start;
    ElMessage.success(`\u667a\u80fd\u5e03\u5c40\u5b8c\u6210\uff0c\u8017\u65f6 ${duration.toFixed(2)}ms`);
  } catch (error) {
    ElMessage.error('\u5e03\u5c40\u8ba1\u7b97\u5931\u8d25');
    console.error(error);
  } finally {
    layoutLoading.value = false;
  }
};

// 把当前图保存到后端
const saveFlow = async () => {
  if (!designerRef.value) return;

  // 从子组件读取当前图数据并提交到后端
  const data = designerRef.value.getGraphData();
  try {
    await saveFlowData(currentFlowId, data as GraphData);
    ElMessage.success('\u6d41\u7a0b\u4fdd\u5b58\u6210\u529f');
  } catch (error: any) {
    ElMessage.error(`\u4fdd\u5b58\u5931\u8d25\uff1a${error.message || '\u672a\u77e5\u9519\u8bef'}`);
  }
};

// 页面加载时从后端读取流程
const loadFlow = async () => {
  try {
    // 页面进入时先尝试加载后端已保存的流程
    const res = await fetchFlowData(currentFlowId);
    if (res.data) {
      // 同步画布状态和页面状态
      designerRef.value?.setGraphData(res.data);
      flowData.value = res.data;
      ElMessage.success('\u6d41\u7a0b\u52a0\u8f7d\u6210\u529f');
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('\u672a\u627e\u5230\u6d41\u7a0b\uff0c\u4f7f\u7528\u9ed8\u8ba4\u6570\u636e');
    } else {
      ElMessage.warning('\u6d41\u7a0b\u52a0\u8f7d\u5931\u8d25\uff0c\u5df2\u4f7f\u7528\u9ed8\u8ba4\u6570\u636e');
    }
  }
};

onMounted(() => {
  // 组件挂载后自动加载流程
  loadFlow();
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

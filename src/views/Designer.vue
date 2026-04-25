<template>
  <div class="designer-container">
    <header class="workspace-hero">
      <div class="workspace-hero__copy">
        <div class="workspace-hero__badge">Workflow Studio</div>
        <h1>{{ activeFlow?.name || '流程设计器' }}</h1>
        <p>一个用于绘制、校验、布局、导入导出和版本回溯的企业级流程工作台。</p>
      </div>

      <div class="workspace-hero__stats">
        <div>
          <strong>{{ currentGraphSummary.nodeCount }}</strong>
          <span>节点</span>
        </div>
        <div>
          <strong>{{ currentGraphSummary.edgeCount }}</strong>
          <span>连线</span>
        </div>
        <div>
          <strong>{{ flowVersions.length }}</strong>
          <span>版本</span>
        </div>
      </div>
    </header>

    <div class="workspace-bar">
      <div class="workspace-bar__flows">
        <button
          v-for="flow in workspaceFlows"
          :key="flow.id"
          class="workspace-flow-tab"
          :class="{ 'is-active': flow.id === activeFlowId }"
          @click="switchFlow(flow.id)"
        >
          <strong>{{ flow.name }}</strong>
          <span>{{ formatWorkspaceTime(flow.updatedAt) }}</span>
        </button>

        <el-button size="small" type="primary" plain @click="createFlowWorkspace">
          新流程
        </el-button>
      </div>

      <el-input
        v-model="templateSearch"
        class="workspace-bar__search"
        placeholder="搜索节点模板"
        clearable
      />
    </div>

    <div class="toolbar">
      <el-button-group>
        <el-button @click="undo" :disabled="!canUndo" type="primary" plain>撤销</el-button>
        <el-button @click="redo" :disabled="!canRedo" type="primary" plain>重做</el-button>
      </el-button-group>

      <el-divider direction="vertical" />

      <el-button-group>
        <el-button @click="handleAddRectNode" type="primary">新增节点</el-button>
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
      <el-button @click="handleOpenVersionManager" type="primary" plain>版本管理</el-button>
    </div>

    <div class="toolbar-hint">
      常用编辑操作建议用左侧节点库和快捷键完成，Delete / Backspace 可删除选中元素，
      Ctrl 或 Cmd + C / V / D 可复制、粘贴、重复创建，Ctrl 或 Cmd + Z / Y 可撤销或重做，
      编辑中的流程会自动保存为本地草稿
    </div>

    <div class="designer-main">
      <aside class="workspace-sidebar">
        <section class="workspace-section">
          <div class="workspace-section__header">
            <h3>节点模板</h3>
            <span>{{ filteredNodeTemplates.length }}</span>
          </div>
          <button
            v-for="template in filteredNodeTemplates"
            :key="template.id"
            class="template-card"
            @click="handleAddTemplateNode(template)"
          >
            <strong>{{ template.label }}</strong>
            <span>{{ template.description }}</span>
          </button>
        </section>

        <section class="workspace-section">
          <div class="workspace-section__header">
            <h3>流程问题</h3>
            <span>{{ validationIssues.length }}</span>
          </div>
          <div v-if="validationIssues.length === 0" class="workspace-empty">
            尚未发现问题
          </div>
          <button
            v-for="issue in validationIssues"
            :key="issue.key"
            class="issue-card"
            @click="focusValidationIssue(issue)"
          >
            <strong>{{ issue.title }}</strong>
            <span>{{ issue.message }}</span>
          </button>
        </section>
      </aside>

      <div class="designer-canvas">
        <FlowDesigner
          ref="designerRef"
          v-model="flowData"
          @history-change="onHistoryChange"
          @selection-change="onSelectionChange"
        />
      </div>

      <PropertyPanel
        :selected-element="selectedElement"
        :form="propertyForm"
        @update:form="handlePropertyFormChange"
        @apply="applyPropertyChanges"
        @apply-batch="handleApplyBatchEdit"
      />
    </div>

    <el-drawer
      v-model="versionDrawerVisible"
      title="版本管理"
      size="420px"
      :with-header="true"
      destroy-on-close
    >
      <div class="version-manager">
        <section class="version-manager__summary">
          <div>当前节点：{{ currentGraphSummary.nodeCount }}</div>
          <div>当前连线：{{ currentGraphSummary.edgeCount }}</div>
        </section>

        <el-form label-position="top" class="version-manager__form">
          <el-form-item label="版本名称">
            <el-input v-model="versionForm.name" placeholder="请输入版本名称" />
          </el-form-item>

          <el-form-item label="版本说明">
            <el-input
              v-model="versionForm.note"
              type="textarea"
              :rows="3"
              placeholder="记录这次版本的改动点"
            />
          </el-form-item>

          <el-button type="primary" :loading="versionSaving" @click="handleSaveVersion">
            保存当前版本
          </el-button>
        </el-form>

        <div class="version-manager__list-title">版本历史</div>
        <div v-if="flowVersions.length === 0" class="version-manager__empty">
          暂无版本记录，先保存一个版本吧
        </div>

        <div v-else class="version-manager__list">
          <article v-for="version in flowVersions" :key="version.id" class="version-card">
            <div class="version-card__header">
              <strong>{{ version.name }}</strong>
              <span>{{ formatVersionTime(version.createdAt) }}</span>
            </div>
            <div class="version-card__meta">
              节点 {{ version.nodeCount }} · 连线 {{ version.edgeCount }}
            </div>
            <p v-if="version.note" class="version-card__note">{{ version.note }}</p>
            <div class="version-card__actions">
              <el-button size="small" type="primary" plain @click="restoreVersion(version)">
                恢复
              </el-button>
              <el-button size="small" type="danger" plain @click="removeVersion(version)">
                删除
              </el-button>
            </div>
          </article>
        </div>
      </div>
    </el-drawer>

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import FlowDesigner from '@/components/FlowDesigner.vue';
import PropertyPanel from '@/components/PropertyPanel.vue';
import { fetchFlowData, saveFlowData } from '@/api/auth';
import { runLayoutInWorker } from '@/utils/performance';
import { validateFlowData, type ValidationIssue } from '@/utils/flowValidation';
import { useFlowDraft } from '@/composables/useFlowDraft';
import { useFlowVersions } from '@/composables/useFlowVersions';
import { useWorkspaceFlows } from '@/composables/useWorkspaceFlows';
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  FlowVersionRecord,
  PropertyForm,
  SelectedElement,
  WorkspaceFlowRecord,
  BatchEditPayload,
} from '@/types/flow';

type LayoutNode = GraphNode & {
  width: number;
  height: number;
};

type LayoutGraphData = {
  nodes: LayoutNode[];
  edges: GraphEdge[];
};

type NodeTemplate = {
  id: string;
  label: string;
  description: string;
  type: 'rect' | 'diamond';
  text: string;
  properties?: Record<string, any>;
};

// 指向 FlowDesigner 子组件实例，后面通过它直接调用画布暴露出来的方法
const designerRef = ref<InstanceType<typeof FlowDesigner>>();
// 页面级的流程图状态：既作为 v-model 传给子组件，也接收子组件回传的最新图数据
const flowData = ref<GraphData | null>(null);
const templateSearch = ref('');
const canUndo = ref(false);
const canRedo = ref(false);
const layoutLoading = ref(false);
const selectedElement = ref<SelectedElement>(null);
const validationIssues = ref<ValidationIssue[]>([]);

// ---- 组合式函数：草稿、版本、工作台各自收敛自己的状态和操作 ----
const { scheduleDraftWrite, cancelDraftWrite, readDraft, clearDraft, markDraftSnapshot } =
  useFlowDraft();
const {
  versionDrawerVisible,
  versionSaving,
  flowVersions,
  versionForm,
  formatVersionTime,
  refreshVersions,
  openVersionManager,
  saveCurrentVersion,
  persistVersionSnapshot,
  restoreVersionData,
  removeVersionById,
} = useFlowVersions();
const {
  workspaceFlows,
  activeFlowId,
  activeFlow,
  initWorkspaceFlows,
  syncActiveFlowRecord,
  createWorkspaceFlow,
  renameWorkspaceFlow,
  removeWorkspaceFlow,
  formatWorkspaceTime,
} = useWorkspaceFlows();

// 记录最近一次“已加载/已保存到后端”的图快照，用于切换流程前判断是否有未保存修改
let lastSavedSnapshot = '';

// 属性面板表单的默认值：
// 没有选中元素时，就回到这组“空表单”状态。
const createEmptyPropertyForm = (): PropertyForm => ({
  text: '',
  assignee: '',
  description: '',
  condition: '',
  priority: 1,
  timeoutMinutes: 0,
  remark: '',
});

const propertyForm = ref<PropertyForm>(createEmptyPropertyForm());
const currentGraphSummary = computed(() => ({
  nodeCount: flowData.value?.nodes.length || 0,
  edgeCount: flowData.value?.edges.length || 0,
}));

const filteredNodeTemplates = computed(() =>
  defaultNodeTemplates.filter((template) => {
    const keyword = templateSearch.value.trim().toLowerCase();
    if (!keyword) return true;
    return (
      template.label.toLowerCase().includes(keyword) ||
      template.description.toLowerCase().includes(keyword)
    );
  }),
);

const defaultNodeTemplates: NodeTemplate[] = [
  {
    id: 'start',
    label: '开始节点',
    description: '流程入口，通常放在最左侧',
    type: 'rect',
    text: '开始',
    properties: { role: 'start' },
  },
  {
    id: 'approve',
    label: '审批节点',
    description: '常见审批与审核步骤',
    type: 'rect',
    text: '审批',
    properties: { assignee: '负责人' },
  },
  {
    id: 'branch',
    label: '条件节点',
    description: '用于分支判断与条件拆分',
    type: 'diamond',
    text: '条件',
    properties: { condition: 'value > 0' },
  },
  {
    id: 'cc',
    label: '抄送节点',
    description: '通知相关人员或系统',
    type: 'rect',
    text: '抄送',
    properties: { assignee: '抄送人' },
  },
  {
    id: 'finish',
    label: '结束节点',
    description: '流程出口和收尾动作',
    type: 'rect',
    text: '结束',
    properties: { role: 'end' },
  },
];

// 版本管理抽屉打开入口：模板绑定用，内部带上当前流程 id
const handleOpenVersionManager = () => openVersionManager(activeFlowId.value);

// 将当前画布快照保存为一个新版本（版本管理抽屉里的按钮）
const handleSaveVersion = () => {
  const data = (designerRef.value?.getGraphData() as GraphData | undefined) || flowData.value;
  saveCurrentVersion(activeFlowId.value, data);
};

// 恢复历史版本：确认、自动备份、应用数据由版本 composable 处理，这里提供画布访问能力
const restoreVersion = (version: FlowVersionRecord) =>
  restoreVersionData(activeFlowId.value, version, {
    getCurrentData: () =>
      (designerRef.value?.getGraphData() as GraphData | undefined) || flowData.value,
    apply: applyFlowData,
  });

// 删除版本时由 composable 做一次确认，防止误删历史快照
const removeVersion = (version: FlowVersionRecord) => removeVersionById(activeFlowId.value, version);

// 切换或新建流程前，若当前流程有未保存修改，先让用户选择处理方式；
// 返回 false 表示用户取消操作，需要中止切换。
const confirmLeaveIfDirty = async () => {
  if (!hasUnsavedChanges()) return true;

  try {
    await ElMessageBox.confirm(
      '当前流程有未保存的修改，直接切换可能丢失本次编辑（本地草稿仍会保留）。',
      '未保存的修改',
      {
        confirmButtonText: '保存并切换',
        cancelButtonText: '直接切换',
        distinguishCancelAndClose: true,
        type: 'warning',
      },
    );
    // 用户选择先保存：保存失败（如校验不通过）时中止切换
    return await saveFlow();
  } catch (action) {
    // cancel = 直接切换；close = 取消操作
    return action === 'cancel';
  }
};

const switchFlow = async (flowId: string) => {
  if (flowId === activeFlowId.value) return;
  if (!(await confirmLeaveIfDirty())) return;
  cancelDraftWrite();
  syncActiveFlowRecord();
  activeFlowId.value = flowId;
  refreshVersions(flowId);
  await loadFlow();
};

const createFlowWorkspace = async () => {
  if (!(await confirmLeaveIfDirty())) return;
  cancelDraftWrite();
  createWorkspaceFlow();
  refreshVersions(activeFlowId.value);
  applyFlowData({
    nodes: [],
    edges: [],
  });
  lastSavedSnapshot = getGraphSnapshot({ nodes: [], edges: [] });
  await loadFlow();
};

// 子组件会通过 history-change 事件把撤销/重做可用状态同步上来
const onHistoryChange = (undoable: boolean, redoable: boolean) => {
  canUndo.value = undoable;
  canRedo.value = redoable;
};

const undo = () => designerRef.value?.undo();
const redo = () => designerRef.value?.redo();

// 把整张图转成字符串，方便做“内容是否变化”的比较
const getGraphSnapshot = (data: GraphData) => JSON.stringify(data);

// 当前画布最新快照：优先取画布实时数据，画布未就绪时退回页面状态
const getCurrentGraphSnapshot = () => {
  const data = (designerRef.value?.getGraphData() as GraphData | undefined) || flowData.value;
  return data ? getGraphSnapshot(data) : '';
};

// 是否存在未保存到后端的修改
const hasUnsavedChanges = () => {
  if (!lastSavedSnapshot) return false;
  return getCurrentGraphSnapshot() !== lastSavedSnapshot;
};

// 统一的数据应用入口：同时更新画布渲染结果和当前页面的响应式状态
const applyFlowData = (data: GraphData) => {
  designerRef.value?.setGraphData(data);
  flowData.value = data;
  markDraftSnapshot(data);
  selectedElement.value = null;
  propertyForm.value = createEmptyPropertyForm();
  validationIssues.value = [];
};

// 属性面板只是当前输入值的镜像，真正写回画布要等用户点“应用修改”。
const handlePropertyFormChange = (value: PropertyForm) => {
  propertyForm.value = value;
};

// 选中节点或边后，把它已有的数据填进右侧表单，方便继续编辑。
const onSelectionChange = (value: SelectedElement) => {
  selectedElement.value = value;

  if (!value || value.kind === 'multiple') {
    propertyForm.value = createEmptyPropertyForm();
    return;
  }

  const data = value.data as GraphNode | GraphEdge;
  const properties = data.properties || {};

  propertyForm.value = {
    text: typeof data.text === 'string' ? data.text : data.text?.value || '',
    assignee: properties.assignee || '',
    description: properties.description || '',
    condition: properties.condition || '',
    priority: properties.priority || 1,
    timeoutMinutes: properties.timeoutMinutes || 0,
    remark: properties.remark || '',
  };
};

// 把属性面板里的输入值真正写回 LogicFlow：
// 文本走 updateText，自定义业务字段走 setProperties。
const applyPropertyChanges = () => {
  if (!selectedElement.value || selectedElement.value.kind === 'multiple') {
    ElMessage.warning('请先选中一个节点或连线');
    return;
  }

  const { id } = selectedElement.value.data;
  designerRef.value?.updateElementText(id, propertyForm.value.text);

  if (selectedElement.value.kind === 'node') {
    const currentProperties = (selectedElement.value.data as GraphNode).properties || {};
    designerRef.value?.updateElementProperties(id, {
      ...currentProperties,
      assignee: propertyForm.value.assignee,
      description: propertyForm.value.description,
      timeoutMinutes: propertyForm.value.timeoutMinutes,
      remark: propertyForm.value.remark,
    });
  }

  if (selectedElement.value.kind === 'edge') {
    const currentProperties = (selectedElement.value.data as GraphEdge).properties || {};
    designerRef.value?.updateElementProperties(id, {
      ...currentProperties,
      condition: propertyForm.value.condition,
      priority: propertyForm.value.priority,
      remark: propertyForm.value.remark,
    });
  }

  ElMessage.success('属性已更新');
};

// 多选批量编辑：先转换节点类型（会保留属性），再应用勾选的业务属性。
// 载荷里只包含勾选的字段，未勾选的属性保持原值。
const handleApplyBatchEdit = (payload: BatchEditPayload) => {
  if (!selectedElement.value || selectedElement.value.kind !== 'multiple') return;

  const nodeIds = selectedElement.value.data.nodes.map((node) => node.id);
  if (nodeIds.length === 0) {
    ElMessage.warning('当前没有选中的节点可批量编辑');
    return;
  }
  if (Object.keys(payload).length === 0) {
    ElMessage.warning('请至少勾选一项要批量应用的字段');
    return;
  }

  let updated = 0;
  if (payload.nodeType) {
    updated = designerRef.value?.batchChangeNodeType(nodeIds, payload.nodeType) || 0;
  }

  const { nodeType: _nodeType, ...propertyPayload } = payload;
  if (Object.keys(propertyPayload).length > 0) {
    updated = designerRef.value?.batchUpdateNodeProperties(nodeIds, propertyPayload) || updated;
  }

  ElMessage.success(`已批量更新 ${updated} 个节点`);
};

const focusValidationIssue = (issue: ValidationIssue) => {
  if (!issue.focusId) return;
  designerRef.value?.focusElement(issue.focusId);
};

const handleAddRectNode = () => {
  designerRef.value?.addRectNode();
  ElMessage.success('已新增节点');
};

const handleAddTemplateNode = (template: NodeTemplate) => {
  const model = designerRef.value?.addNodeFromTemplate({
    type: template.type,
    text: template.text,
    properties: template.properties,
  });

  if (!model) {
    ElMessage.warning('当前画布不可新增节点');
    return;
  }

  ElMessage.success(`已添加 ${template.label}`);
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
    validationIssues.value = [];
    ElMessage.success('流程校验通过');
    return;
  }

  validationIssues.value = result.issues;
  ElMessage.warning(`流程校验未通过，发现 ${result.issues.length} 个问题`);
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
  link.download = `${activeFlowId.value}_${Date.now()}.png`;
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
        ElMessage.error('导入失败，JSON 文件格式或流程结构不正确');
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
    const { width, height } = designerRef.value.getContainerSize();
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

// 保存流程到后端，返回是否保存成功（切换流程等场景需要根据结果决定是否继续）
// 保存前先跑校验，不合格的数据不允许直接提交；保存成功后清掉本地草稿
const saveFlow = async (): Promise<boolean> => {
  if (!designerRef.value) return false;

  const data = designerRef.value.getGraphData() as GraphData;
  const validation = validateFlowData(data);
  if (!validation.valid) {
    validationIssues.value = validation.issues;
    ElMessage.warning(`流程存在 ${validation.issues.length} 个问题，请先修复`);
    return false;
  }

  try {
    await saveFlowData(activeFlowId.value, data);
    clearDraft(activeFlowId.value);
    syncActiveFlowRecord();
    validationIssues.value = [];
    // 记录已保存快照，供切换流程前的“未保存修改”检测使用
    lastSavedSnapshot = getGraphSnapshot(data);
    // 每次正式保存时都顺手留一份版本快照，方便后面回滚到某次提交
    if (
      !persistVersionSnapshot(activeFlowId.value, {
        name: `正式保存 ${new Date().toLocaleString()}`,
        note: '点击“保存流程”时自动生成',
        data,
      })
    ) {
      // 版本快照失败不影响保存本身，但要提示用户
      ElMessage.warning('流程已保存，但自动版本快照失败');
    }
    ElMessage.success('流程保存成功');
    return true;
  } catch (error: any) {
    ElMessage.error(`保存失败：${error.message || '未知错误'}`);
    return false;
  }
};

// 页面加载时先尝试读取后端流程，再检查是否有本地草稿可恢复
const loadFlow = async () => {
  try {
    const res = await fetchFlowData(activeFlowId.value);
    if (res.data) {
      applyFlowData(res.data);
      lastSavedSnapshot = getGraphSnapshot(res.data);
      validationIssues.value = [];
      ElMessage.success('流程加载成功');
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('未找到流程，使用默认数据');
    } else {
      ElMessage.warning('流程加载失败，已使用默认数据');
    }
  }

  const draft = readDraft(activeFlowId.value);
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
    markDraftSnapshot(draft.data);
  }
};

// 监听整张图的变化并自动保存草稿（防抖逻辑在草稿 composable 内部）
watch(
  flowData,
  (value) => {
    if (!value) return;
    scheduleDraftWrite(activeFlowId.value, value);
  },
  {
    deep: true,
  },
);

onMounted(() => {
  // 页面进入后加载一次流程图
  initWorkspaceFlows();
  refreshVersions(activeFlowId.value);
  loadFlow();
});

onBeforeUnmount(() => {
  // 组件销毁时清掉未执行的草稿定时器，避免销毁后仍然尝试写草稿
  cancelDraftWrite();
});
</script>

<style scoped>
.designer-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
  background: transparent;
}

.workspace-hero {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 0 2px;
}

.workspace-hero__badge {
  display: inline-flex;
  align-items: center;
  margin-bottom: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(37, 99, 235, 0.12);
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.workspace-hero h1 {
  margin: 0;
  color: #102033;
  font-size: 22px;
  letter-spacing: -0.05em;
  font-family: Georgia, "Times New Roman", serif;
}

.workspace-hero p {
  margin: 4px 0 0;
  color: #5f6c82;
  font-size: 12px;
  line-height: 1.4;
}

.workspace-hero__stats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.workspace-hero__stats div {
  min-width: 76px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(16px);
  box-shadow: var(--app-shadow);
}

.workspace-hero__stats strong {
  display: block;
  color: #0f172a;
  font-size: 16px;
  line-height: 1;
}

.workspace-hero__stats span {
  display: block;
  margin-top: 3px;
  color: #6b7280;
  font-size: 11px;
}

.toolbar {
  padding: 8px 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  box-shadow: var(--app-shadow);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  z-index: 10;
}

.toolbar-hint {
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 11px;
  color: #5f6c82;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.72);
}

.workspace-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--app-shadow);
}

.workspace-bar__flows {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.workspace-flow-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 130px;
  padding: 7px 10px;
  border-radius: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #f8fbff;
  color: #5f6c82;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.workspace-flow-tab strong {
  color: #102033;
  font-size: 13px;
}

.workspace-flow-tab span {
  font-size: 11px;
}

.workspace-flow-tab.is-active {
  border-color: rgba(37, 99, 235, 0.24);
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(15, 118, 110, 0.1));
  box-shadow: 0 10px 28px rgba(37, 99, 235, 0.12);
}

.workspace-flow-tab:hover {
  transform: translateY(-1px);
}

/* 操作按钮默认隐藏，悬停或激活时出现，避免和流程名抢视觉焦点 */
.workspace-flow-tab__actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.workspace-flow-tab:hover .workspace-flow-tab__actions,
.workspace-flow-tab.is-active .workspace-flow-tab__actions {
  opacity: 1;
}

.workspace-flow-tab__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
}

.workspace-flow-tab__action:hover {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.workspace-flow-tab__action.is-danger:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.workspace-bar__search {
  width: 200px;
}

.designer-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
}

.workspace-sidebar {
  width: 240px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.workspace-section {
  padding: 12px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: var(--app-shadow);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workspace-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workspace-section__header h3 {
  margin: 0;
  font-size: 15px;
  color: #102033;
}

.workspace-section__header span {
  min-width: 28px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  font-size: 12px;
  text-align: center;
}

.template-card,
.issue-card {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: #f8fbff;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.template-card:hover,
.issue-card:hover {
  transform: translateY(-1px);
  border-color: rgba(37, 99, 235, 0.18);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
}

.template-card strong,
.issue-card strong {
  display: block;
  margin-bottom: 6px;
  color: #102033;
  font-size: 13px;
}

.template-card span,
.issue-card span {
  color: #5f6c82;
  font-size: 12px;
  line-height: 1.6;
}

.workspace-empty {
  padding: 12px;
  border-radius: 14px;
  background: #f8fbff;
  color: #6b7280;
  font-size: 13px;
}

.designer-canvas {
  flex: 1;
  min-width: 0;
  padding: 14px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: var(--app-shadow);
}

.flow-designer {
  flex: 1;
  border-radius: 18px;
  overflow: hidden;
  background:
    linear-gradient(rgba(15, 23, 42, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 23, 42, 0.05) 1px, transparent 1px),
    rgba(247, 250, 253, 0.92);
  background-size: 28px 28px, 28px 28px, auto;
}

/* LogicFlow 2.x 小地图的 DOM 类名是 lf-mini-map */
.designer-canvas :deep(.lf-mini-map) {
  box-shadow: 0 16px 30px rgba(15, 23, 42, 0.16);
  border-radius: 16px;
}

.version-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.version-manager__summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f7faff;
  color: #5f6c82;
  font-size: 13px;
}

.version-manager__form {
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: #fff;
}

.version-manager__list-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.version-manager__empty {
  padding: 18px 14px;
  border: 1px dashed rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  color: #6b7280;
  background: #fff;
}

.version-manager__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding-right: 2px;
}

.version-card {
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #fff;
}

.version-card__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
  color: #102033;
}

.version-card__header span,
.version-card__meta {
  font-size: 12px;
  color: #6b7280;
}

.version-card__note {
  margin: 8px 0 0;
  color: #5f6c82;
  font-size: 13px;
  line-height: 1.6;
}

.version-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .workspace-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .designer-main {
    flex-direction: column;
  }

  .designer-canvas {
    min-height: 64vh;
  }
}

@media (max-width: 720px) {
  .designer-container {
    padding: 12px;
    gap: 10px;
  }

  .workspace-hero h1 {
    font-size: 24px;
  }

  .toolbar {
    padding: 12px;
    border-radius: 16px;
  }

  .designer-canvas {
    padding: 10px;
    border-radius: 18px;
  }
}
</style>

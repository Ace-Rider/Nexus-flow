import { computed, ref } from 'vue';
import type { WorkspaceFlowRecord } from '@/types/flow';
import {
  draftStorageKey,
  versionsStorageKey,
  workspaceStorageKey,
} from '@/utils/storageKeys';

// 工作台的流程列表和当前激活流程：
// 列表持久化在 localStorage，首次使用时给一组默认演示流程。
export function useWorkspaceFlows() {
  const workspaceFlows = ref<WorkspaceFlowRecord[]>([]);
  const activeFlowId = ref('demo-flow-001');

  const activeFlow = computed(
    () => workspaceFlows.value.find((item) => item.id === activeFlowId.value) || null,
  );

  // 默认演示流程：每次生成新的时间戳，避免排序上的歧义
  const buildDefaultFlows = (): WorkspaceFlowRecord[] => [
    {
      id: 'demo-flow-001',
      name: '请假审批',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'demo-flow-002',
      name: '报销流程',
      updatedAt: new Date().toISOString(),
    },
  ];

  const readWorkspaceFlows = () => {
    const raw = localStorage.getItem(getWorkspaceStorageKey());
    if (!raw) {
      return buildDefaultFlows();
    }

    try {
      const parsed = JSON.parse(raw) as WorkspaceFlowRecord[];
      return parsed.length > 0 ? parsed : buildDefaultFlows();
    } catch (error) {
      console.warn('Failed to parse workspace flows', error);
      return buildDefaultFlows();
    }
  };

  const saveWorkspaceFlows = (flows: WorkspaceFlowRecord[]) => {
    workspaceFlows.value = flows;
    localStorage.setItem(getWorkspaceStorageKey(), JSON.stringify(flows));
  };

  // 页面初始化：恢复列表，并保证当前激活 id 一定存在于列表中
  const initWorkspaceFlows = () => {
    saveWorkspaceFlows(readWorkspaceFlows());
    if (!workspaceFlows.value.some((item) => item.id === activeFlowId.value)) {
      activeFlowId.value = workspaceFlows.value[0]?.id || activeFlowId.value;
    }
  };

  // 编辑或保存后刷新当前流程的“最近更新时间”
  const syncActiveFlowRecord = () => {
    const flowId = activeFlowId.value;
    const name = workspaceFlows.value.find((item) => item.id === flowId)?.name || '未命名流程';
    const nextFlows = workspaceFlows.value.map((item) =>
      item.id === flowId ? { ...item, updatedAt: new Date().toISOString(), name } : item,
    );
    saveWorkspaceFlows(nextFlows);
  };

  // 新建一个流程并激活，返回新流程 id
  const createWorkspaceFlow = () => {
    const id = `flow_${Date.now()}`;
    const index = workspaceFlows.value.length + 1;
    saveWorkspaceFlows([
      ...workspaceFlows.value,
      {
        id,
        name: `新流程 ${index}`,
        updatedAt: new Date().toISOString(),
      },
    ]);
    activeFlowId.value = id;
    return id;
  };

  // 重命名流程：空名称直接拒绝，成功后刷新更新时间
  const renameWorkspaceFlow = (flowId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    saveWorkspaceFlows(
      workspaceFlows.value.map((item) =>
        item.id === flowId ? { ...item, name: trimmed, updatedAt: new Date().toISOString() } : item,
      ),
    );
    return true;
  };

  // 删除流程：连同本地草稿和版本记录一起清理；
  // 删除的是激活流程时自动切换到剩余的第一个；至少保留一个流程。
  const removeWorkspaceFlow = (flowId: string) => {
    if (workspaceFlows.value.length <= 1) return false;

    try {
      localStorage.removeItem(draftStorageKey(flowId));
      localStorage.removeItem(versionsStorageKey(flowId));
    } catch (error) {
      console.warn('Failed to clean flow storage', error);
    }

    const nextFlows = workspaceFlows.value.filter((item) => item.id !== flowId);
    saveWorkspaceFlows(nextFlows);
    if (activeFlowId.value === flowId) {
      activeFlowId.value = nextFlows[0].id;
    }
    return true;
  };

  const formatWorkspaceTime = (value: string) => new Date(value).toLocaleDateString();

  return {
    workspaceFlows,
    activeFlowId,
    activeFlow,
    initWorkspaceFlows,
    syncActiveFlowRecord,
    createWorkspaceFlow,
    renameWorkspaceFlow,
    removeWorkspaceFlow,
    formatWorkspaceTime,
  };
}

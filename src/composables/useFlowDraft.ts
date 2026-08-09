import { ElMessageBox } from 'element-plus';
import type { GraphData } from '@/types/flow';

// 草稿的存储结构：完整图数据 + 更新时间，用于恢复前向用户确认
export type FlowDraftPayload = {
  data: GraphData;
  updatedAt: string;
};

// 本地草稿按“流程 id”分别存储，避免多个流程互相覆盖
const getDraftStorageKey = (flowId: string) => `nexus-flow:draft:${flowId}`;

// 自动保存做一个短暂防抖，避免拖动节点时频繁写 localStorage
const draftDelay = 800;

// 配额不足的提醒按流程区分、每次会话只弹一次，避免反复弹窗打断编辑
const quotaWarnedFlowIds = new Set<string>();

// 把图数据导出为 JSON 文件下载，作为 localStorage 写不进去时的兜底备份
const downloadDraftBackup = (flowId: string, data: GraphData) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `nexus-flow-draft-${flowId}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
};

const getGraphSnapshot = (data: GraphData) => JSON.stringify(data);

// 草稿的读写、防抖调度收敛在这个组合式函数里，页面组件只负责调用
export function useFlowDraft() {
  let draftTimer: number | null = null;
  // 记录上一次已经落到本地的图快照，内容没变时就不重复写入
  let lastDraftSnapshot = '';

  // 读取本地草稿；如果草稿损坏，顺手清掉错误数据
  const readDraft = (flowId: string): FlowDraftPayload | null => {
    const raw = localStorage.getItem(getDraftStorageKey(flowId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as FlowDraftPayload;
    } catch (error) {
      console.warn('Failed to parse local draft', error);
      localStorage.removeItem(getDraftStorageKey(flowId));
      return null;
    }
  };

  // 把当前流程图保存为本地草稿
  const writeDraft = (flowId: string, data: GraphData) => {
    const snapshot = getGraphSnapshot(data);
    if (snapshot === lastDraftSnapshot) return;

    const payload: FlowDraftPayload = {
      data,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(getDraftStorageKey(flowId), JSON.stringify(payload));
    } catch (error) {
      // localStorage 配额不足时草稿写不进去：每个流程每次会话只提醒一次，
      // 并引导用户立即导出 JSON 备份，避免继续编辑后数据静默丢失
      console.warn('Failed to write local draft', error);
      if (!quotaWarnedFlowIds.has(flowId)) {
        quotaWarnedFlowIds.add(flowId);
        ElMessageBox.confirm(
          '本地存储空间不足，草稿已无法自动保存。为避免数据丢失，建议立即导出 JSON 备份文件。',
          '本地存储空间不足',
          {
            confirmButtonText: '导出备份',
            cancelButtonText: '暂不导出',
            type: 'warning',
          },
        )
          .then(() => downloadDraftBackup(flowId, data))
          .catch(() => {
            // 用户选择暂不导出，无需处理
          });
      }
    }

    lastDraftSnapshot = snapshot;
  };

  // 正式保存成功后清空对应草稿，避免旧草稿覆盖新数据
  const clearDraft = (flowId: string) => {
    localStorage.removeItem(getDraftStorageKey(flowId));
    lastDraftSnapshot = '';
  };

  // 外部直接同步“最新快照”，避免 applyFlowData 之后又触发一次重复写入
  const markDraftSnapshot = (data: GraphData) => {
    lastDraftSnapshot = getGraphSnapshot(data);
  };

  // 每次图数据变化都重新计时，只在“短暂停止编辑”后保存一次
  const scheduleDraftWrite = (flowId: string, data: GraphData) => {
    if (draftTimer !== null) {
      window.clearTimeout(draftTimer);
    }
    draftTimer = window.setTimeout(() => {
      draftTimer = null;
      writeDraft(flowId, data);
    }, draftDelay);
  };

  // 切换流程或组件销毁时清掉未执行的定时器
  const cancelDraftWrite = () => {
    if (draftTimer !== null) {
      window.clearTimeout(draftTimer);
      draftTimer = null;
    }
  };

  return {
    readDraft,
    writeDraft,
    clearDraft,
    markDraftSnapshot,
    scheduleDraftWrite,
    cancelDraftWrite,
  };
}

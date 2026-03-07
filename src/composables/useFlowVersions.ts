import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { deleteFlowVersion, readFlowVersions, saveFlowVersion } from '@/utils/version';
import type { FlowVersionForm, FlowVersionRecord, GraphData } from '@/types/flow';

const formatVersionName = () => `版本 ${new Date().toLocaleString()}`;
const formatVersionTime = (value: string) => new Date(value).toLocaleString();

// 恢复版本需要的画布访问能力由页面提供，composable 本身不依赖画布组件
type RestoreVersionOptions = {
  getCurrentData: () => GraphData | null;
  apply: (data: GraphData) => void;
};

// 版本管理：抽屉状态、版本列表、保存/恢复/删除全部收敛在这里
export function useFlowVersions() {
  const versionDrawerVisible = ref(false);
  const versionSaving = ref(false);
  const flowVersions = ref<FlowVersionRecord[]>([]);
  const versionForm = ref<FlowVersionForm>({ name: '', note: '' });

  // 从本地读取版本历史，版本管理面板打开时也会主动刷新一次
  const refreshVersions = (flowId: string) => {
    flowVersions.value = readFlowVersions(flowId);
  };

  // 打开版本管理抽屉时，顺手填一个默认版本名，方便用户直接保存
  const openVersionManager = (flowId: string) => {
    versionForm.value = {
      name: formatVersionName(),
      note: '',
    };
    refreshVersions(flowId);
    versionDrawerVisible.value = true;
  };

  // 将当前画布快照保存为一个新版本（版本管理抽屉里的按钮）
  const saveCurrentVersion = (flowId: string, data: GraphData | null | undefined) => {
    if (versionSaving.value) return;

    if (!data) {
      ElMessage.warning('当前没有可保存的流程数据');
      return;
    }

    versionSaving.value = true;
    try {
      flowVersions.value = saveFlowVersion(flowId, {
        name: versionForm.value.name,
        note: versionForm.value.note,
        data,
      });
      ElMessage.success('版本已保存');
      versionForm.value = {
        name: formatVersionName(),
        note: '',
      };
    } catch (error: any) {
      // 保存失败（如本地存储配额不足）时给出明确提示
      ElMessage.error(error.message || '版本保存失败');
    } finally {
      versionSaving.value = false;
    }
  };

  // 供“保存流程”等场景复用的静默版本快照：成功返回 true，失败不抛出
  const persistVersionSnapshot = (
    flowId: string,
    payload: { name: string; note: string; data: GraphData },
  ) => {
    try {
      flowVersions.value = saveFlowVersion(flowId, payload);
      return true;
    } catch (error) {
      console.warn('Failed to persist version snapshot', error);
      return false;
    }
  };

  // 恢复历史版本前先确认；lf.render 会清空撤销历史，
  // 所以恢复前先把当前内容自动存成一个版本，保证这次操作可回退。
  const restoreVersionData = async (
    flowId: string,
    version: FlowVersionRecord,
    { getCurrentData, apply }: RestoreVersionOptions,
  ) => {
    try {
      await ElMessageBox.confirm(
        `是否恢复版本「${version.name}」？恢复后当前画布会被覆盖，恢复前会自动备份当前内容。`,
        '恢复版本',
        {
          confirmButtonText: '恢复',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );

      const currentData = getCurrentData();
      if (currentData && currentData.nodes.length + currentData.edges.length > 0) {
        const backedUp = persistVersionSnapshot(flowId, {
          name: '恢复前自动备份',
          note: `恢复「${version.name}」前自动创建`,
          data: currentData,
        });
        if (!backedUp) {
          // 备份失败（如本地存储配额不足）不阻塞恢复本身，但要提醒用户
          ElMessage.warning('恢复前自动备份失败，当前内容可能无法回退');
        }
      }

      apply(version.data);
      ElMessage.success('版本已恢复');
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        throw error;
      }
    }
  };

  // 删除版本时同样做一次确认，防止误删历史快照
  const removeVersionById = async (flowId: string, version: FlowVersionRecord) => {
    try {
      await ElMessageBox.confirm(`是否删除版本「${version.name}」？`, '删除版本', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      });
      flowVersions.value = deleteFlowVersion(flowId, version.id);
      ElMessage.success('版本已删除');
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        throw error;
      }
    }
  };

  return {
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
  };
}

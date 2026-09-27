import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useFlowVersions } from '@/composables/useFlowVersions';
import type { FlowVersionRecord, GraphData } from '@/types/flow';
import { versionsStorageKey } from '@/utils/storageKeys';

// 消息与确认框组件不参与单测，行为在各用例里按需指定
vi.mock('element-plus', () => ({
  ElMessage: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  ElMessageBox: { confirm: vi.fn().mockRejectedValue('cancel') },
}));

const buildGraph = (nodeId = 'node_1'): GraphData => ({
  nodes: [{ id: nodeId, type: 'rect', x: 100, y: 100, text: '开始' }],
  edges: [],
});

// 造一条已存在的版本记录，模拟历史版本
const buildVersion = (id: string, data: GraphData): FlowVersionRecord => ({
  id,
  name: `历史版本 ${id}`,
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  nodeCount: data.nodes.length,
  edgeCount: data.edges.length,
  data,
});

describe('useFlowVersions 版本管理', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(ElMessage.success).mockClear();
    vi.mocked(ElMessage.warning).mockClear();
    vi.mocked(ElMessage.error).mockClear();
    vi.mocked(ElMessageBox.confirm).mockReset();
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 配额场景统一用 stubGlobal 整体替换 localStorage：
  // happy-dom 的 localStorage 是 Proxy，对其 setItem 打 spy 时 mock 实现会跨用例残留，
  // stubGlobal 是 vitest 原生能力，卸载干净、行为可控
  const stubQuotaExceededStorage = () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
      clear: () => {},
    });
  };

  describe('openVersionManager / refreshVersions', () => {
    it('打开抽屉时填默认版本名并加载本地版本列表', () => {
      localStorage.setItem(
        versionsStorageKey('flow-a'),
        JSON.stringify([buildVersion('v1', buildGraph())]),
      );
      const { openVersionManager, versionDrawerVisible, versionForm, flowVersions } =
        useFlowVersions();

      openVersionManager('flow-a');

      expect(versionDrawerVisible.value).toBe(true);
      expect(versionForm.value.name.startsWith('版本 ')).toBe(true);
      expect(flowVersions.value).toHaveLength(1);
      expect(flowVersions.value[0].id).toBe('v1');
    });
  });

  describe('saveCurrentVersion', () => {
    it('没有画布数据时提示警告，不产生版本', () => {
      const { saveCurrentVersion, flowVersions } = useFlowVersions();

      saveCurrentVersion('flow-a', null);

      expect(ElMessage.warning).toHaveBeenCalledWith('当前没有可保存的流程数据');
      expect(flowVersions.value).toHaveLength(0);
      expect(localStorage.getItem(versionsStorageKey('flow-a'))).toBeNull();
    });

    it('保存成功后更新版本列表、重置表单并提示成功', () => {
      const { saveCurrentVersion, versionForm, flowVersions, versionSaving } =
        useFlowVersions();
      versionForm.value = { name: '里程碑', note: '上线前快照' };

      saveCurrentVersion('flow-a', buildGraph());

      expect(flowVersions.value).toHaveLength(1);
      expect(flowVersions.value[0].name).toBe('里程碑');
      expect(flowVersions.value[0].note).toBe('上线前快照');
      expect(ElMessage.success).toHaveBeenCalledWith('版本已保存');
      // 表单重置为新的默认名，保存状态复位
      expect(versionForm.value.name.startsWith('版本 ')).toBe(true);
      expect(versionForm.value.note).toBe('');
      expect(versionSaving.value).toBe(false);
    });

    it('保存失败（配额不足）时透出错误消息', () => {
      stubQuotaExceededStorage();
      const { saveCurrentVersion } = useFlowVersions();

      saveCurrentVersion('flow-a', buildGraph());

      expect(ElMessage.error).toHaveBeenCalled();
    });
  });

  describe('persistVersionSnapshot', () => {
    it('静默快照成功返回 true', () => {
      const { persistVersionSnapshot } = useFlowVersions();

      const ok = persistVersionSnapshot('flow-a', {
        name: '正式保存',
        note: '',
        data: buildGraph(),
      });

      expect(ok).toBe(true);
    });

    it('写入失败返回 false 且不抛错', () => {
      stubQuotaExceededStorage();
      const { persistVersionSnapshot } = useFlowVersions();

      expect(
        persistVersionSnapshot('flow-a', { name: 'x', note: '', data: buildGraph() }),
      ).toBe(false);
    });
  });

  describe('restoreVersionData', () => {
    // 恢复需要的画布访问能力：记录 apply 收到的数据，getCurrentData 返回当前画布
    const setupRestore = (currentData: GraphData | null) => {
      const applied: GraphData[] = [];
      return {
        applied,
        options: {
          getCurrentData: () => currentData,
          apply: (data: GraphData) => applied.push(data),
        },
      };
    };

    it('确认恢复后：先自动备份当前内容，再应用版本数据', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValue(undefined);
      const currentData = buildGraph('current-node');
      const targetData = buildGraph('target-node');
      localStorage.setItem(
        versionsStorageKey('flow-a'),
        JSON.stringify([buildVersion('v1', targetData)]),
      );
      const { restoreVersionData, flowVersions, refreshVersions } = useFlowVersions();
      refreshVersions('flow-a');
      const { applied, options } = setupRestore(currentData);

      await restoreVersionData('flow-a', flowVersions.value[0], options);

      // 应用的是目标版本的数据
      expect(applied).toEqual([targetData]);
      expect(ElMessage.success).toHaveBeenCalledWith('版本已恢复');
      // 版本列表头部多了一条「恢复前自动备份」，快照内容是恢复前的画布
      expect(flowVersions.value).toHaveLength(2);
      expect(flowVersions.value[0].name).toBe('恢复前自动备份');
      expect(flowVersions.value[0].data.nodes[0].id).toBe('current-node');
    });

    it('当前画布为空时不产生自动备份', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValue(undefined);
      const targetData = buildGraph('target-node');
      localStorage.setItem(
        versionsStorageKey('flow-a'),
        JSON.stringify([buildVersion('v1', targetData)]),
      );
      const { restoreVersionData, flowVersions, refreshVersions } = useFlowVersions();
      refreshVersions('flow-a');
      const { applied, options } = setupRestore({ nodes: [], edges: [] });

      await restoreVersionData('flow-a', flowVersions.value[0], options);

      expect(applied).toEqual([targetData]);
      expect(flowVersions.value).toHaveLength(1);
    });

    it('自动备份失败不阻塞恢复，但要提醒用户', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValue(undefined);
      // 目标版本直接构造传入，不依赖本地存储；存储写入全部失败模拟配额不足
      stubQuotaExceededStorage();
      const version = buildVersion('v1', buildGraph('target-node'));
      const { restoreVersionData } = useFlowVersions();
      const { applied, options } = setupRestore(buildGraph('current-node'));

      await restoreVersionData('flow-a', version, options);

      expect(applied).toEqual([version.data]);
      expect(ElMessage.warning).toHaveBeenCalledWith(
        '恢复前自动备份失败，当前内容可能无法回退',
      );
      expect(ElMessage.success).toHaveBeenCalledWith('版本已恢复');
    });

    it('用户取消时不应用版本、不产生备份', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel');
      const { restoreVersionData, flowVersions } = useFlowVersions();
      const { applied, options } = setupRestore(buildGraph('current-node'));
      const version = buildVersion('v1', buildGraph('target-node'));

      await expect(restoreVersionData('flow-a', version, options)).resolves.toBeUndefined();

      expect(applied).toHaveLength(0);
      expect(flowVersions.value).toHaveLength(0);
      expect(ElMessage.success).not.toHaveBeenCalled();
    });
  });

  describe('removeVersionById', () => {
    it('确认后删除版本并提示成功', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValue(undefined);
      localStorage.setItem(
        versionsStorageKey('flow-a'),
        JSON.stringify([buildVersion('v1', buildGraph()), buildVersion('v2', buildGraph())]),
      );
      const { removeVersionById, flowVersions, refreshVersions } = useFlowVersions();
      refreshVersions('flow-a');

      await removeVersionById('flow-a', flowVersions.value[0]);

      expect(flowVersions.value).toHaveLength(1);
      expect(flowVersions.value[0].id).toBe('v2');
      expect(ElMessage.success).toHaveBeenCalledWith('版本已删除');
    });

    it('用户取消时不删除', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel');
      localStorage.setItem(
        versionsStorageKey('flow-a'),
        JSON.stringify([buildVersion('v1', buildGraph())]),
      );
      const { removeVersionById, flowVersions, refreshVersions } = useFlowVersions();
      refreshVersions('flow-a');

      await removeVersionById('flow-a', flowVersions.value[0]);

      expect(flowVersions.value).toHaveLength(1);
      expect(ElMessage.success).not.toHaveBeenCalled();
    });
  });
});

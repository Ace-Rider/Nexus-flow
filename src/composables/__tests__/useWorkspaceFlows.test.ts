import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceFlows } from '@/composables/useWorkspaceFlows';
import type { WorkspaceFlowRecord } from '@/types/flow';
import {
  draftStorageKey,
  versionsStorageKey,
  workspaceStorageKey,
} from '@/utils/storageKeys';

// 存入一组工作台流程，模拟非首次使用的本地状态
const seedWorkspace = (flows: WorkspaceFlowRecord[]) => {
  localStorage.setItem(workspaceStorageKey(), JSON.stringify(flows));
};

describe('useWorkspaceFlows 工作台流程', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('initWorkspaceFlows', () => {
    it('首次使用（无本地数据）时创建默认演示流程并激活第一个', () => {
      const { initWorkspaceFlows, workspaceFlows, activeFlowId } = useWorkspaceFlows();

      initWorkspaceFlows();

      expect(workspaceFlows.value.map((item) => item.name)).toEqual(['请假审批', '报销流程']);
      expect(activeFlowId.value).toBe('demo-flow-001');
    });

    it('本地数据损坏时回退到默认演示流程', () => {
      localStorage.setItem(workspaceStorageKey(), '{broken json');
      const { initWorkspaceFlows, workspaceFlows } = useWorkspaceFlows();

      initWorkspaceFlows();

      expect(workspaceFlows.value).toHaveLength(2);
      expect(workspaceFlows.value[0].name).toBe('请假审批');
    });

    it('本地数据为空数组时同样回退到默认流程', () => {
      seedWorkspace([]);
      const { initWorkspaceFlows, workspaceFlows } = useWorkspaceFlows();

      initWorkspaceFlows();

      expect(workspaceFlows.value).toHaveLength(2);
    });

    it('恢复的列表里没有默认激活 id 时，切到列表第一个流程', () => {
      seedWorkspace([
        { id: 'flow_x', name: '已有流程', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]);
      const { initWorkspaceFlows, activeFlowId, activeFlow } = useWorkspaceFlows();

      initWorkspaceFlows();

      expect(activeFlowId.value).toBe('flow_x');
      expect(activeFlow.value?.name).toBe('已有流程');
    });
  });

  describe('createWorkspaceFlow', () => {
    it('新建流程：追加到列表、自动激活并返回新 id', () => {
      const { initWorkspaceFlows, createWorkspaceFlow, workspaceFlows, activeFlowId } =
        useWorkspaceFlows();
      initWorkspaceFlows();

      const newId = createWorkspaceFlow();

      expect(newId).toBeTruthy();
      expect(activeFlowId.value).toBe(newId);
      expect(workspaceFlows.value).toHaveLength(3);
      expect(workspaceFlows.value[workspaceFlows.value.length - 1]).toMatchObject({
        id: newId,
        name: '新流程 3',
      });
    });
  });

  describe('renameWorkspaceFlow', () => {
    it('重命名成功：写入修剪后的名称并刷新更新时间', () => {
      const { initWorkspaceFlows, renameWorkspaceFlow, workspaceFlows } = useWorkspaceFlows();
      initWorkspaceFlows();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T08:00:00.000Z'));

      expect(renameWorkspaceFlow('demo-flow-001', '  请假流程 V2  ')).toBe(true);
      const renamed = workspaceFlows.value.find((item) => item.id === 'demo-flow-001')!;
      expect(renamed.name).toBe('请假流程 V2');
      expect(renamed.updatedAt).toBe('2026-06-01T08:00:00.000Z');

      vi.useRealTimers();
    });

    it('空名称或纯空格被拒绝', () => {
      const { initWorkspaceFlows, renameWorkspaceFlow } = useWorkspaceFlows();
      initWorkspaceFlows();

      expect(renameWorkspaceFlow('demo-flow-001', '   ')).toBe(false);
      expect(renameWorkspaceFlow('demo-flow-001', '')).toBe(false);
    });
  });

  describe('removeWorkspaceFlow', () => {
    it('删除流程时一并清理本地草稿和版本记录', () => {
      const { initWorkspaceFlows, removeWorkspaceFlow } = useWorkspaceFlows();
      initWorkspaceFlows();
      localStorage.setItem(draftStorageKey('demo-flow-002'), '{}');
      localStorage.setItem(versionsStorageKey('demo-flow-002'), '[]');

      expect(removeWorkspaceFlow('demo-flow-002')).toBe(true);
      expect(localStorage.getItem(draftStorageKey('demo-flow-002'))).toBeNull();
      expect(localStorage.getItem(versionsStorageKey('demo-flow-002'))).toBeNull();
    });

    it('删除的是激活流程时，自动切到剩余的第一个', () => {
      const { initWorkspaceFlows, removeWorkspaceFlow, activeFlowId } = useWorkspaceFlows();
      initWorkspaceFlows();

      removeWorkspaceFlow('demo-flow-001');

      expect(activeFlowId.value).toBe('demo-flow-002');
    });

    it('列表只剩一个流程时拒绝删除', () => {
      seedWorkspace([{ id: 'flow_x', name: '最后一个', updatedAt: '2026-01-01T00:00:00.000Z' }]);
      const { initWorkspaceFlows, removeWorkspaceFlow, workspaceFlows } = useWorkspaceFlows();
      initWorkspaceFlows();

      expect(removeWorkspaceFlow('flow_x')).toBe(false);
      expect(workspaceFlows.value).toHaveLength(1);
    });
  });

  describe('syncActiveFlowRecord', () => {
    it('编辑后刷新当前流程的更新时间，名称保持不变', () => {
      const { initWorkspaceFlows, syncActiveFlowRecord, activeFlow } = useWorkspaceFlows();
      initWorkspaceFlows();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-02T10:00:00.000Z'));

      syncActiveFlowRecord();

      expect(activeFlow.value?.updatedAt).toBe('2026-06-02T10:00:00.000Z');
      expect(activeFlow.value?.name).toBe('请假审批');

      vi.useRealTimers();
    });
  });
});

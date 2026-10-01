import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { useFlowDraft, resetDraftWarnState } from '@/composables/useFlowDraft';
import type { GraphData } from '@/types/flow';
import { draftStorageKey } from '@/utils/storageKeys';

// 弹窗组件不参与单测：默认按“用户取消”处理
vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: vi.fn().mockRejectedValue('cancel') },
}));

const buildGraph = (overrides: Partial<GraphData> = {}): GraphData => ({
  nodes: [{ id: 'node_1', type: 'rect', x: 100, y: 100, text: '开始' }],
  edges: [],
  ...overrides,
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

describe('useFlowDraft 本地草稿', () => {
  beforeEach(() => {
    localStorage.clear();
    // 隔离模块级的提醒去重状态，避免用例之间隐式耦合
    resetDraftWarnState();
    vi.mocked(ElMessageBox.confirm).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('readDraft', () => {
    it('没有草稿时返回 null', () => {
      const { readDraft } = useFlowDraft();
      expect(readDraft('flow-a')).toBeNull();
    });

    it('能读回写入的草稿数据和更新时间', () => {
      const { writeDraft, readDraft } = useFlowDraft();
      const data = buildGraph();
      writeDraft('flow-a', data);

      const draft = readDraft('flow-a')!;
      expect(draft.data).toEqual(data);
      expect(new Date(draft.updatedAt).getTime()).not.toBeNaN();
    });

    it('草稿损坏时清掉错误数据并返回 null', () => {
      localStorage.setItem(draftStorageKey('flow-a'), '{broken json');
      const { readDraft } = useFlowDraft();

      expect(readDraft('flow-a')).toBeNull();
      expect(localStorage.getItem(draftStorageKey('flow-a'))).toBeNull();
    });
  });

  describe('writeDraft', () => {
    it('内容没有变化时不重复写入', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      const { writeDraft } = useFlowDraft();
      const data = buildGraph();

      writeDraft('flow-a', data);
      writeDraft('flow-a', data);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    it('markDraftSnapshot 同步快照后跳过相同内容的写入', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      const { markDraftSnapshot, writeDraft } = useFlowDraft();
      const data = buildGraph();

      markDraftSnapshot(data);
      writeDraft('flow-a', data);
      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('写入失败（配额不足）时弹确认框引导导出，同一流程每次会话只提醒一次', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel');
      stubQuotaExceededStorage();
      const { writeDraft } = useFlowDraft();

      // 第一次失败：弹出引导
      writeDraft('flow-a', buildGraph());
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);

      // 同一流程再次失败：不再弹窗打断
      writeDraft('flow-a', buildGraph({ nodes: [{ id: 'node_2', x: 1, y: 1 }] }));
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);

      // 其他流程失败：仍会提醒
      writeDraft('flow-b', buildGraph());
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(2);
    });

    it('重置提醒状态后，同一流程的下次配额失败会再次提醒', () => {
      stubQuotaExceededStorage();
      const { writeDraft } = useFlowDraft();

      writeDraft('flow-a', buildGraph());
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);

      resetDraftWarnState();
      writeDraft('flow-a', buildGraph({ nodes: [{ id: 'node_2', x: 1, y: 1 }] }));
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(2);
    });

    it('写入失败不影响快照标记：确认框 catch 后不会抛错', () => {
      stubQuotaExceededStorage();
      const { writeDraft } = useFlowDraft();

      expect(() => writeDraft('flow-a', buildGraph())).not.toThrow();
    });
  });

  describe('clearDraft', () => {
    it('正式保存后清空草稿，并允许后续相同内容重新写入', () => {
      const { writeDraft, clearDraft, readDraft } = useFlowDraft();
      const data = buildGraph();

      writeDraft('flow-a', data);
      clearDraft('flow-a');
      expect(readDraft('flow-a')).toBeNull();

      // 快照已重置：同内容再次保存仍能写入
      writeDraft('flow-a', data);
      expect(readDraft('flow-a')).not.toBeNull();
    });
  });

  describe('scheduleDraftWrite / cancelDraftWrite', () => {
    it('防抖：连续调度只落地一次写入', () => {
      vi.useFakeTimers();
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      const { scheduleDraftWrite } = useFlowDraft();

      scheduleDraftWrite('flow-a', buildGraph());
      scheduleDraftWrite('flow-a', buildGraph({ nodes: [{ id: 'n2', x: 2, y: 2 }] }));
      vi.advanceTimersByTime(800);

      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(draftStorageKey('flow-a'))).toContain('n2');
    });

    it('切换流程时取消未执行的定时器，不再写入', () => {
      vi.useFakeTimers();
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      const { scheduleDraftWrite, cancelDraftWrite } = useFlowDraft();

      scheduleDraftWrite('flow-a', buildGraph());
      cancelDraftWrite();
      vi.advanceTimersByTime(800);

      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  readFlowVersions,
  saveFlowVersion,
  deleteFlowVersion,
  getFlowVersionById,
} from '@/utils/version';
import type { GraphData } from '@/types/flow';

const flowId = 'test-flow';
const sampleData: GraphData = {
  nodes: [
    { id: '1', type: 'rect', x: 0, y: 0, text: '开始' },
    { id: '2', type: 'rect', x: 1, y: 1, text: '结束' },
  ],
  edges: [{ id: 'e1', sourceNodeId: '1', targetNodeId: '2', type: 'polyline' }],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readFlowVersions', () => {
  it('没有版本记录时返回空数组', () => {
    expect(readFlowVersions(flowId)).toEqual([]);
  });

  it('本地数据损坏时返回空数组并清掉脏数据', () => {
    localStorage.setItem(`nexus-flow:versions:${flowId}`, 'not-json');
    expect(readFlowVersions(flowId)).toEqual([]);
    expect(localStorage.getItem(`nexus-flow:versions:${flowId}`)).toBeNull();
  });
});

describe('saveFlowVersion', () => {
  it('保存后能读回，且记录节点/边数量', () => {
    const versions = saveFlowVersion(flowId, { name: 'v1', note: 'first', data: sampleData });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      name: 'v1',
      note: 'first',
      nodeCount: 2,
      edgeCount: 1,
    });
    expect(readFlowVersions(flowId)[0].id).toBe(versions[0].id);
  });

  it('空白名称兜底为“未命名版本”', () => {
    const versions = saveFlowVersion(flowId, { name: '   ', note: '', data: sampleData });
    expect(versions[0].name).toBe('未命名版本');
  });

  it('新版本排在最前面', () => {
    saveFlowVersion(flowId, { name: 'old', note: '', data: sampleData });
    saveFlowVersion(flowId, { name: 'new', note: '', data: sampleData });
    const names = readFlowVersions(flowId).map((item) => item.name);
    expect(names).toEqual(['new', 'old']);
  });

  it('版本数量上限 20，超出时丢弃最旧的', () => {
    for (let i = 1; i <= 22; i += 1) {
      saveFlowVersion(flowId, { name: `v${i}`, note: '', data: sampleData });
    }
    const versions = readFlowVersions(flowId);
    expect(versions).toHaveLength(20);
    // 最新的 v22 在最前，v21/v20 保留，v1/v2 被丢弃
    expect(versions[0].name).toBe('v22');
    expect(versions.map((item) => item.name)).not.toContain('v1');
  });

  it('写入失败（配额不足）时抛出明确错误', () => {
    // happy-dom 的全局 localStorage 代理下 restoreAllMocks 不可靠，这里手动恢复
    const setItemSpy = vi
      .spyOn(localStorage, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        saveFlowVersion(flowId, { name: 'big', note: '', data: sampleData }),
      ).toThrowError('本地存储空间不足');
      expect(warn).toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('deleteFlowVersion / getFlowVersionById', () => {
  it('删除指定版本后其他版本保留', () => {
    saveFlowVersion(flowId, { name: 'v1', note: '', data: sampleData });
    const target = saveFlowVersion(flowId, { name: 'v2', note: '', data: sampleData })[0];
    saveFlowVersion(flowId, { name: 'v3', note: '', data: sampleData });

    const remaining = deleteFlowVersion(flowId, target.id);
    expect(remaining.map((item) => item.name)).toEqual(['v3', 'v1']);
    expect(getFlowVersionById(flowId, target.id)).toBeNull();
  });

  it('getFlowVersionById 能取到刚保存的版本', () => {
    const saved = saveFlowVersion(flowId, { name: 'v1', note: '', data: sampleData })[0];
    expect(getFlowVersionById(flowId, saved.id)?.name).toBe('v1');
  });
});

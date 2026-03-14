import { describe, it, expect } from 'vitest';
import { validateFlowData } from '@/utils/flowValidation';
import type { GraphData } from '@/types/flow';

// 构造图数据的便捷函数：只关心 id 和连线关系
const buildGraph = (
  nodeIds: string[],
  edgePairs: Array<[string, string]>,
): GraphData => ({
  nodes: nodeIds.map((id) => ({ id, type: 'rect', x: 0, y: 0 })),
  edges: edgePairs.map(([sourceNodeId, targetNodeId], index) => ({
    id: `edge_${index}`,
    sourceNodeId,
    targetNodeId,
    type: 'polyline',
  })),
});

// 用例的标题字段聚合出 issue 摘要，断言写起来更短
const issueTitles = (data: GraphData) => validateFlowData(data).issues.map((issue) => issue.title);

describe('validateFlowData', () => {
  it('空流程：返回空流程问题', () => {
    const result = validateFlowData({ nodes: [], edges: [] });
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toBe('空流程');
  });

  it('合法流程：开始 -> 审批 -> 结束', () => {
    const result = validateFlowData(buildGraph(['1', '2', '3'], [['1', '2'], ['2', '3']]));
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('坏连线：边引用了不存在的节点', () => {
    const titles = issueTitles(buildGraph(['a'], [['a', 'ghost']]));
    expect(titles).toContain('坏连线');
  });

  it('环流程：同时缺少起点和终点', () => {
    const titles = issueTitles(buildGraph(['a', 'b'], [['a', 'b'], ['b', 'a']]));
    expect(titles).toContain('缺少起点');
    expect(titles).toContain('缺少终点');
  });

  it('孤立节点：无入度也无出度的节点会被点名', () => {
    const titles = issueTitles(buildGraph(['a', 'b', 'lonely'], [['a', 'b']]));
    expect(titles).toContain('孤立节点');
  });

  it('图不连通：两条独立链路会被识别', () => {
    const titles = issueTitles(
      buildGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]),
    );
    expect(titles).toContain('图不连通');
  });

  it('节点文本优先于 id 出现在提示里', () => {
    const data = buildGraph(['a', 'b', 'lonely'], [['a', 'b']]);
    data.nodes[2].text = '游离节点';
    const issue = validateFlowData(data).issues.find((item) => item.title === '孤立节点');
    expect(issue?.message).toContain('游离节点');
  });
});

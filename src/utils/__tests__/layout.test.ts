import { describe, it, expect, vi } from 'vitest';
import { computeLayout } from '@/utils/layout';

// 造一个带默认尺寸的节点，参数顺序和旧版 worker 的测试保持一致
const node = (id: string, x = 0, y = 0, width = 100, height = 80) => ({
  id,
  x,
  y,
  width,
  height,
});

describe('computeLayout 智能布局', () => {
  it('空节点列表：返回空结果', () => {
    expect(computeLayout([], [], 1200, 800)).toEqual([]);
  });

  it('线性链路：所有节点都有新坐标且落在画布范围内', () => {
    const positions = computeLayout(
      [node('a'), node('b'), node('c')],
      [
        { sourceNodeId: 'a', targetNodeId: 'b' },
        { sourceNodeId: 'b', targetNodeId: 'c' },
      ],
      1200,
      800,
    );
    expect(positions).toHaveLength(3);
    positions.forEach((position) => {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(1200);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(800);
    });
  });

  it('线性链路：层级从左到右递进（a → b → c）', () => {
    const positions = computeLayout(
      [node('a'), node('b'), node('c')],
      [
        { sourceNodeId: 'a', targetNodeId: 'b' },
        { sourceNodeId: 'b', targetNodeId: 'c' },
      ],
      1200,
      800,
    );
    const byId = new Map(positions.map((position) => [position.id, position]));
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x);
    expect(byId.get('b')!.x).toBeLessThan(byId.get('c')!.x);
  });

  it('无连线：退化为网格布局，节点仍然齐全', () => {
    const positions = computeLayout([node('a'), node('b'), node('c'), node('d')], [], 1200, 800);
    expect(positions.map((position) => position.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('网格布局：整体居中在画布中', () => {
    const positions = computeLayout([node('a')], [], 1200, 800);
    expect(positions[0]).toEqual({ id: 'a', x: 600, y: 400 });
  });

  it('含环图：dagre 自动去环，全部节点返回坐标', () => {
    const positions = computeLayout(
      [node('a'), node('b'), node('c'), node('d')],
      [
        { sourceNodeId: 'a', targetNodeId: 'b' },
        { sourceNodeId: 'b', targetNodeId: 'a' },
        { sourceNodeId: 'b', targetNodeId: 'c' },
        { sourceNodeId: 'c', targetNodeId: 'd' },
      ],
      1200,
      800,
    );
    expect(positions).toHaveLength(4);
    positions.forEach((position) => {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(1200);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(800);
    });
  });

  it('引用不存在节点的边被安全忽略', () => {
    const positions = computeLayout(
      [node('a'), node('b')],
      [{ sourceNodeId: 'a', targetNodeId: 'ghost' }],
      1200,
      800,
    );
    expect(positions).toHaveLength(2);
  });

  it('自环边被过滤，单节点走网格兜底', () => {
    const positions = computeLayout(
      [node('a')],
      [{ sourceNodeId: 'a', targetNodeId: 'a' }],
      1200,
      800,
    );
    expect(positions).toEqual([{ id: 'a', x: 600, y: 400 }]);
  });

  it('节点宽高缺省时用兜底尺寸计算，不报错', () => {
    const positions = computeLayout(
      [{ id: 'a' }, { id: 'b' }],
      [{ sourceNodeId: 'a', targetNodeId: 'b' }],
      1200,
      800,
    );
    expect(positions).toHaveLength(2);
  });
});

describe('layoutWorker 消息协议', () => {
  it('收到 LAYOUT 消息后回传 LAYOUT_RESULT，忽略其他消息', async () => {
    // 用 stub 的 self 捕获 worker 注册的监听器和 postMessage 输出
    let handleMessage: ((event: { data: unknown }) => void) | undefined;
    const posted: Array<{ type: string; data: unknown }> = [];
    vi.stubGlobal('self', {
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
        handleMessage = listener;
      },
      postMessage: (message: { type: string; data: unknown }) => {
        posted.push(message);
      },
    });

    // 动态导入才会执行模块顶层的 self.addEventListener 注册
    await import('@/workers/layoutWorker');

    // 非 LAYOUT 消息直接忽略
    handleMessage?.({ data: { type: 'OTHER', data: {} } });
    expect(posted).toHaveLength(0);

    handleMessage?.({
      data: {
        type: 'LAYOUT',
        data: { nodes: [node('a'), node('b')], edges: [], width: 1200, height: 800 },
      },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('LAYOUT_RESULT');
    // 2 个节点走网格兜底：cols=2、colGap=270、起点 465，整体垂直居中在 y=400
    expect(posted[0].data).toEqual([
      { id: 'a', x: 465, y: 400 },
      { id: 'b', x: 735, y: 400 },
    ]);
  });
});

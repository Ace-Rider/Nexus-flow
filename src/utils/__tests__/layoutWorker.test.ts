import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// public/worker.js 是一段依赖 self 的布局脚本，且 public 目录不能被源码直接 import：
// 这里读出源码，用 stub 的 self 捕获 message 监听器和 postMessage 输出后在 Node 里执行
type LayoutMessage = { type: string; data: unknown };

const node = (id: string, x = 0, y = 0, width = 100, height = 80) => ({
  id,
  x,
  y,
  width,
  height,
});

describe('public/worker.js 智能布局', () => {
  let handleMessage: ((event: { data: LayoutMessage }) => void) | null = null;
  let results: LayoutMessage[] = [];

  beforeAll(async () => {
    vi.stubGlobal('self', {
      addEventListener: (_type: string, listener: (event: { data: LayoutMessage }) => void) => {
        handleMessage = listener;
      },
      postMessage: (message: LayoutMessage) => {
        results.push(message);
      },
    });
    // 读出 worker 源码并在当前全局作用域执行：顶层注册的 self.addEventListener 即被 stub 捕获
    // （happy-dom 劫持了全局 URL 不支持相对解析，这里用 process.cwd 定位项目根）
    const workerSource = readFileSync(resolve(process.cwd(), 'public/worker.js'), 'utf-8');
    new Function(workerSource)();
  });

  const runLayout = (
    nodes: Array<ReturnType<typeof node>>,
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
    width = 1200,
    height = 800,
  ) => {
    results = [];
    handleMessage?.({
      data: { type: 'LAYOUT', data: { nodes, edges, width, height } },
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('LAYOUT_RESULT');
    return results[0].data as Array<{ id: string; x: number; y: number }>;
  };

  it('空节点列表：返回空结果', () => {
    expect(runLayout([], [])).toEqual([]);
  });

  it('线性链路：所有节点都有新坐标且落在画布范围内', () => {
    const positions = runLayout(
      [node('a'), node('b'), node('c')],
      [
        { sourceNodeId: 'a', targetNodeId: 'b' },
        { sourceNodeId: 'b', targetNodeId: 'c' },
      ],
    );
    expect(positions).toHaveLength(3);
    positions.forEach((position) => {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(1200);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(800);
    });
  });

  it('无连线：退化为网格布局，节点仍然齐全', () => {
    const positions = runLayout([node('a'), node('b'), node('c'), node('d')], []);
    expect(positions.map((position) => position.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('含环图（Tarjan 分量）：不会死循环，全部节点返回坐标', () => {
    const positions = runLayout(
      [node('a'), node('b'), node('c'), node('d')],
      [
        { sourceNodeId: 'a', targetNodeId: 'b' },
        { sourceNodeId: 'b', targetNodeId: 'a' },
        { sourceNodeId: 'b', targetNodeId: 'c' },
        { sourceNodeId: 'c', targetNodeId: 'd' },
      ],
    );
    expect(positions).toHaveLength(4);
    // 环内两个节点属于同一强连通分量，会被竖向堆叠在同一层
    const a = positions.find((position) => position.id === 'a');
    const b = positions.find((position) => position.id === 'b');
    expect(a?.x).toBe(b?.x);
  });

  it('引用不存在节点的边被安全忽略', () => {
    const positions = runLayout(
      [node('a'), node('b')],
      [{ sourceNodeId: 'a', targetNodeId: 'ghost' }],
    );
    expect(positions).toHaveLength(2);
  });
});

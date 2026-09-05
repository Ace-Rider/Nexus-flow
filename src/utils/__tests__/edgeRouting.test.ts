import { describe, it, expect } from 'vitest';
import { routeEdges, type RouteNode } from '@/utils/edgeRouting';
import type { GraphEdge } from '@/types/flow';

// 构造节点几何的便捷函数：默认 100x80 的矩形节点
const node = (id: string, x: number, y: number, width = 100, height = 80): RouteNode => ({
  id,
  x,
  y,
  width,
  height,
});

const edge = (id: string, sourceNodeId: string, targetNodeId: string): GraphEdge => ({
  id,
  sourceNodeId,
  targetNodeId,
  type: 'polyline',
});

describe('routeEdges', () => {
  it('同高度单边：中间共线折点被清理，退化为首尾两点直线', () => {
    const result = routeEdges(
      [node('s', 100, 100), node('t', 400, 100)],
      [edge('e1', 's', 't')],
    );

    const geometry = result.get('e1')!;
    expect(geometry.pointsList).toHaveLength(2);
    // 起点在源节点右缘，终点在目标节点左缘
    expect(geometry.startPoint).toEqual({ x: 150, y: 100 });
    expect(geometry.endPoint).toEqual({ x: 350, y: 100 });
    expect(geometry.pointsList[0]).toEqual({ x: 150, y: 100 });
    expect(geometry.pointsList[1]).toEqual({ x: 350, y: 100 });
  });

  it('纵向走线：上下错开的节点生成 Z 形四点折线', () => {
    const result = routeEdges(
      [node('s', 100, 100), node('t', 140, 400)],
      [edge('e1', 's', 't')],
    );

    const geometry = result.get('e1')!;
    expect(geometry.pointsList).toHaveLength(4);
    // 从源下缘出发，到目标上缘结束
    expect(geometry.startPoint).toEqual({ x: 100, y: 140 });
    expect(geometry.endPoint).toEqual({ x: 140, y: 360 });
    // 中间水平段在两点垂直中点
    expect(geometry.pointsList[1]).toEqual({ x: 100, y: 250 });
    expect(geometry.pointsList[2]).toEqual({ x: 140, y: 250 });
  });

  it('一源三出边：按目标位置分层走 -42 / 0 / +42 的通道', () => {
    const result = routeEdges(
      [node('s', 100, 100), node('a', 400, 60), node('b', 400, 100), node('c', 400, 140)],
      [edge('toA', 's', 'a'), edge('toB', 's', 'b'), edge('toC', 's', 'c')],
    );

    // 目标越靠上，通道层越靠上，避免三条边挤在同一条水平线上
    expect(result.get('toA')!.pointsList.some((p) => p.y === 58)).toBe(true);
    expect(result.get('toB')!.pointsList.some((p) => p.y === 100)).toBe(true);
    expect(result.get('toC')!.pointsList.some((p) => p.y === 142)).toBe(true);
  });

  it('端点缺失的坏边会被跳过，不影响其他边', () => {
    const result = routeEdges(
      [node('s', 100, 100), node('t', 400, 100)],
      [edge('good', 's', 't'), edge('bad-source', 'ghost', 't'), edge('bad-target', 's', 'ghost')],
    );

    expect(result.has('good')).toBe(true);
    expect(result.has('bad-source')).toBe(false);
    expect(result.has('bad-target')).toBe(false);
    expect(result.size).toBe(1);
  });

  it('节点过近时强制拉开最小通道，折线仍有拐弯', () => {
    const result = routeEdges(
      [node('s', 100, 100), node('t', 190, 160)],
      [edge('e1', 's', 't')],
    );

    const geometry = result.get('e1')!;
    // 起终点仍贴着节点边缘
    expect(geometry.startPoint).toEqual({ x: 150, y: 100 });
    expect(geometry.endPoint).toEqual({ x: 140, y: 160 });
    // 强拉后保留一段垂直通道（mergeX=163 处上下两个折点）
    expect(geometry.pointsList.some((p) => p.x === 163 && p.y === 100)).toBe(true);
    expect(geometry.pointsList.some((p) => p.x === 163 && p.y === 160)).toBe(true);
    expect(geometry.pointsList.length).toBeGreaterThanOrEqual(4);
  });

  it('反向边（目标在源左侧）：方向翻转，起点在源左缘', () => {
    const result = routeEdges(
      [node('s', 400, 100), node('t', 100, 100)],
      [edge('e1', 's', 't')],
    );

    const geometry = result.get('e1')!;
    expect(geometry.startPoint).toEqual({ x: 350, y: 100 });
    expect(geometry.endPoint).toEqual({ x: 150, y: 100 });
    expect(geometry.pointsList[0].x).toBeGreaterThan(geometry.pointsList.at(-1)!.x);
  });
});

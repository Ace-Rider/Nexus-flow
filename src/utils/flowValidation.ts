import type { GraphData, GraphNode } from '@/types/flow';

// 一条校验问题的描述：key 用于列表渲染，focusId 用于点击后定位画布元素
export type ValidationIssue = {
  key: string;
  title: string;
  message: string;
  focusId?: string;
};

// 校验报错时优先展示节点文本，没有文本再退回节点 id，提示会更友好
const getNodeLabel = (node: GraphNode) => {
  if (typeof node.text === 'string') return node.text;
  if (node.text && typeof node.text === 'object' && typeof node.text.value === 'string') {
    return node.text.value;
  }
  return node.id;
};

// 这里主要检查：空流程、坏连线、缺少起点/终点、孤立节点、整图不连通
export const validateFlowData = (data: GraphData) => {
  const issues: ValidationIssue[] = [];
  const { nodes, edges } = data;

  if (nodes.length === 0) {
    issues.push({
      key: 'empty-flow',
      title: '空流程',
      message: '当前流程没有任何节点，至少需要一个节点',
    });
    return { valid: false, issues };
  }

  const pushIssue = (title: string, message: string, focusId?: string) => {
    issues.push({
      key: `${title}-${issues.length}-${focusId || 'global'}`,
      title,
      message,
      focusId,
    });
  };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inDegree = new Map(nodes.map((node) => [node.id, 0]));
  const outDegree = new Map(nodes.map((node) => [node.id, 0]));
  // 连通性校验时把图看成“无向图”，只关心是否连成一片
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));

  edges.forEach((edge) => {
    const sourceExists = nodeMap.has(edge.sourceNodeId);
    const targetExists = nodeMap.has(edge.targetNodeId);

    if (!sourceExists || !targetExists) {
      pushIssue('坏连线', `连线 ${edge.id} 连接了不存在的节点，请重新检查该连线`, edge.id);
      return;
    }

    // source -> target 这条边会让 source 出度 +1、target 入度 +1
    outDegree.set(edge.sourceNodeId, (outDegree.get(edge.sourceNodeId) || 0) + 1);
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) || 0) + 1);
    // 双向写入邻接表，后面 BFS 才能检查“是不是一整块图”
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  });

  // 找到起点和终点
  const startNodes = nodes.filter((node) => (inDegree.get(node.id) || 0) === 0);
  const endNodes = nodes.filter((node) => (outDegree.get(node.id) || 0) === 0);

  if (startNodes.length === 0) {
    pushIssue('缺少起点', '流程中没有起点节点，至少需要一个入度为 0 的节点');
  }

  if (endNodes.length === 0) {
    pushIssue('缺少终点', '流程中没有终点节点，至少需要一个出度为 0 的节点');
  }

  // 孤立节点
  const isolatedNodes = nodes.filter((node) => {
    const indegree = inDegree.get(node.id) || 0;
    const outdegree = outDegree.get(node.id) || 0;
    return nodes.length > 1 && indegree === 0 && outdegree === 0;
  });

  if (isolatedNodes.length > 0) {
    pushIssue(
      '孤立节点',
      `存在孤立节点：${isolatedNodes.map((node) => getNodeLabel(node)).join('、')}`,
      isolatedNodes[0]?.id,
    );
  }

  // 已访问节点集合
  const visited = new Set<string>();
  // 待访问队列
  const pending = [nodes[0].id];
  // 用索引指针代替 shift()，避免数组头部删除带来的 O(n^2) 开销
  let cursor = 0;

  // 从任意一个节点出发做 BFS，看看最终能覆盖多少节点
  while (cursor < pending.length) {
    const currentId = pending[cursor];
    cursor += 1;
    if (!currentId || visited.has(currentId)) continue;

    // 当前节点没有访问过就加入已访问队列
    visited.add(currentId);
    // 将当前节点的所有未访问过的邻居节点加入待访问队列
    adjacency.get(currentId)?.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        pending.push(neighborId);
      }
    });
  }

  // 将未被访问到的孤立节点找出来
  if (visited.size !== nodes.length) {
    const disconnectedNodes = nodes
      .filter((node) => !visited.has(node.id))
      .map((node) => getNodeLabel(node));
    pushIssue(
      '图不连通',
      `流程图不是连通的，未连接到主流程的节点有：${disconnectedNodes.join('、')}`,
      nodes.find((node) => !visited.has(node.id))?.id,
    );
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

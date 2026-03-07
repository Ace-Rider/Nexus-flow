// 共享的流程图节点类型：
// 除了 LogicFlow 自带的基础字段，也预留了 properties 用于扩展业务属性。
export type GraphNode = {
  id: string;
  type?: string;
  x: number;
  y: number;
  text?: string | { value?: string };
  properties?: Record<string, any>;
  [key: string]: any;
};

// 共享的流程图边类型：
// 边和节点一样，也允许在 properties 里挂自定义业务字段。
export type GraphEdge = {
  id: string;
  type?: string;
  sourceNodeId: string;
  targetNodeId: string;
  text?: string | { value?: string };
  properties?: Record<string, any>;
  [key: string]: any;
};

// LogicFlow 对外导出的整张图数据结构。
export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// 属性面板当前选中的元素类型：
// 既要区分节点/边，也要兼顾多选和未选中的状态。
export type SelectedElement =
  | { kind: 'node'; data: GraphNode }
  | { kind: 'edge'; data: GraphEdge }
  | { kind: 'multiple'; data: GraphData }
  | null;

// 右侧属性面板使用的表单结构。
export type PropertyForm = {
  text: string;
  assignee: string;
  description: string;
  condition: string;
  priority: number;
  timeoutMinutes: number;
  remark: string;
};

// 流程版本管理使用的版本记录：
// 既保留版本快照，也保留节点/边数量，方便在历史里快速看出差异。
export type FlowVersionRecord = {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  data: GraphData;
};

// 版本保存时使用的表单字段。
export type FlowVersionForm = {
  name: string;
  note: string;
};

// 工作台里的流程卡片信息，用于流程切换和最近访问。
export type WorkspaceFlowRecord = {
  id: string;
  name: string;
  updatedAt: string;
};

// 复制/粘贴时使用的剪贴板数据：
// 只保留当前选中的节点和边，并记录相对位移，方便粘贴时整体平移。
export type FlowClipboardData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  anchor: {
    x: number;
    y: number;
  };
};

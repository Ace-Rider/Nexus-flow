import { computeLayout, type LayoutEdge, type LayoutNode } from '@/utils/layout';

// Web Worker 入口：只做消息协议的包装，真正的布局计算在 @/utils/layout 的纯函数里。
// 主线程通过 postMessage 发来 { type: 'LAYOUT', data: { nodes, edges, width, height } }，
// 这里算完后回传 { type: 'LAYOUT_RESULT', data: NodePosition[] }。

type LayoutMessage = {
  type: string;
  data?: {
    nodes?: LayoutNode[];
    edges?: LayoutEdge[];
    width?: number;
    height?: number;
  };
};

// Worker 里的 self 在生产环境是 DedicatedWorkerGlobalScope，在单测里是 stub，
// 收敛成最小结构类型，避免依赖具体 lib 定义
type WorkerSelf = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<LayoutMessage>) => void,
  ): void;
  postMessage(message: unknown): void;
};

const workerSelf = self as unknown as WorkerSelf;

workerSelf.addEventListener('message', (event) => {
  const { type, data } = event.data;
  // 只处理布局任务，其他消息直接忽略
  if (type !== 'LAYOUT') return;

  // 参数缺省值与旧版 worker.js 保持一致，主线程漏传时也能算出结果
  const { nodes = [], edges = [], width = 1200, height = 800 } = data || {};
  const positions = computeLayout(nodes, edges, width, height);

  workerSelf.postMessage({ type: 'LAYOUT_RESULT', data: positions });
});

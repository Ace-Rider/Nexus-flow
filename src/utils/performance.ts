import LayoutWorker from '@/workers/layoutWorker?worker';
import type { LayoutEdge, LayoutNode, NodePosition } from '@/utils/layout';

// 同步测量一个函数执行耗时，适合包裹轻量逻辑。
// 这里不会开启异步计时，只会统计 callback 这一小段同步代码跑了多久。
export const measureLatency = (callback: () => void): number => {
  const start = performance.now();
  callback();
  const end = performance.now();
  return end - start;
};

// 将布局计算丢给 Web Worker，避免节点较多时阻塞主线程。
// 返回 Promise，是因为 Worker 的结果要等它异步回传。
export const runLayoutInWorker = (
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number
): Promise<NodePosition[]> => {
  return new Promise((resolve, reject) => {
    // 通过 ?worker 导入拿到 Worker 构造器：Vite 会把 layoutWorker.ts（连同 dagre）
    // 打包成独立产物，开发与构建行为一致，不再依赖 public 目录的静态文件。
    const worker = new LayoutWorker();

    // 把布局输入数据发给 Worker，让它在后台线程计算新坐标。
    // type 用来标识这是一条“布局任务”消息，data 里才是真正的任务参数。
    worker.postMessage({ type: 'LAYOUT', data: { nodes, edges, width, height } });

    worker.onmessage = (event: MessageEvent<{ type: string; data: NodePosition[] }>) => {
      if (event.data.type === 'LAYOUT_RESULT') {
        // 收到布局结果后，返回给调用方，并销毁 Worker 释放资源。
        // resolve(...) 之后，外面的 await runLayoutInWorker(...) 就能拿到新坐标数组。
        resolve(event.data.data);
        worker.terminate();
      }
    };

    worker.onerror = (error) => {
      // Worker 内部报错时，向外抛出错误，并及时结束线程。
      // reject(...) 之后，调用方可以在 catch 中统一处理布局失败。
      reject(error);
      worker.terminate();
    };
  });
};

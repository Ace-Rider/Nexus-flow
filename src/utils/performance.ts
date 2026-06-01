// 同步测量一个函数执行耗时，适合包裹轻量逻辑。
// 这里不会开启异步计时，只会统计 callback 这一小段同步代码跑了多久。
export const measureLatency = (callback: () => void): number => {
  const start = performance.now();
  callback();
  const end = performance.now();
  return end - start;
};

// Worker 端布局节点的最小结构。
type WorkerLayoutNode = {
  id: string;
  [key: string]: any;
};

// Worker 端布局边只关心起点和终点关系。
type WorkerLayoutEdge = {
  sourceNodeId: string;
  targetNodeId: string;
};

// Worker 返回的布局结果：每个节点的新坐标。
type WorkerLayoutPosition = {
  id: string;
  x: number;
  y: number;
};

// 将布局计算丢给 Web Worker，避免节点较多时阻塞主线程。
// 返回 Promise，是因为 Worker 的结果要等它异步回传。
export const runLayoutInWorker = (
  nodes: WorkerLayoutNode[],
  edges: WorkerLayoutEdge[],
  width: number,
  height: number
): Promise<WorkerLayoutPosition[]> => {
  return new Promise((resolve, reject) => {
    // worker.js 位于 public 目录，构建后会作为静态资源直接提供。
    const worker = new Worker('/worker.js');

    // 把布局输入数据发给 Worker，让它在后台线程计算新坐标。
    // type 用来标识这是一条“布局任务”消息，data 里才是真正的任务参数。
    worker.postMessage({ type: 'LAYOUT', data: { nodes, edges, width, height } });

    worker.onmessage = (event: MessageEvent<{ type: string; data: WorkerLayoutPosition[] }>) => {
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

// Web Worker 入口
// 主线程会通过 postMessage 把布局任务发到这里
self.addEventListener("message", (e) => {
  // 取出主线程发来的消息类型和数据
  const { type, data } = e.data;

  // 这里只处理布局任务，其他消息直接忽略
  if (type !== "LAYOUT") {
    return;
  }

  // 给布局参数设置默认值，避免主线程漏传时直接报错
  const { nodes = [], edges = [], width = 1200, height = 800 } = data;

  // 没有节点时，直接返回空结果
  if (!nodes.length) {
    self.postMessage({ type: "LAYOUT_RESULT", data: [] });
    return;
  }

  // 这些常量控制布局的留白、层间距、节点间距
  const marginX = 140;
  const marginY = 100;
  const layerGap = 170;
  const componentGap = 80;
  const nodeGap = 48;

  // 反复扫几轮，让节点顺序更稳定、更接近连线关系
  const sweepCount = 4;

  // 把数值限制在范围内，避免布局结果跑出画布
  const clamp = (value, min, max) => {
    // 如果min > max，说明范围不合法，直接返回原值，不做限制
    if (min > max) return value;
    // 如果value大于min，小于max，就返回value
    // 如果value小于min，就返回min
    // 如果value大于max，就返回max
    // 先卡上限，再卡下限，保证结果在[min, max]范围内
    return Math.max(min, Math.min(value, max));
  };

  // 计算一组数的平均值，用于后面求“邻居的平均位置”
  const average = (values) => {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  // 统一节点结构，补齐 width / height 的默认值
  const normalizeNode = (node) => {
    return {
      ...node,
      width: Math.max(node.width || 100, 80),
      height: Math.max(node.height || 80, 60),
    };
  };

  // 标准化后的节点数组，后续布局都以它为准
  const normalizedNodes = nodes.map(normalizeNode);

  // 便于通过 id 快速找到节点
  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));

  // 节点 id 集合，用于过滤非法边
  const nodeIds = new Set(normalizedNodes.map((node) => node.id));

  // 记录原始顺序，作为后续排序的兜底参考
  const nodeOrder = new Map(
    normalizedNodes.map((node, index) => [node.id, index]),
  );

  // 记录节点原始位置，帮助排序时尽量保留用户已有的视觉顺序
  const nodePosition = new Map(
    normalizedNodes.map((node) => [
      node.id,
      { x: node.x || 0, y: node.y || 0 },
    ]),
  );

  // 只保留起点、终点都存在的边，并过滤自环
  const validEdges = edges.filter((edge) => {
    return (
      nodeIds.has(edge.sourceNodeId) &&
      nodeIds.has(edge.targetNodeId) &&
      edge.sourceNodeId !== edge.targetNodeId
    );
  });

  // 如果没有可用连线，就退化成网格布局
  const buildGridLayout = () => {
    // 计算网格列数和行数，让节点尽量均匀铺开
    const cols = Math.ceil(Math.sqrt(normalizedNodes.length));
    const rows = Math.ceil(normalizedNodes.length / cols);

    // 找到最大节点尺寸，保证网格间距足够
    const maxNodeWidth = Math.max(
      ...normalizedNodes.map((node) => node.width),
      100,
    );
    const maxNodeHeight = Math.max(
      ...normalizedNodes.map((node) => node.height),
      80,
    );
    // 两个邻接节点中心的距离
    const colGap = maxNodeWidth + layerGap;
    const rowGap = maxNodeHeight + componentGap;
    // 第一列节点的中心与最后一列节点的中心直接的总跨度
    const contentWidth = Math.max((cols - 1) * colGap, 0);
    // 第一行节点的中心与最后一行节点的中心直接的总跨度
    const contentHeight = Math.max((rows - 1) * rowGap, 0);

    // 把网格整体居中到画布里
    const startX = clamp(
      (width - contentWidth) / 2,
      marginX,
      Math.max(marginX, width - marginX),
    );
    const startY = clamp(
      (height - contentHeight) / 2,
      marginY,
      Math.max(marginY, height - marginY),
    );

    return normalizedNodes.map((node, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      return {
        id: node.id,
        x: clamp(startX + col * colGap, marginX, width - marginX),
        y: clamp(startY + row * rowGap, marginY, height - marginY),
      };
    });
  };

  // 没有边时，直接使用网格布局返回
  if (!validEdges.length) {
    self.postMessage({ type: "LAYOUT_RESULT", data: buildGridLayout() });
    return;
  }

  // outgoing / incoming 用来快速查节点的出边和入边
  const outgoing = new Map(normalizedNodes.map((node) => [node.id, []]));
  const incoming = new Map(normalizedNodes.map((node) => [node.id, []]));

  validEdges.forEach((edge) => {
    // 边的起始节点的键对应的值数组存放着这个起始节点所能连接到的终止节点的id
    outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
    // 边的终止节点的键对应的值数组存放着这个终止节点所能连接到的起始节点的id
    incoming.get(edge.targetNodeId).push(edge.sourceNodeId);
  });

  // Tarjan 算法相关状态，用来把有环图拆成强连通分量

  let tarjanIndex = 0; // 当前访问到第几个节点的编号
  const nodeIndex = new Map(); // 记录“每个节点第一次被访问时的编号”
  const lowLink = new Map(); // 记录“这个节点能回到的最小编号”
  const stack = []; // DFS 过程中用的栈，用来暂存当前还没确认归属的节点
  const inStack = new Set(); // 记录某个节点是否还在栈里
  const stronglyConnectedComponents = []; // 最终找到的强连通分量结果数组

  // 深度优先搜索，找出每个强连通分量
  const strongConnect = (nodeId) => {
    nodeIndex.set(nodeId, tarjanIndex);
    lowLink.set(nodeId, tarjanIndex);
    tarjanIndex += 1;
    stack.push(nodeId);
    inStack.add(nodeId);

    (outgoing.get(nodeId) || []).forEach((nextNodeId) => {
      if (!nodeIndex.has(nextNodeId)) {
        strongConnect(nextNodeId);
        // 刷新当前节点所能达到的最小编号
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId), lowLink.get(nextNodeId)),
        );
        return;
      }

      if (inStack.has(nextNodeId)) {
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId), nodeIndex.get(nextNodeId)),
        );
      }
    });

    // 如果 lowLink 和 index 相等，说明找到了一个分量的根
    if (lowLink.get(nodeId) !== nodeIndex.get(nodeId)) {
      return;
    }

    const componentNodes = [];
    while (stack.length) {
      const currentId = stack.pop();
      inStack.delete(currentId);
      componentNodes.push(currentId);
      if (currentId === nodeId) break;
    }

    stronglyConnectedComponents.push(componentNodes);
  };

  // 从每个节点出发，补齐所有强连通分量
  normalizedNodes.forEach((node) => {
    if (!nodeIndex.has(node.id)) {
      strongConnect(node.id);
    }
  });

  // nodeToComponent：节点 -> 分量
  // componentById：分量 -> 分量对象
  const nodeToComponent = new Map();
  const componentById = new Map();

  stronglyConnectedComponents.forEach((componentNodes, componentId) => {
    // 同一个分量内部，也按原始位置排一下序，减少布局跳动
    const sortedNodes = componentNodes.slice().sort((a, b) => {
      const aPos = nodePosition.get(a);
      const bPos = nodePosition.get(b);
      // 靠近上边的排在前面
      if (aPos && bPos && aPos.y !== bPos.y) return aPos.y - bPos.y;
      // 索引号靠前的排在前面
      return (nodeOrder.get(a) || 0) - (nodeOrder.get(b) || 0);
    });

    const component = {
      id: componentId,
      nodes: sortedNodes,
      incoming: new Set(),
      outgoing: new Set(),
    };

    sortedNodes.forEach((nodeId) => {
      // 设置当前节点所属的强连通分量
      nodeToComponent.set(nodeId, componentId);
    });
    // 设置当前强连通分量包含哪些节点
    componentById.set(componentId, component);
  });

  // 把边挂到“分量”层级上，后续就不是按节点排，而是按分量排
  // 将每个强连通分量当作一个大节点，收集进入当前分量的其他分量的分量id，还收集从当前分量出发到其他分量的id
  validEdges.forEach((edge) => {
    // 获取起始节点和终止节点对应的分量
    const sourceComponentId = nodeToComponent.get(edge.sourceNodeId);
    const targetComponentId = nodeToComponent.get(edge.targetNodeId);
    if (sourceComponentId === targetComponentId) {
      return;
    }

    componentById.get(sourceComponentId).outgoing.add(targetComponentId);
    componentById.get(targetComponentId).incoming.add(sourceComponentId);
  });

  // 先给每个分量分层，再在层内排序
  const components = Array.from(componentById.values());
  const componentLayer = new Map(
    components.map((component) => [component.id, 0]),
  );
  // 收集每个分量的入度
  const componentIndegree = new Map(
    components.map((component) => [component.id, component.incoming.size]),
  );

  // 先从入度为 0 的分量开始处理
  const queue = components
    .filter((component) => component.incoming.size === 0)
    .sort((a, b) => {
      const aNode = a.nodes[0];
      const bNode = b.nodes[0];
      const aPos = nodePosition.get(aNode);
      const bPos = nodePosition.get(bNode);
      if (aPos && bPos && aPos.x !== bPos.x) return aPos.x - bPos.x;
      return (nodeOrder.get(aNode) || 0) - (nodeOrder.get(bNode) || 0);
    })
    // 返回入度为0的分量的id数组
    .map((component) => component.id);

  // 如果整张图有环，可能没有入度为 0 的分量，就挑一个最像起点的
  if (!queue.length) {
    components
      .slice()
      .sort((a, b) => {
        const scoreA = a.outgoing.size - a.incoming.size;
        const scoreB = b.outgoing.size - b.incoming.size;
        // 分量的出边相对更多的排前面
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (
          (nodeOrder.get(a.nodes[0]) || 0) - (nodeOrder.get(b.nodes[0]) || 0)
        );
      })
      .slice(0, 1)
      // 把最像起点的分量的id压进队列
      .forEach((component) => queue.push(component.id));
  }

  // 拓扑式地把分量往后推进，算出每个分量所在层级
  while (queue.length) {
    const componentId = queue.shift();
    const component = componentById.get(componentId);
    if (!component) continue;

    // 当前分量所在的层级
    const currentLayer = componentLayer.get(componentId) || 0;

    // 计算出前驱分量对后继分量层级的影响，然后将后继分量的入度减去1，如果入度为0的话，就把后继分量的id压进队列
    component.outgoing.forEach((nextComponentId) => {
      // 计算当前分量的后继分量的层级
      componentLayer.set(
        nextComponentId,
        // 由于分量当前分量的后继分量可能还是其他分量的后继分量，所以需要取最大值，保证后继分量的层级比它的所有前驱分量的层级要大
        Math.max(componentLayer.get(nextComponentId) || 0, currentLayer + 1),
      );
      // 当前分量已经处理完了，后继分量的入度要减一
      componentIndegree.set(
        nextComponentId,
        (componentIndegree.get(nextComponentId) || 0) - 1,
      );
      // 后继分量的前驱分量都处理完了，就可以把它压进队列
      if ((componentIndegree.get(nextComponentId) || 0) <= 0) {
        queue.push(nextComponentId);
      }
    });
  }

  // 将分量按照不同的层级分组
  // layers是一个层级 -> 分量id数组 的映射，记录了每个层级有哪些分量
  const layers = new Map();
  components.forEach((component) => {
    const layer = componentLayer.get(component.id) || 0;
    if (!layers.has(layer)) {
      layers.set(layer, []);
    }
    layers.get(layer).push(component.id);
  });

  // 按照层级排序的数组
  const layerIndexes = Array.from(layers.keys()).sort((a, b) => a - b);
  const orderMaps = new Map();

  // 同一层内，尽量按原始位置排序，避免布局结果太跳
  const sortByOriginalPosition = (componentIds) => {
    componentIds.sort((a, b) => {
      // 比较两个分量的第一个节点的原始位置，靠近上边的排在前面
      const aNode = componentById.get(a).nodes[0];
      const bNode = componentById.get(b).nodes[0];
      const aPos = nodePosition.get(aNode);
      const bPos = nodePosition.get(bNode);
      if (aPos && bPos && aPos.y !== bPos.y) return aPos.y - bPos.y;
      return (nodeOrder.get(aNode) || 0) - (nodeOrder.get(bNode) || 0);
    });
  };

  // 先初始化每层的顺序表
  layerIndexes.forEach((layer) => {
    // layer是层级数组里面的层级数，componentIds是这个层级对应的强连通分量数组，每个元素都是一个分量id
    const componentIds = layers.get(layer);
    sortByOriginalPosition(componentIds);
    // 设置了一个键值对，值是一个键值对集合，这个键值对集合记录了在当前层layer里面强连通分量的id(componentIds[index])和它在该层顺序中的索引号(index)的对应关系
    orderMaps.set(
      layer,
      new Map(componentIds.map((componentId, index) => [componentId, index])),
    );
  });

  // 当前分量的前驱分量，只保留更靠前的层
  const getPrevNeighbors = (componentId) => {
    // 获得传入分量id对应的分量的前驱分量的id集合
    return Array.from(componentById.get(componentId).incoming).filter(
      (prevId) => {
        return (
          (componentLayer.get(prevId) || 0) <
          (componentLayer.get(componentId) || 0)
        );
      },
    );
  };

  // 当前分量的后继分量，只保留更靠后的层
  const getNextNeighbors = (componentId) => {
    return Array.from(componentById.get(componentId).outgoing).filter(
      (nextId) => {
        return (
          (componentLayer.get(nextId) || 0) >
          (componentLayer.get(componentId) || 0)
        );
      },
    );
  };

  // 多轮上下扫描，尽量让相连分量的顺序更一致
  for (let sweep = 0; sweep < sweepCount; sweep += 1) {
    // 正向扫描：根据前驱位置调整当前层顺序
    for (let index = 1; index < layerIndexes.length; index += 1) {
      const layer = layerIndexes[index];
      // 当前层级的分量id数组
      const componentIds = layers.get(layer);
      // 记录当前层级的分量id数组的初始顺序
      const fallbackOrder = new Map(
        componentIds.map((componentId, order) => [componentId, order]),
      );

      componentIds.sort((a, b) => {
        // 分别获取两个不同分量的前驱分量的id数组
        const prevA = getPrevNeighbors(a);
        const prevB = getPrevNeighbors(b);
        const scoreA = prevA.length
          ? average(
              prevA.map(
                (componentId) =>
                  // 获取当前分量id所在的层级对应的orderMaps的键值对中映射的值中所在的序号
                  orderMaps
                    .get(componentLayer.get(componentId) || 0)
                    .get(componentId) || 0,
              ),
            )
          : fallbackOrder.get(a) || 0;
        const scoreB = prevB.length
          ? average(
              prevB.map(
                (componentId) =>
                  orderMaps
                    .get(componentLayer.get(componentId) || 0)
                    .get(componentId) || 0,
              ),
            )
          : fallbackOrder.get(b) || 0;
        // 分数小的排前面，顺序号越小，说明越靠上
        if (scoreA !== scoreB) return scoreA - scoreB;
        return (fallbackOrder.get(a) || 0) - (fallbackOrder.get(b) || 0);
      });

      orderMaps.set(
        layer,
        new Map(componentIds.map((componentId, order) => [componentId, order])),
      );
    }

    // 反向扫描：根据后继位置再修正一遍
    for (let index = layerIndexes.length - 2; index >= 0; index -= 1) {
      const layer = layerIndexes[index];
      // 获取当前层级对应的分量id数组
      const componentIds = layers.get(layer);
      const fallbackOrder = new Map(
        componentIds.map((componentId, order) => [componentId, order]),
      );

      componentIds.sort((a, b) => {
        // 分别获取两个不同分量的后继分量的id数组
        const nextA = getNextNeighbors(a);
        const nextB = getNextNeighbors(b);
        const scoreA = nextA.length
          ? average(
              nextA.map(
                (componentId) =>
                  orderMaps
                    .get(componentLayer.get(componentId) || 0)
                    .get(componentId) || 0,
              ),
            )
          : fallbackOrder.get(a) || 0;
        const scoreB = nextB.length
          ? average(
              nextB.map(
                (componentId) =>
                  orderMaps
                    .get(componentLayer.get(componentId) || 0)
                    .get(componentId) || 0,
              ),
            )
          : fallbackOrder.get(b) || 0;
        // 分数小的排前面，顺序号越小，说明越靠上
        if (scoreA !== scoreB) return scoreA - scoreB;
        return (fallbackOrder.get(a) || 0) - (fallbackOrder.get(b) || 0);
      });

      orderMaps.set(
        layer,
        new Map(componentIds.map((componentId, order) => [componentId, order])),
      );
    }
  }

  // 统计每个分量的宽高，方便后面整体排布
  const getComponentMetrics = (componentId) => {
    const component = componentById.get(componentId);
    const componentNodes = component.nodes.map((nodeId) =>
      nodeById.get(nodeId),
    );
    // 计算分量宽度，取决于分量内最宽的节点，保证每个节点都能放得下
    const componentWidth = Math.max(
      ...componentNodes.map((node) => node.width),
      100,
    );
    // 计算将某个分量的所有节点竖向堆叠起来的高度
    const componentHeight = componentNodes.reduce((sum, node, index) => {
      // 节点间的竖向间隔
      const gap = index === 0 ? 0 : nodeGap;
      return sum + gap + node.height;
    }, 0);

    return {
      width: componentWidth,
      height: componentHeight,
    };
  };

  // 计算每一层需要的最大宽度
  const layerWidths = layerIndexes.map((layer) => {
    return Math.max(
      ...layers
        .get(layer)
        .map((componentId) => getComponentMetrics(componentId).width),
      100,
    );
  });

  // 所有层加起来的总宽度，用来居中整张图
  const totalWidth =
    layerWidths.reduce((sum, value) => sum + value, 0) +
    Math.max(layerWidths.length - 1, 0) * layerGap; //每层之间的水平间隔之和

  // 从左往右给每一层分配中心点
  // 左边距
  let currentLeft = clamp(
    (width - totalWidth) / 2,
    marginX,
    Math.max(marginX, width - marginX),
  );

  const layerCenters = new Map();
  layerIndexes.forEach((layer, index) => {
    // 获取当前层级对应的最大宽度
    const layerWidth = layerWidths[index];
    // 设置当前键值对，间是层数，值是当前层的中心x坐标
    layerCenters.set(layer, currentLeft + layerWidth / 2);
    // 获取下一层的左边距
    currentLeft += layerWidth + layerGap;
  });

  // 计算每一层的总高度，用来做垂直居中
  const layerHeights = layerIndexes.map((layer) => {
    return layers.get(layer).reduce((sum, componentId, index) => {
      const gap = index === 0 ? 0 : componentGap;
      return sum + gap + getComponentMetrics(componentId).height;
    }, 0);
  });

  const maxLayerHeight = Math.max(...layerHeights, 0);
  const topStart = clamp(
    (height - maxLayerHeight) / 2,
    marginY,
    Math.max(marginY, height - marginY),
  );

  // 最终输出的节点坐标结果
  const positions = [];

  // 遍历层级
  layerIndexes.forEach((layer, layerIndex) => {
    const componentIds = layers.get(layer);
    const totalLayerHeight = layerHeights[layerIndex];
    // 垂直居中
    let componentTop = topStart + (maxLayerHeight - totalLayerHeight) / 2;
    const layerX = clamp(layerCenters.get(layer), marginX, width - marginX);

    // 遍历层级内的分量
    componentIds.forEach((componentId) => {
      const component = componentById.get(componentId);
      let cursorY = componentTop;

      // 遍历分量内的节点
      // 同一个分量内部，节点按竖向堆叠
      component.nodes.forEach((nodeId, nodeIndexInComponent) => {
        const node = nodeById.get(nodeId);
        const y = cursorY + node.height / 2;

        positions.push({
          id: nodeId,
          x: layerX,
          y: clamp(y, marginY, Math.max(marginY, height - marginY)),
        });

        cursorY += node.height;
        if (nodeIndexInComponent < component.nodes.length - 1) {
          cursorY += nodeGap;
        }
      });

      // 下一个分量从当前分量的下方继续排
      componentTop = cursorY + componentGap;
    });
  });

  // 把最终结果发回主线程
  self.postMessage({
    type: "LAYOUT_RESULT",
    data: positions.length ? positions : buildGridLayout(),
  });
});

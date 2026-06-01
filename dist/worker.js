// public/worker.js
// Web Worker: handle layout calculation off the main thread.
self.addEventListener('message', (e) => {
    const { type, data } = e.data;
    if (type !== 'LAYOUT') {
        return;
    }

    const { nodes = [], edges = [], width = 1200, height = 800 } = data;
    if (!nodes.length) {
        self.postMessage({ type: 'LAYOUT_RESULT', data: [] });
        return;
    }

    const marginX = 140;
    const marginY = 100;
    const layerGap = 170;
    const componentGap = 80;
    const nodeGap = 48;
    const sweepCount = 4;

    const clamp = (value, min, max) => {
        if (min > max) return value;
        return Math.max(min, Math.min(value, max));
    };

    const average = (values) => {
        if (!values.length) return 0;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    const normalizeNode = (node) => {
        return {
            ...node,
            width: Math.max(node.width || 100, 80),
            height: Math.max(node.height || 80, 60),
        };
    };

    const normalizedNodes = nodes.map(normalizeNode);
    const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
    const nodeIds = new Set(normalizedNodes.map((node) => node.id));
    const nodeOrder = new Map(normalizedNodes.map((node, index) => [node.id, index]));
    const nodePosition = new Map(normalizedNodes.map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }]));
    const validEdges = edges.filter((edge) => {
        return nodeIds.has(edge.sourceNodeId)
            && nodeIds.has(edge.targetNodeId)
            && edge.sourceNodeId !== edge.targetNodeId;
    });

    const buildGridLayout = () => {
        const cols = Math.ceil(Math.sqrt(normalizedNodes.length));
        const rows = Math.ceil(normalizedNodes.length / cols);
        const maxNodeWidth = Math.max(...normalizedNodes.map((node) => node.width), 100);
        const maxNodeHeight = Math.max(...normalizedNodes.map((node) => node.height), 80);
        const colGap = maxNodeWidth + layerGap;
        const rowGap = maxNodeHeight + componentGap;
        const contentWidth = Math.max((cols - 1) * colGap, 0);
        const contentHeight = Math.max((rows - 1) * rowGap, 0);
        const startX = clamp((width - contentWidth) / 2, marginX, Math.max(marginX, width - marginX));
        const startY = clamp((height - contentHeight) / 2, marginY, Math.max(marginY, height - marginY));

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

    if (!validEdges.length) {
        self.postMessage({ type: 'LAYOUT_RESULT', data: buildGridLayout() });
        return;
    }

    const outgoing = new Map(normalizedNodes.map((node) => [node.id, []]));
    const incoming = new Map(normalizedNodes.map((node) => [node.id, []]));

    validEdges.forEach((edge) => {
        outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
        incoming.get(edge.targetNodeId).push(edge.sourceNodeId);
    });

    let tarjanIndex = 0;
    const nodeIndex = new Map();
    const lowLink = new Map();
    const stack = [];
    const inStack = new Set();
    const stronglyConnectedComponents = [];

    const strongConnect = (nodeId) => {
        nodeIndex.set(nodeId, tarjanIndex);
        lowLink.set(nodeId, tarjanIndex);
        tarjanIndex += 1;
        stack.push(nodeId);
        inStack.add(nodeId);

        (outgoing.get(nodeId) || []).forEach((nextNodeId) => {
            if (!nodeIndex.has(nextNodeId)) {
                strongConnect(nextNodeId);
                lowLink.set(nodeId, Math.min(lowLink.get(nodeId), lowLink.get(nextNodeId)));
                return;
            }

            if (inStack.has(nextNodeId)) {
                lowLink.set(nodeId, Math.min(lowLink.get(nodeId), nodeIndex.get(nextNodeId)));
            }
        });

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

    normalizedNodes.forEach((node) => {
        if (!nodeIndex.has(node.id)) {
            strongConnect(node.id);
        }
    });

    const nodeToComponent = new Map();
    const componentById = new Map();

    stronglyConnectedComponents.forEach((componentNodes, componentId) => {
        const sortedNodes = componentNodes.slice().sort((a, b) => {
            const aPos = nodePosition.get(a);
            const bPos = nodePosition.get(b);
            if (aPos && bPos && aPos.y !== bPos.y) return aPos.y - bPos.y;
            return (nodeOrder.get(a) || 0) - (nodeOrder.get(b) || 0);
        });

        const component = {
            id: componentId,
            nodes: sortedNodes,
            incoming: new Set(),
            outgoing: new Set(),
        };

        sortedNodes.forEach((nodeId) => {
            nodeToComponent.set(nodeId, componentId);
        });
        componentById.set(componentId, component);
    });

    validEdges.forEach((edge) => {
        const sourceComponentId = nodeToComponent.get(edge.sourceNodeId);
        const targetComponentId = nodeToComponent.get(edge.targetNodeId);
        if (sourceComponentId === targetComponentId) {
            return;
        }

        componentById.get(sourceComponentId).outgoing.add(targetComponentId);
        componentById.get(targetComponentId).incoming.add(sourceComponentId);
    });

    const components = Array.from(componentById.values());
    const componentLayer = new Map(components.map((component) => [component.id, 0]));
    const componentIndegree = new Map(components.map((component) => [component.id, component.incoming.size]));
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
        .map((component) => component.id);

    if (!queue.length) {
        components
            .slice()
            .sort((a, b) => {
                const scoreA = a.outgoing.size - a.incoming.size;
                const scoreB = b.outgoing.size - b.incoming.size;
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (nodeOrder.get(a.nodes[0]) || 0) - (nodeOrder.get(b.nodes[0]) || 0);
            })
            .slice(0, 1)
            .forEach((component) => queue.push(component.id));
    }

    while (queue.length) {
        const componentId = queue.shift();
        const component = componentById.get(componentId);
        if (!component) continue;

        const currentLayer = componentLayer.get(componentId) || 0;
        component.outgoing.forEach((nextComponentId) => {
            componentLayer.set(
                nextComponentId,
                Math.max(componentLayer.get(nextComponentId) || 0, currentLayer + 1)
            );
            componentIndegree.set(nextComponentId, (componentIndegree.get(nextComponentId) || 0) - 1);
            if ((componentIndegree.get(nextComponentId) || 0) <= 0) {
                queue.push(nextComponentId);
            }
        });
    }

    const layers = new Map();
    components.forEach((component) => {
        const layer = componentLayer.get(component.id) || 0;
        if (!layers.has(layer)) {
            layers.set(layer, []);
        }
        layers.get(layer).push(component.id);
    });

    const layerIndexes = Array.from(layers.keys()).sort((a, b) => a - b);
    const orderMaps = new Map();

    const sortByOriginalPosition = (componentIds) => {
        componentIds.sort((a, b) => {
            const aNode = componentById.get(a).nodes[0];
            const bNode = componentById.get(b).nodes[0];
            const aPos = nodePosition.get(aNode);
            const bPos = nodePosition.get(bNode);
            if (aPos && bPos && aPos.y !== bPos.y) return aPos.y - bPos.y;
            return (nodeOrder.get(aNode) || 0) - (nodeOrder.get(bNode) || 0);
        });
    };

    layerIndexes.forEach((layer) => {
        const componentIds = layers.get(layer);
        sortByOriginalPosition(componentIds);
        orderMaps.set(layer, new Map(componentIds.map((componentId, index) => [componentId, index])));
    });

    const getPrevNeighbors = (componentId) => {
        return Array.from(componentById.get(componentId).incoming).filter((prevId) => {
            return (componentLayer.get(prevId) || 0) < (componentLayer.get(componentId) || 0);
        });
    };

    const getNextNeighbors = (componentId) => {
        return Array.from(componentById.get(componentId).outgoing).filter((nextId) => {
            return (componentLayer.get(nextId) || 0) > (componentLayer.get(componentId) || 0);
        });
    };

    for (let sweep = 0; sweep < sweepCount; sweep += 1) {
        for (let index = 1; index < layerIndexes.length; index += 1) {
            const layer = layerIndexes[index];
            const componentIds = layers.get(layer);
            const fallbackOrder = new Map(componentIds.map((componentId, order) => [componentId, order]));

            componentIds.sort((a, b) => {
                const prevA = getPrevNeighbors(a);
                const prevB = getPrevNeighbors(b);
                const scoreA = prevA.length
                    ? average(prevA.map((componentId) => orderMaps.get(componentLayer.get(componentId) || 0).get(componentId) || 0))
                    : fallbackOrder.get(a) || 0;
                const scoreB = prevB.length
                    ? average(prevB.map((componentId) => orderMaps.get(componentLayer.get(componentId) || 0).get(componentId) || 0))
                    : fallbackOrder.get(b) || 0;
                if (scoreA !== scoreB) return scoreA - scoreB;
                return (fallbackOrder.get(a) || 0) - (fallbackOrder.get(b) || 0);
            });

            orderMaps.set(layer, new Map(componentIds.map((componentId, order) => [componentId, order])));
        }

        for (let index = layerIndexes.length - 2; index >= 0; index -= 1) {
            const layer = layerIndexes[index];
            const componentIds = layers.get(layer);
            const fallbackOrder = new Map(componentIds.map((componentId, order) => [componentId, order]));

            componentIds.sort((a, b) => {
                const nextA = getNextNeighbors(a);
                const nextB = getNextNeighbors(b);
                const scoreA = nextA.length
                    ? average(nextA.map((componentId) => orderMaps.get(componentLayer.get(componentId) || 0).get(componentId) || 0))
                    : fallbackOrder.get(a) || 0;
                const scoreB = nextB.length
                    ? average(nextB.map((componentId) => orderMaps.get(componentLayer.get(componentId) || 0).get(componentId) || 0))
                    : fallbackOrder.get(b) || 0;
                if (scoreA !== scoreB) return scoreA - scoreB;
                return (fallbackOrder.get(a) || 0) - (fallbackOrder.get(b) || 0);
            });

            orderMaps.set(layer, new Map(componentIds.map((componentId, order) => [componentId, order])));
        }
    }

    const getComponentMetrics = (componentId) => {
        const component = componentById.get(componentId);
        const componentNodes = component.nodes.map((nodeId) => nodeById.get(nodeId));
        const componentWidth = Math.max(...componentNodes.map((node) => node.width), 100);
        const componentHeight = componentNodes.reduce((sum, node, index) => {
            const gap = index === 0 ? 0 : nodeGap;
            return sum + gap + node.height;
        }, 0);

        return {
            width: componentWidth,
            height: componentHeight,
        };
    };

    const layerWidths = layerIndexes.map((layer) => {
        return Math.max(
            ...layers.get(layer).map((componentId) => getComponentMetrics(componentId).width),
            100
        );
    });

    const totalWidth = layerWidths.reduce((sum, value) => sum + value, 0)
        + Math.max(layerWidths.length - 1, 0) * layerGap;
    let currentLeft = clamp((width - totalWidth) / 2, marginX, Math.max(marginX, width - marginX));

    const layerCenters = new Map();
    layerIndexes.forEach((layer, index) => {
        const layerWidth = layerWidths[index];
        layerCenters.set(layer, currentLeft + layerWidth / 2);
        currentLeft += layerWidth + layerGap;
    });

    const layerHeights = layerIndexes.map((layer) => {
        return layers.get(layer).reduce((sum, componentId, index) => {
            const gap = index === 0 ? 0 : componentGap;
            return sum + gap + getComponentMetrics(componentId).height;
        }, 0);
    });

    const maxLayerHeight = Math.max(...layerHeights, 0);
    const topStart = clamp((height - maxLayerHeight) / 2, marginY, Math.max(marginY, height - marginY));
    const positions = [];

    layerIndexes.forEach((layer, layerIndex) => {
        const componentIds = layers.get(layer);
        const totalLayerHeight = layerHeights[layerIndex];
        let componentTop = topStart + (maxLayerHeight - totalLayerHeight) / 2;
        const layerX = clamp(layerCenters.get(layer), marginX, width - marginX);

        componentIds.forEach((componentId) => {
            const component = componentById.get(componentId);
            let cursorY = componentTop;

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

            componentTop = cursorY + componentGap;
        });
    });

    self.postMessage({ type: 'LAYOUT_RESULT', data: positions.length ? positions : buildGridLayout() });
});

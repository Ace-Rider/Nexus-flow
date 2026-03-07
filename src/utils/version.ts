import type { GraphData, FlowVersionRecord } from '@/types/flow';

const MAX_VERSION_COUNT = 20;

const getVersionStorageKey = (flowId: string) => `nexus-flow:versions:${flowId}`;

const cloneGraphData = (data: GraphData) => JSON.parse(JSON.stringify(data)) as GraphData;

const createVersionId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `version_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const countGraph = (data: GraphData) => ({
  nodeCount: data.nodes.length,
  edgeCount: data.edges.length,
});

export const readFlowVersions = (flowId: string): FlowVersionRecord[] => {
  const raw = localStorage.getItem(getVersionStorageKey(flowId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as FlowVersionRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    console.warn('Failed to parse flow versions', error);
    localStorage.removeItem(getVersionStorageKey(flowId));
    return [];
  }
};

const writeFlowVersions = (flowId: string, versions: FlowVersionRecord[]) => {
  try {
    localStorage.setItem(getVersionStorageKey(flowId), JSON.stringify(versions));
  } catch (error) {
    // 配额不足等写入失败要抛出去，让调用方提示用户，避免版本静默丢失
    console.warn('Failed to write flow versions', error);
    throw new Error('本地存储空间不足，版本保存失败，请先删除部分历史版本');
  }
};

export const saveFlowVersion = (
  flowId: string,
  payload: Pick<FlowVersionRecord, 'name' | 'note' | 'data'>,
) => {
  const versions = readFlowVersions(flowId);
  const summary = countGraph(payload.data);

  const nextVersions: FlowVersionRecord[] = [
    {
      id: createVersionId(),
      name: payload.name.trim() || '未命名版本',
      note: payload.note.trim(),
      createdAt: new Date().toISOString(),
      data: cloneGraphData(payload.data),
      ...summary,
    },
    ...versions,
  ].slice(0, MAX_VERSION_COUNT);

  writeFlowVersions(flowId, nextVersions);
  return nextVersions;
};

export const deleteFlowVersion = (flowId: string, versionId: string) => {
  const versions = readFlowVersions(flowId).filter((item) => item.id !== versionId);
  writeFlowVersions(flowId, versions);
  return versions;
};

export const getFlowVersionById = (flowId: string, versionId: string) =>
  readFlowVersions(flowId).find((item) => item.id === versionId) || null;

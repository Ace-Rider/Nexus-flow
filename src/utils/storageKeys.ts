// 全项目 localStorage 键名收口在这里：
// 之前各模块散落硬编码字符串，删除流程时还要靠注释“保持一致”维系，
// 现在统一从这里导入，改键名只动一处。
const NAMESPACE = 'nexus-flow';

// 本地草稿（useFlowDraft 读写）
export const draftStorageKey = (flowId: string) => `${NAMESPACE}:draft:${flowId}`;

// 版本记录（utils/version 读写）
export const versionsStorageKey = (flowId: string) => `${NAMESPACE}:versions:${flowId}`;

// 每日自动备份的日期标记（Designer.vue 记录）
export const backupDateStorageKey = (flowId: string) => `${NAMESPACE}:last-backup:${flowId}`;

// 工作台流程列表（useWorkspaceFlows 读写）
export const workspaceStorageKey = () => `${NAMESPACE}:workspace:flows`;

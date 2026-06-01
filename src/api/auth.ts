// src/api/auth.ts
import request from './request';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export type GraphData = {
  nodes: any[];
  edges: any[];
};


// 登录
export async function login(username: string, password: string) {
  return request.post<LoginResponse>('/auth/login', { username, password });
}

// 刷新
export async function refreshToken(refreshTokenValue: string) {
  return request.post<{ accessToken: string }>('/auth/refresh', {
    refreshToken: refreshTokenValue,
  });
}

// 获取流程图数据
export async function fetchFlowData(flowId: string) {
  return request.get<GraphData>(`/flows/${flowId}`);
}


// 保存流程图数据
export async function saveFlowData(flowId: string, data: GraphData) {
  return request.post(`/flows/${flowId}`, data);
}

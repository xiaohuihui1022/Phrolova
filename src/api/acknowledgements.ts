import { api } from "./client";

export interface AcknowledgementItem {
  id: number;
  player_id: string;
  category: string;
  description: string;
  avatar: string | null;
  sort_order: number;
  created_at: string | null;
}

export interface AcknowledgementsResponse {
  status: string;
  list: AcknowledgementItem[];
}

/** 公开致谢列表（无需管理员身份） */
export function fetchAcknowledgements() {
  return api.get<AcknowledgementsResponse>("/acknowledgements") as Promise<AcknowledgementsResponse>;
}

/**
 * 管理员接口：不再接受 headers 参数，统一由请求拦截器根据 hasAdminHint() 注入 X-Admin-Token
 */
export function adminFetchAcknowledgements() {
  return api.get<AcknowledgementsResponse>("/admin/acknowledgements") as Promise<AcknowledgementsResponse>;
}

export function adminAddAcknowledgement(
  payload: { player_id: string; category: string; description: string; avatar?: string | null; sort_order: number },
) {
  return api.post<{ status: string; id: number }>("/admin/acknowledgements", payload) as Promise<{ status: string; id: number }>;
}

export function adminUpdateAcknowledgement(
  id: number,
  payload: Partial<{ player_id: string; category: string; description: string; avatar: string | null; sort_order: number }>,
) {
  return api.put<{ status: string }>(`/admin/acknowledgements/${id}`, payload) as Promise<{ status: string }>;
}

export function adminDeleteAcknowledgement(id: number) {
  return api.delete<{ status: string }>(`/admin/acknowledgements/${id}`) as Promise<{ status: string }>;
}

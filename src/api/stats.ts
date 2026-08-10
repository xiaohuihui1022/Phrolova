import { api } from "./client";

export interface OnlineStatsResponse {
  status: string;
  online_count: number;
  updated_at: number;
  degraded?: boolean;
}

export function fetchOnlineStats() {
  return api.get<OnlineStatsResponse>("/stats/online") as Promise<OnlineStatsResponse>;
}

export function sendHeartbeat(clientId: string) {
  return api.post<unknown>("/stats/heartbeat", { client_id: clientId }) as Promise<unknown>;
}

export interface PoolStatsResponse {
  status: string;
  waiting: number;
  in_match: number;
  total: number;
  degraded?: boolean;
}

export function fetchPoolStats() {
  return api.get<PoolStatsResponse>("/matchmaking/pool-stats") as Promise<PoolStatsResponse>;
}

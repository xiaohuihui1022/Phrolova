import type { LeaderboardResponse, QuizType } from "@/types/game";
import { api } from "./client";

export function fetchLeaderboard(playerId?: string, mode = "multi", quizType?: QuizType, page = 1, pageSize = 20) {
  const params: Record<string, string> = {};
  if (playerId) params.player_id = playerId;
  params.mode = mode;
  if (quizType) params.type = quizType;
  params.page = String(page);
  params.page_size = String(pageSize);
  return api.get<LeaderboardResponse>("/leaderboard", { params }) as Promise<LeaderboardResponse>;
}

export type QuizType = "resonator" | "skeleton" | "global";
export type Difficulty = "easy" | "hard";
export type CompareStatus = "match" | "near" | "different";
export type CellStatus = "match" | "partial" | "different";

export interface ResonatorRow {
  id: number;
  name: string;
  attribute: string;
  star_rating: number;
  weapon: string;
  birthplace: string;
  version: number;
}

export interface SkeletonRow {
  id: number;
  name: string;
  skill_attribute: string;
  cost: number;
  is_aberration: string;
  set_name: string;
  drop_location: string;
}

export interface ResonatorNameEntry {
  name: string;
  attribute: string;
  star_rating: number;
  weapon: string;
  birthplace: string;
  version: number;
}

export interface SkeletonNameEntry {
  name: string;
  skill_attribute: string;
  cost: number;
  is_aberration: string;
  set_name: string;
  drop_location: string;
}

export interface CompareAttrItem {
  attr: string;
  status: CompareStatus;
}

export interface CompareSetItem {
  set: string;
  status: CompareStatus;
  has_image: boolean;
  whiten: boolean;
}

export interface CompareLocationItem {
  loc: string;
  status: CompareStatus;
}

export interface CompareGroup<TItem> {
  cell: CellStatus;
  items: TItem[];
}

export interface SkeletonCompare {
  skill_attribute: CompareGroup<CompareAttrItem>;
  cost: CompareStatus;
  is_aberration: CompareStatus;
  set_name: CompareGroup<CompareSetItem>;
  drop_location: CompareGroup<CompareLocationItem>;
}

export interface ResonatorCompare {
  attribute: CompareStatus;
  star_rating: CompareStatus;
  weapon: CompareStatus;
  birthplace: CompareStatus;
  version: CompareStatus;
}

export interface GuessHistoryRow {
  revealed: boolean;
  guess: ResonatorRow | SkeletonRow | Record<string, string>;
  compare: ResonatorCompare | SkeletonCompare;
}

export interface ApiStatusResponse {
  status: "success" | "error";
  message?: string;
}

export interface AuthResponse extends ApiStatusResponse {
  player?: {
    id: number;
    player_id: string;
    score: number;
    wins: number;
    matches: number;
    single_resonator_score: number;
    single_skeleton_score: number;
  };
  token?: string;
}

export interface CaptchaResponse extends ApiStatusResponse {
  captcha_id?: string;
  image?: string;
}

export interface SingleDrawResponse extends ApiStatusResponse {
  type?: QuizType;
  character?: ResonatorRow | SkeletonRow;
}

export interface SingleGuessResponse extends ApiStatusResponse {
  type?: QuizType;
  guess?: ResonatorRow | SkeletonRow;
  compare?: ResonatorCompare | SkeletonCompare;
  score?: number | null;
  attempts?: number;
  limit?: number;
}

export interface LeaderboardRow {
  id?: number;
  player_id: string;
  score: number;
  sort_score?: number;
  single_resonator_score?: number;
  single_skeleton_score?: number;
  wins: number;
  matches: number;
  win_rate: number | null;
}

export interface LeaderboardResponse extends ApiStatusResponse {
  leaderboard: LeaderboardRow[];
  my_info: {
    player_id: string;
    score?: number;
    wins?: number;
    matches?: number;
    win_rate?: number;
    rank?: number;
    in_top: boolean;
  } | null;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface RoomPlayerView {
  playerId: string;
  dbId: number | null;
  roundWins: number;
  attemptsUsed: number;
  attemptsLimit: number;
  guesses: GuessHistoryRow[];
  isMe: boolean;
}

export interface MultiplayerRoomState {
  roomCode: string;
  quizType: QuizType;
  difficulty: Difficulty;
  bestOf: number;
  scoreDelta: number;
  roomStatus: "waiting" | "countdown" | "playing" | "finished";
  roundStatus: "idle" | "active" | "resolved";
  round: number;
  roundWinner: number | null;
  roundWins: number[];
  timeLeft: number;
  timeLimit: number;
  countdownLeft: number;
  target: ResonatorRow | SkeletonRow | null;
  targetVersion: number | null;
  targetCost: number | null;
  overallWinner: number | null;
  forfeitBy: string | null;
  creator: string;
  rematchVotes: string[];
  players: RoomPlayerView[];
  opponentId: string;
  roundHistory?: Array<{
    round: number;
    target: ResonatorRow | SkeletonRow | null;
    players: Array<{
      player_id: string;
      db_id: number | null;
      guesses: GuessHistoryRow[];
    }>;
  }>;
  // 游戏结束后已主动退出房间的玩家 ID（供前端判断对手是否已离开）
  exitedPlayers?: string[];
  // 游戏中断开连接、处于重连宽限期的玩家 ID（供前端显示"对手正在重连..."提示）
  reconnectingPlayers?: string[];
}

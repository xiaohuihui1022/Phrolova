export {
  fetchCaptcha,
  initPlayer,
  getPlayerScore,
  updatePlayerId,
  login,
  register,
  logout,
  fetchScryptParams,
  upgradePassword,
  refreshSession,
  me,
} from "./auth";
export type { LoginPayload, RegisterPayload, UpdatePlayerIdPayload, ScryptParams, UpgradePasswordPayload } from "./auth";

export {
  health,
  fetchResonatorNames,
  fetchSkeletonNames,
  drawTarget,
  submitGuess,
} from "./game";

export { fetchLeaderboard } from "./leaderboard";

export { fetchOnlineStats, sendHeartbeat } from "./stats";
export type { OnlineStatsResponse } from "./stats";

export {
  fetchAcknowledgements,
  adminFetchAcknowledgements,
  adminAddAcknowledgement,
  adminUpdateAcknowledgement,
  adminDeleteAcknowledgement,
} from "./acknowledgements";
export type { AcknowledgementItem, AcknowledgementsResponse } from "./acknowledgements";

export { C2S, S2C } from "./multiplayer";
export type {
  CreateRoomPayload,
  JoinRoomPayload,
  QueueJoinPayload,
  SubmitGuessPayload,
  LeaveRoomPayload,
  AuthedPayload,
  ErrorPayload,
  MatchingPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  CountdownStartedPayload,
  RoundStartedPayload,
  GuessResultPayload,
  RoundFinishedPayload,
  MatchFinishedPayload,
  OpponentForfeitPayload,
  MultiplayerRoomState,
} from "./multiplayer";

export { ApiError, requestJson, apiPath } from "./http";

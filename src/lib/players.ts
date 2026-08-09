// 玩家数据库操作函数 — 迁移自 Python players.py
import { eq } from 'drizzle-orm';
import type { Database, Player, NewPlayerTarget, PlayerTarget } from './db';
import { players, playerTargets } from './db/schema';
import { generateToken, checkPasswordHash, generatePasswordHash, timingSafeEqualStrings } from './crypto';
import type { QuizType } from './compare';

export function publicPlayer(player: Player | undefined | null) {
  if (!player) return null;
  return {
    player_id: player.playerId,
    score: player.score,
    wins: player.wins,
    matches: player.matches,
    single_resonator_score: player.singleResonatorScore,
    single_skeleton_score: player.singleSkeletonScore,
  };
}

export async function getPlayer(db: Database, playerId: string): Promise<Player | undefined> {
  const rows = await db.select().from(players).where(eq(players.playerId, playerId)).limit(1);
  return rows[0];
}

export async function createPlayer(db: Database, playerId: string): Promise<Player> {
  const secret = generateToken();
  const inserted = await db.insert(players).values({
    playerId,
    score: 0,
    secret,
    password: '',
    wins: 0,
    matches: 0,
    singleResonatorScore: 0,
    singleSkeletonScore: 0,
  }).returning();
  return inserted[0];
}

export async function setPlayerSecret(db: Database, playerId: string): Promise<string> {
  const secret = generateToken();
  await db.update(players).set({ secret }).where(eq(players.playerId, playerId));
  return secret;
}

export async function ensurePlayer(db: Database, playerId: string): Promise<Player> {
  const p = await getPlayer(db, playerId);
  if (p) {
    if (!p.secret) {
      const secret = await setPlayerSecret(db, playerId);
      return { ...p, secret };
    }
    return p;
  }
  return createPlayer(db, playerId);
}

export async function authenticatePlayer(
  db: Database,
  data: { player_id?: string; token?: string },
): Promise<Player | null> {
  const playerId = (data.player_id ?? '').trim();
  const token = (data.token ?? '').trim();
  if (!playerId || !token) return null;
  const p = await getPlayer(db, playerId);
  if (!p || !p.secret) return null;
  if (p.secret.length !== token.length) return null;
  if (!timingSafeEqualStrings(p.secret, token)) return null;
  return p;
}

export async function applyScore(db: Database, playerId: string, delta: number) {
  // GREATEST(0, score + delta) via two steps
  const rows = await db.select({ score: players.score }).from(players).where(eq(players.playerId, playerId)).limit(1);
  if (!rows.length) return;
  const newScore = Math.max(0, rows[0].score + delta);
  await db.update(players).set({ score: newScore }).where(eq(players.playerId, playerId));
}

export function singleScoreColumn(quizType: QuizType): 'singleResonatorScore' | 'singleSkeletonScore' {
  return quizType === 'resonator' ? 'singleResonatorScore' : 'singleSkeletonScore';
}

export async function applySingleScore(
  db: Database,
  playerId: string,
  quizType: QuizType,
  attempts: number,
): Promise<number> {
  const base = quizType === 'resonator' ? 100 : 150;
  const limit = quizType === 'resonator' ? 4 : 8;
  const bonus = Math.max(0, limit - attempts) * 20;
  const delta = base + bonus;
  const col = singleScoreColumn(quizType);
  const rows = await db.select({ val: players[col] }).from(players).where(eq(players.playerId, playerId)).limit(1);
  if (!rows.length) return delta;
  await db.update(players).set({ [col]: rows[0].val + delta } as Partial<typeof players.$inferInsert>).where(eq(players.playerId, playerId));
  return delta;
}

export async function recordMatch(db: Database, winnerId: string, loserId: string) {
  const w = await db.select({ wins: players.wins, matches: players.matches })
    .from(players).where(eq(players.playerId, winnerId)).limit(1);
  const l = await db.select({ matches: players.matches })
    .from(players).where(eq(players.playerId, loserId)).limit(1);
  if (w.length) {
    await db.update(players).set({ wins: w[0].wins + 1, matches: w[0].matches + 1 }).where(eq(players.playerId, winnerId));
  }
  if (l.length) {
    await db.update(players).set({ matches: l[0].matches + 1 }).where(eq(players.playerId, loserId));
  }
}

export async function setPassword(db: Database, playerId: string, password: string) {
  const hash = await generatePasswordHash(password);
  await db.update(players).set({ password: hash }).where(eq(players.playerId, playerId));
}

export async function verifyPassword(db: Database, playerId: string, password: string): Promise<boolean> {
  const rows = await db.select({ password: players.password }).from(players).where(eq(players.playerId, playerId)).limit(1);
  if (!rows.length || !rows[0].password) return false;
  const result = await checkPasswordHash(password, rows[0].password);
  return result.ok;
}

export async function verifyPasswordDetailed(db: Database, playerId: string, password: string): Promise<{ ok: boolean; reason?: 'scrypt-unavailable' | 'mismatch' | 'error' }> {
  const rows = await db.select({ password: players.password }).from(players).where(eq(players.playerId, playerId)).limit(1);
  if (!rows.length || !rows[0].password) return { ok: false, reason: 'mismatch' };
  return checkPasswordHash(password, rows[0].password);
}

export async function updatePlayerId(db: Database, oldId: string, newId: string) {
  await db.update(players).set({ playerId: newId }).where(eq(players.playerId, oldId));
}

// ── player_targets (单人游戏会话) ──────────────────────────────
export async function upsertPlayerTarget(
  db: Database,
  pt: NewPlayerTarget,
): Promise<void> {
  // SQLite D1 does not support upsert easily, use delete + insert
  await db.delete(playerTargets).where(eq(playerTargets.playerId, pt.playerId));
  await db.insert(playerTargets).values(pt);
}

export async function getPlayerTarget(
  db: Database,
  playerId: string,
): Promise<(PlayerTarget & { target: Record<string, unknown> }) | undefined> {
  const rows = await db.select().from(playerTargets).where(eq(playerTargets.playerId, playerId)).limit(1);
  if (!rows.length) return undefined;
  const row = rows[0];
  let target: Record<string, unknown> = {};
  try {
    target = JSON.parse(row.targetJson);
  } catch { /* ignore */ }
  return { ...row, target };
}

export async function deletePlayerTarget(db: Database, playerId: string) {
  await db.delete(playerTargets).where(eq(playerTargets.playerId, playerId));
}

export async function incrementPlayerTargetAttempts(db: Database, playerId: string): Promise<number> {
  const current = await getPlayerTarget(db, playerId);
  if (!current) return 0;
  const attempts = current.attempts + 1;
  await db.update(playerTargets).set({ attempts }).where(eq(playerTargets.playerId, playerId));
  return attempts;
}

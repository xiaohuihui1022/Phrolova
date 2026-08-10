// Cloudflare Pages Functions 统一入口
// 使用 Hono 框架处理所有 /api/* 路由
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import { desc, eq, and, gt, lt, sql, lte } from 'drizzle-orm';

import { createDb, characters, soundSkeletons, players, adminLogs, acknowledgements } from '../../src/lib/db';
import {
  buildCompareByType, allMatch, normalizeRow, toFrontendRow,
  type QuizType, type CompareResult,
} from '../../src/lib/compare';
import {
  publicPlayer, getPlayer, createPlayer, setPlayerSecret, ensurePlayer,
  authenticatePlayer, applySingleScore, setPassword,
  updatePlayerId, upsertPlayerTarget, getPlayerTarget, deletePlayerTarget,
  incrementPlayerTargetAttempts, verifyPasswordDetailed,
} from '../../src/lib/players';
import {
  createCaptcha as libCreateCaptcha, storeCaptcha, verifyCaptcha as libVerifyCaptcha,
} from '../../src/lib/captcha';
import { generateToken, hmacSha256Hex, timingSafeEqualStrings } from '../../src/lib/crypto';

// ── Environment types ──────────────────────────────────────────────
type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  SECRET_KEY: string;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  SESSION_TTL: string;
  CAPTCHA_TTL: string;
};

type HonoEnv = {
  Bindings: Bindings;
  Variables: {
    db: ReturnType<typeof createDb>;
  };
};

const app = new Hono<HonoEnv>();

// ── Middleware ─────────────────────────────────────────────────────
app.use('*', logger());
app.use('*', cors({
  origin: ['*'],
  allowHeaders: ['Content-Type', 'X-Admin-Token', 'Authorization', 'X-Player-Id', 'X-Player-Token'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: false,
}));

// Inject DB
app.use('/api/*', async (c, next) => {
  c.set('db', createDb(c.env.DB));
  await next();
});

// JSON body helper (idempotent: caches parsed body on the context to avoid BodyAlreadyConsumed)
async function readJson<T = Record<string, unknown>>(c: any): Promise<T> {
  const cached = c.get('parsed_body');
  if (cached !== undefined) return cached as T;
  try {
    const body = (await c.req.json()) ?? {};
    c.set('parsed_body', body);
    return body as T;
  } catch {
    const empty = {} as T;
    c.set('parsed_body', empty);
    return empty;
  }
}

function success<T extends Record<string, unknown>>(data: T) {
  return { status: 'success', ...data };
}

function error(message: string, status = 400, error_code?: string) {
  const payload: Record<string, unknown> = { status: 'error', message };
  if (error_code) payload.error_code = error_code;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ── Player auth helpers (header → body → query, 三级回退) ──────────
const MIN_TOKEN_LEN = 20;

async function readPlayerAuth(c: any): Promise<{ player_id: string; token: string } | null> {
  // 1) Headers
  const h_pid = String(c.req.header('X-Player-Id') ?? '').trim();
  const h_tok = String(c.req.header('X-Player-Token') ?? '').trim();
  if (h_pid && h_tok && h_tok.length >= MIN_TOKEN_LEN) {
    return { player_id: h_pid, token: h_tok };
  }
  // 2) Body
  const body = await readJson(c);
  const b_pid = String(body.player_id ?? '').trim();
  const b_tok = String(body.token ?? '').trim();
  if (b_pid && b_tok && b_tok.length >= MIN_TOKEN_LEN) {
    return { player_id: b_pid, token: b_tok };
  }
  // 3) Query (for GET requests)
  const q_pid = String(c.req.query('player_id') ?? '').trim();
  const q_tok = String(c.req.query('token') ?? '').trim();
  if (q_pid && q_tok && q_tok.length >= MIN_TOKEN_LEN) {
    return { player_id: q_pid, token: q_tok };
  }
  return null;
}

type PlayerAuthResult =
  | { ok: false; resp: Response }
  | { ok: true; player: NonNullable<Awaited<ReturnType<typeof authenticatePlayer>>>; auth: { player_id: string; token: string } };

async function requirePlayerAuth(c: any): Promise<PlayerAuthResult> {
  const auth = await readPlayerAuth(c);
  if (!auth) {
    return { ok: false, resp: error('缺少玩家身份凭证', 401, 'AUTH_REQUIRED') };
  }
  const db = c.get('db');
  const player = await authenticatePlayer(db, auth);
  if (!player) {
    return { ok: false, resp: error('玩家身份校验失败或已过期，请重新登录', 401, 'AUTH_EXPIRED') };
  }
  return { ok: true, player, auth };
}

// ── Health ─────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json(success({})));

// ── 全站在线人数统计 ──────────────────────────────────────────────
// 基于 KV online:{clientId} 心跳记录（TTL=60s），统计仍活跃的访客数
// 前端在 App.vue 全局发送心跳（已登录用 playerId，匿名用 localStorage 生成的 guest ID）
const ONLINE_KV_PREFIX_STATS = 'online:';
const ONLINE_KV_TTL_STATS = 60;

app.post('/api/stats/heartbeat', async (c) => {
  try {
    const body = await readJson(c);
    const clientId = String(body.client_id ?? '').trim();
    if (!clientId || clientId.length > 128) {
      return error('无效的 client_id');
    }
    await c.env.KV.put(ONLINE_KV_PREFIX_STATS + clientId, String(Date.now()), {
      expirationTtl: ONLINE_KV_TTL_STATS,
    });
    return c.json(success({}));
  } catch (e) {
    console.warn('[stats/heartbeat] KV error:', e);
    return c.json(success({})); // 静默失败
  }
});

app.get('/api/stats/online', async (c) => {
  try {
    // KV.list() 最多一次返回 1000 条，对于中小规模站点足够；
    // 若后续超过 1000 在线，需要改为计数器方案
    let onlineCount = 0;
    let cursor: string | undefined = undefined;
    const MAX_PAGES = 10; // 最多翻 10 页（10000 在线），防止无限循环
    let pages = 0;
    do {
      const list: KVNamespaceListResult<unknown> = await c.env.KV.list({ prefix: ONLINE_KV_PREFIX_STATS, cursor });
      onlineCount += list.keys.length;
      cursor = list.list_complete ? undefined : list.cursor;
      pages += 1;
      if (pages >= MAX_PAGES) break;
    } while (cursor);
    return c.json(success({
      online_count: onlineCount,
      updated_at: Date.now(),
    }));
  } catch (e) {
    // KV 出错时降级：返回 0，不影响前端其他功能
    console.warn('[stats/online] KV error:', e);
    return c.json(success({
      online_count: 0,
      updated_at: Date.now(),
      degraded: true,
    }));
  }
});

// ── Captcha ────────────────────────────────────────────────────────
app.get('/api/auth/captcha', async (c) => {
  const captcha = libCreateCaptcha();
  const ttl = parseInt(c.env.CAPTCHA_TTL ?? '180', 10);
  const expire = Date.now() / 1000 + ttl;
  await storeCaptcha(c.env.KV, { ...captcha, expire }, ttl);
  return c.json(success({ captcha_id: captcha.captcha_id, image: captcha.image }));
});

// ── Player routes ──────────────────────────────────────────────────
app.post('/api/player/init', async (c) => {
  const db = c.get('db');
  const auth = await readPlayerAuth(c);
  if (auth) {
    // 携带鉴权信息 → 必须先校验 token 匹配，再回 player（修复安全漏洞：之前只看 player_id 就回 secret）
    const player = await authenticatePlayer(db, auth);
    if (!player) return error('身份校验失败或已过期，请重新登录', 401, 'AUTH_EXPIRED');
    return c.json(success({ player: publicPlayer(player)!, token: player.secret }));
  }
  // 无鉴权 → 匿名创建/查找（仅依据 player_id，保持向后兼容）
  const body = await readJson(c);
  const playerId = String(body.player_id ?? '').trim();
  if (!playerId) return error('缺少玩家ID');
  const player = await ensurePlayer(db, playerId);
  return c.json(success({ player: publicPlayer(player)!, token: player.secret }));
});

app.post('/api/player/update_id', async (c) => {
  const db = c.get('db');
  const authed = await requirePlayerAuth(c);
  if (!authed.ok) return authed.resp;
  const body = await readJson(c);
  const oldId = authed.auth.player_id;
  const newId = String(body.new_id ?? '').trim();
  if (!newId) return error('缺少新玩家ID');
  if (newId.length > 64) return error('ID 过长');
  // 允许玩家把自己的 old_id 显式指定为已认证 id 即可
  const bodyOld = String(body.old_id ?? '').trim();
  if (bodyOld && bodyOld !== oldId) return error('身份校验失败', 403, 'AUTH_EXPIRED');
  const other = await getPlayer(db, newId);
  if (other && other.playerId !== oldId) return error('该玩家ID已被占用', 409);
  await updatePlayerId(db, oldId, newId);
  const p = await getPlayer(db, newId);
  return c.json(success({ player: publicPlayer(p)!, token: p!.secret }));
});

app.post('/api/player/score', async (c) => {
  const db = c.get('db');
  // 排行榜是公开查询，所以不强鉴权；有鉴权成功时保持兼容返回公开展示信息
  const body = await readJson(c);
  const playerId = String(body.player_id ?? '').trim();
  if (!playerId) return error('缺少玩家ID');
  const p = await getPlayer(db, playerId);
  return c.json(success({ player: publicPlayer(p), delta: 0 }));
});

// ── Auth (Register / Login / Logout) ───────────────────────────────
app.post('/api/auth/register', async (c) => {
  const db = c.get('db');
  const body = await readJson(c);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const captchaId = String(body.captcha_id ?? '').trim();
  const captchaText = String(body.captcha_text ?? '').trim();
  if (!username) return error('账号不能为空');
  if (username.length > 64) return error('账号过长（最多64字符）');
  if (password.length < 6) return error('密码至少 6 位');
  const captchaOk = await libVerifyCaptcha(c.env.KV, captchaId, captchaText);
  if (!captchaOk) return error('验证码错误或已过期');

  try {
    const exists = await getPlayer(db, username);
    if (exists) {
      // 之前创建过但 password 字段为空 → 允许"重新注册"，视为补全密码
      if (!exists.password) {
        try {
          await setPassword(db, username, password);
          await setPlayerSecret(db, username);
          const p = await getPlayer(db, username);
          return c.json(success({ player: publicPlayer(p)!, token: p!.secret, message: '注册成功，已自动登录' }));
        } catch (e) {
          return error(`密码设置失败：${e instanceof Error ? e.message : '未知错误'}`, 500);
        }
      }
      return error('该账号已被注册', 409);
    }
    await createPlayer(db, username);
    try {
      await setPassword(db, username, password);
    } catch (e) {
      // 关键：createPlayer 成功但 setPassword 失败时，把玩家删掉避免脏数据
      try { await db.delete(players).where(eq(players.playerId, username)); } catch { /* ignore */ }
      return error(`注册失败（密码加密异常）：${e instanceof Error ? e.message : '请稍后重试'}`, 500);
    }
    const p = await getPlayer(db, username);
    return c.json(success({ player: publicPlayer(p)!, token: p!.secret, message: '注册成功，已自动登录' }));
  } catch (e) {
    // 尝试清理可能残留的空密码账号
    try { const maybe = await getPlayer(db, username); if (maybe && !maybe.password) await db.delete(players).where(eq(players.playerId, username)); } catch { /* ignore */ }
    return error(`注册失败：${e instanceof Error ? e.message : '未知错误'}`, 500);
  }
});

app.post('/api/auth/login', async (c) => {
  const db = c.get('db');
  const body = await readJson(c);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const captchaId = String(body.captcha_id ?? '').trim();
  const captchaText = String(body.captcha_text ?? '').trim();
  if (!username || !password) return error('请输入账号和密码');
  const captchaOk = await libVerifyCaptcha(c.env.KV, captchaId, captchaText);
  if (!captchaOk) return error('验证码错误或已过期');
  const p = await getPlayer(db, username);
  if (!p) return error('账号不存在', 404);
  if (!p.password) return error('该账号密码未设置，请重新注册并设置密码', 412);
  try {
    const pwdResult = await verifyPasswordDetailed(db, username, password);
    if (!pwdResult.ok) {
      if (pwdResult.reason === 'scrypt-unavailable') {
        const response = new Response(JSON.stringify({
          status: 'error',
          message: '当前环境不支持旧密码验证，请重置密码',
          error_code: 'SCRYPT_UNAVAILABLE',
        }), {
          status: 426,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
        return response;
      }
      return error('账号或密码错误', 401);
    }
  } catch (e) {
    return error(`密码验证失败：${e instanceof Error ? e.message : '请稍后再试'}`, 500);
  }
  // 刷新 secret token
  const secret = await setPlayerSecret(db, username);
  return c.json(success({ player: publicPlayer({ ...p, secret })!, token: secret, message: '登录成功' }));
});

app.post('/api/auth/refresh', async (c) => {
  // 强制 header 鉴权（不接受 body）：每次 refresh 轮换 players.secret，旧 token 立即失效
  const h_pid = String(c.req.header('X-Player-Id') ?? '').trim();
  const h_tok = String(c.req.header('X-Player-Token') ?? '').trim();
  if (!h_pid || h_tok.length < MIN_TOKEN_LEN) {
    return error('缺少玩家身份凭证', 401, 'AUTH_REQUIRED');
  }
  const db = c.get('db');
  const player = await authenticatePlayer(db, { player_id: h_pid, token: h_tok });
  if (!player) return error('玩家身份校验失败或已过期，请重新登录', 401, 'AUTH_EXPIRED');
  const newSecret = await setPlayerSecret(db, h_pid);
  const refreshed = await getPlayer(db, h_pid);
  return c.json(success({ player: publicPlayer(refreshed)!, token: newSecret }));
});

app.get('/api/auth/me', async (c) => {
  const authed = await requirePlayerAuth(c);
  if (!authed.ok) return authed.resp;
  return c.json(success({ player: publicPlayer(authed.player)! }));
});

app.post('/api/auth/logout', async (c) => {
  // 服务端失效 secret（best-effort，失败也不让客户端卡住）
  try {
    const auth = await readPlayerAuth(c);
    if (auth) {
      const db = c.get('db');
      const player = await authenticatePlayer(db, auth);
      if (player) await setPlayerSecret(db, auth.player_id);
    }
  } catch { /* ignore */ }
  return c.json(success({ message: '已退出登录' }));
});

// ── 安全密码升级：客户端计算 scrypt，服务端验证（不暴露存储的哈希） ──
// 流程：
//   1. 前端 GET /api/auth/scrypt-params?username=xxx → 返回 { salt, N, r, p, dklen }（不含哈希!）
//   2. 浏览器用 hash-wasm 计算 scrypt(旧密码, salt, params) → derived_hex
//   3. 前端 POST /api/auth/upgrade-password { username, old_password_hash, new_password, captcha }
//   4. 服务端对比 derived_hex 与 DB 中存储的 hex_hash → 匹配则升级为 PBKDF2

app.get('/api/auth/scrypt-params', async (c) => {
  const db = c.get('db');
  const username = String(c.req.query('username') ?? '').trim();
  if (!username) return error('账号不能为空');

  const p = await getPlayer(db, username);
  if (!p) return error('账号不存在', 404);
  if (!p.password || !p.password.startsWith('scrypt:')) {
    return error('该账号无需密码升级', 400);
  }

  // 解析 scrypt 格式: scrypt:N:r:p$salt$hex_hash
  // 只返回 salt 和参数，绝不返回 hex_hash
  const [methodPart, salt] = p.password.split('$');
  const params = methodPart.split(':');
  const N = parseInt(params[1], 10);
  const r = parseInt(params[2], 10);
  const p_param = parseInt(params[3], 10);
  const dklen = (p.password.split('$')[2] ?? '').length / 2;

  return c.json(success({ salt, N, r, p: p_param, dklen }));
});

app.post('/api/auth/upgrade-password', async (c) => {
  const db = c.get('db');
  const body = await readJson(c);
  const username = String(body.username ?? '').trim();
  const oldPasswordHash = String(body.old_password_hash ?? '').trim();
  const newPassword = String(body.new_password ?? '');
  const captchaId = String(body.captcha_id ?? '').trim();
  const captchaText = String(body.captcha_text ?? '').trim();

  if (!username) return error('账号不能为空');
  if (!oldPasswordHash) return error('请提供旧密码验证');
  if (newPassword.length < 6) return error('密码至少 6 位');

  const captchaOk = await libVerifyCaptcha(c.env.KV, captchaId, captchaText);
  if (!captchaOk) return error('验证码错误或已过期');

  const p = await getPlayer(db, username);
  if (!p) return error('账号不存在', 404);
  if (!p.password || !p.password.startsWith('scrypt:')) {
    return error('该账号无需密码升级', 400);
  }

  // 从 DB 哈希中提取 hex_hash 部分
  const storedHexHash = p.password.split('$')[2] ?? '';

  // 服务端验证：对比客户端计算的 scrypt 结果与存储的哈希
  if (!timingSafeEqualStrings(oldPasswordHash.toLowerCase(), storedHexHash.toLowerCase())) {
    return error('旧密码验证失败，请检查密码是否正确', 401);
  }

  // 验证通过 → 用 PBKDF2 存储新密码
  try {
    await setPassword(db, username, newPassword);
    const secret = await setPlayerSecret(db, username);
    const updated = await getPlayer(db, username);
    return c.json(success({
      player: publicPlayer(updated)!,
      token: secret,
      message: '密码升级成功，请使用新密码登录',
    }));
  } catch (e) {
    return error(`密码升级失败：${e instanceof Error ? e.message : '请稍后重试'}`, 500);
  }
});

// ── Game data ──────────────────────────────────────────────────────
app.get('/api/names', async (c) => {
  const db = c.get('db');
  const rows = await db.select({
    name: characters.name,
    attribute: characters.attribute,
    star_rating: characters.starRating,
    weapon: characters.weapon,
    birthplace: characters.birthplace,
    version: characters.version,
  }).from(characters).orderBy(characters.name);
  return c.json(success({ names: rows }));
});

app.get('/api/skeleton_names', async (c) => {
  const db = c.get('db');
  const rows = await db.select({
    name: soundSkeletons.name,
    skill_attribute: soundSkeletons.skillAttribute,
    cost: soundSkeletons.cost,
    is_aberration: soundSkeletons.isAberration,
    set_name: soundSkeletons.setName,
    drop_location: soundSkeletons.dropLocation,
  }).from(soundSkeletons).orderBy(soundSkeletons.name);
  return c.json(success({ names: rows }));
});

// ── Draw target ─────────────────────────────────────────────────────
async function drawTargetByType(db: ReturnType<typeof createDb>, quizType: QuizType, difficulty: string) {
  if (quizType === 'skeleton') {
    if (difficulty === 'easy') {
      const rows = await db.select().from(soundSkeletons).where(eq(soundSkeletons.cost, 4)).orderBy(sql`RANDOM()`).limit(1);
      return rows[0];
    }
    const rows = await db.select().from(soundSkeletons).orderBy(sql`RANDOM()`).limit(1);
    return rows[0];
  }
  const rows = await db.select().from(characters).orderBy(sql`RANDOM()`).limit(1);
  return rows[0];
}

async function lookupGuessByName(db: ReturnType<typeof createDb>, quizType: QuizType, guessName: string) {
  if (quizType === 'skeleton') {
    const rows = await db.select().from(soundSkeletons).where(eq(soundSkeletons.name, guessName)).limit(1);
    return rows[0];
  }
  const rows = await db.select().from(characters).where(eq(characters.name, guessName)).limit(1);
  return rows[0];
}

app.get('/api/draw', async (c) => {
  const db = c.get('db');
  const quizType = (c.req.query('type') ?? 'resonator') as QuizType;
  const difficulty = c.req.query('difficulty') ?? 'normal';
  const row = await drawTargetByType(db, quizType, difficulty);
  if (!row) return error('数据库中没有目标数据', 404);
  return c.json(success({ type: quizType, character: toFrontendRow(row as unknown as Record<string, unknown>, quizType) }));
});

app.post('/api/draw', async (c) => {
  const db = c.get('db');
  const body = await readJson(c);
  const quizType = (String(body.type ?? 'resonator').trim() || 'resonator') as QuizType;
  const difficulty = String(body.difficulty ?? 'normal').trim() || 'normal';
  const row = await drawTargetByType(db, quizType, difficulty);
  if (!row) return error('数据库中没有目标数据', 404);
  const authed = await requirePlayerAuth(c);
  if (authed.ok) {
    await upsertPlayerTarget(db, {
      playerId: authed.auth.player_id,
      quizType,
      targetJson: JSON.stringify(normalizeRow(row as unknown as Record<string, unknown>, quizType)),
      attempts: 0,
    });
  }
  // 未鉴权也允许 draw（匿名开局），只是不写服务端 target
  return c.json(success({ type: quizType, character: toFrontendRow(row as unknown as Record<string, unknown>, quizType) }));
});

// ── Guess ───────────────────────────────────────────────────────────
app.post('/api/guess', async (c) => {
  const db = c.get('db');
  const body = await readJson(c);
  const guessName = String(body.guess ?? '').trim();
  if (!guessName) return error('请输入名称');

  const authed = await requirePlayerAuth(c);
  if (authed.ok) {
    const playerId = authed.auth.player_id;
    const session = await getPlayerTarget(db, playerId);
    if (!session || !session.target) {
      return error('请先抽取目标再开始猜测');
    }
    const quizType = session.quizType as QuizType;
    const target = session.target;
    const attempts = await incrementPlayerTargetAttempts(db, playerId);

    const guessRow = await lookupGuessByName(db, quizType, guessName);
    if (!guessRow) return error(`数据库中不存在名为「${guessName}」的目标`, 404);

    const compare: CompareResult = buildCompareByType(
      target,
      guessRow as unknown as Record<string, unknown>,
      quizType,
    );
    let score: number | null = null;
    const limit = quizType === 'resonator' ? 4 : 8;
    if (allMatch(compare as unknown as Record<string, unknown>)) {
      score = await applySingleScore(db, playerId, quizType, attempts);
      await deletePlayerTarget(db, playerId);
    } else if (attempts >= limit) {
      await deletePlayerTarget(db, playerId);
    }
    return c.json(success({
      type: quizType,
      guess: toFrontendRow(guessRow as unknown as Record<string, unknown>, quizType),
      compare,
      score,
      attempts,
      limit,
    }));
  }

  // No player auth — require target in body（匿名模式保持向后兼容）
  const target = body.target as Record<string, unknown> | undefined;
  const quizType = (String(body.type ?? 'resonator') || 'resonator') as QuizType;
  if (!target) return error('缺少目标数据，请先抽取随机目标');
  const guessRow = await lookupGuessByName(db, quizType, guessName);
  if (!guessRow) return error(`数据库中不存在名为「${guessName}」的目标`, 404);
  const compare = buildCompareByType(target, guessRow as unknown as Record<string, unknown>, quizType);
  const limit = quizType === 'resonator' ? 4 : 8;
  return c.json(success({
    type: quizType,
    guess: toFrontendRow(guessRow as unknown as Record<string, unknown>, quizType),
    compare,
    score: null,
    limit,
  }));
});

// ── Leaderboard ─────────────────────────────────────────────────────
function resolveScoreColumn(mode: string, quizType: string) {
  if (mode === 'single') {
    return quizType === 'resonator' ? 'singleResonatorScore' : 'singleSkeletonScore';
  }
  return 'score';
}

app.get('/api/leaderboard', async (c) => {
  const db = c.get('db');
  const TOP_N = 40;
  const mode = (c.req.query('mode') ?? 'multi').trim();
  const quizType = (c.req.query('type') ?? 'resonator').trim();
  const scoreCol = resolveScoreColumn(mode, quizType) as keyof typeof players.$inferSelect;

  const orderCol = players[scoreCol] ?? players.score;
  const topRows = await db.select({
    id: players.id,
    playerId: players.playerId,
    score: players.score,
    wins: players.wins,
    matches: players.matches,
    singleResonatorScore: players.singleResonatorScore,
    singleSkeletonScore: players.singleSkeletonScore,
    sortScore: orderCol,
  }).from(players).orderBy(desc(orderCol), players.playerId).limit(TOP_N);

  const top = topRows.map(r => {
    const sortScore = Number(r.sortScore ?? 0);
    const winRate = r.matches ? Math.round(r.wins * 1000 / r.matches) / 10 : null;
    return {
      id: r.id,
      player_id: r.playerId,
      score: r.score,
      wins: r.wins,
      matches: r.matches,
      single_resonator_score: r.singleResonatorScore,
      single_skeleton_score: r.singleSkeletonScore,
      sort_score: sortScore,
      win_rate: winRate,
    };
  });

  let myInfo: Record<string, unknown> | null = null;
  const playerId = (c.req.query('player_id') ?? '').trim();
  if (playerId) {
    const inTop = top.some(r => r.player_id === playerId);
    if (inTop) {
      const row = top.find(r => r.player_id === playerId)!;
      myInfo = { player_id: playerId, score: row.sort_score, in_top: true };
    } else {
      const mine = await db.select({ score: orderCol }).from(players)
        .where(eq(players.playerId, playerId)).limit(1);
      if (mine.length && mine[0].score) {
        const myScore = Number(mine[0].score ?? 0);
        const greaterCount = await db.select({ c: sql<number>`COUNT(*)` })
          .from(players).where(gt(orderCol, myScore));
        const sameBefore = await db.select({ c: sql<number>`COUNT(*)` })
          .from(players).where(and(eq(orderCol, myScore), lt(players.playerId, playerId)));
        const greater = Number(greaterCount[0]?.c ?? 0);
        const same = Number(sameBefore[0]?.c ?? 0);
        myInfo = { player_id: playerId, score: myScore, rank: greater + same + 1, in_top: false };
      }
    }
  }

  return c.json(success({ leaderboard: top, my_info: myInfo, mode, type: quizType }));
});

// ── Admin helpers ───────────────────────────────────────────────────
const ADMIN_SESSION_PREFIX = 'admin_session:';
const _rateWindow: Record<string, number[]> = {};
const RATE_LIMIT = 5;
const RATE_WINDOW_SEC = 60;

function checkRate(key: string): boolean {
  const now = Date.now() / 1000;
  const window = _rateWindow[key] ?? [];
  const pruned = window.filter(t => t > now - RATE_WINDOW_SEC);
  if (pruned.length >= RATE_LIMIT) {
    _rateWindow[key] = pruned;
    return false;
  }
  pruned.push(now);
  _rateWindow[key] = pruned;
  return true;
}

async function makeAdminToken(env: Bindings, username: string): Promise<string> {
  const payload = `${username}:${Date.now() / 1000}`;
  const sig = (await hmacSha256Hex(env.SECRET_KEY ?? 'dev-secret', payload)).slice(0, 16);
  return `${sig}:${payload}`;
}

async function verifyAdminToken(env: Bindings, token: string): Promise<boolean> {
  if (!token) return false;
  const raw = await env.KV.get(ADMIN_SESSION_PREFIX + token);
  if (!raw) return false;
  let expiry = 0;
  try {
    expiry = JSON.parse(raw).expiry;
  } catch {
    return false;
  }
  if (Date.now() / 1000 > expiry) {
    await env.KV.delete(ADMIN_SESSION_PREFIX + token);
    return false;
  }
  return true;
}

async function requireAdmin(c: any): Promise<Response | null> {
  const token = String(c.req.header('X-Admin-Token') ?? '');
  const ok = await verifyAdminToken(c.env, token);
  if (!ok) return error('未授权，请先登录', 401, 'ADMIN_AUTH_REQUIRED');
  return null;
}

async function appendLog(db: ReturnType<typeof createDb>, level: 'INFO' | 'ERROR', message: string) {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    await db.insert(adminLogs).values({ time, level, message });
    // Keep only last 50: delete any rows with id <= (max_id - 50)
    const rows = await db.select({ id: adminLogs.id }).from(adminLogs).orderBy(desc(adminLogs.id)).limit(1).offset(50);
    if (rows.length) {
      await db.delete(adminLogs).where(lte(adminLogs.id, rows[0].id));
    }
  } catch { /* ignore */ }
}

// ── Admin routes ───────────────────────────────────────────────────
app.post('/api/admin/login', async (c) => {
  const ip = String(c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown');
  if (!checkRate(`login:${ip}`)) return error('登录过于频繁，请稍后再试', 429);
  const body = await readJson(c);
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const expectedUser = c.env.ADMIN_USER ?? 'admin';
  const expectedPass = c.env.ADMIN_PASSWORD;
  const userOk = username.length === expectedUser.length &&
    timingSafeEqualStrings(username, expectedUser);
  const passOk = !!expectedPass && password.length === expectedPass.length &&
    timingSafeEqualStrings(password, expectedPass);
  if (!userOk || !passOk) return error('账号或密码错误', 401);
  const token = await makeAdminToken(c.env, username);
  const ttl = parseInt(c.env.SESSION_TTL ?? '7200', 10);
  await c.env.KV.put(ADMIN_SESSION_PREFIX + token, JSON.stringify({ expiry: Date.now() / 1000 + ttl }), {
    expirationTtl: ttl + 60,
  });
  return c.json(success({ token }));
});

app.post('/api/admin/logout', async (c) => {
  const token = String(c.req.header('X-Admin-Token') ?? '');
  if (token) await c.env.KV.delete(ADMIN_SESSION_PREFIX + token);
  return c.json(success({}));
});

app.get('/api/admin/logs', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const logs = await db.select().from(adminLogs).orderBy(desc(adminLogs.id)).limit(50);
  return c.json(success({ logs }));
});

app.get('/api/admin/data', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const chars = await db.select({
    name: characters.name,
    attribute: characters.attribute,
    star_rating: characters.starRating,
    weapon: characters.weapon,
    birthplace: characters.birthplace,
    version: characters.version,
  }).from(characters).orderBy(characters.name);
  const echoes = await db.select({
    name: soundSkeletons.name,
    skill_attribute: soundSkeletons.skillAttribute,
    cost: soundSkeletons.cost,
    is_aberration: soundSkeletons.isAberration,
    set_name: soundSkeletons.setName,
    drop_location: soundSkeletons.dropLocation,
  }).from(soundSkeletons).orderBy(soundSkeletons.name);
  return c.json(success({ data: { characters: chars, echoes } }));
});

app.post('/api/admin/update', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const body = await readJson(c);
  const entries = (body.entries ?? []) as Array<{ name?: string; overwrites?: Record<string, unknown> }>;
  if (!entries.length) return error('无数据');
  let updated = 0;
  const charFields = ['attribute', 'star_rating', 'weapon', 'birthplace', 'version'];
  const echoFields = ['skill_attribute', 'cost', 'is_aberration', 'set_name', 'drop_location'];
  for (const entry of entries) {
    const name = String(entry.name ?? '').trim();
    const overrides = entry.overwrites ?? {};
    if (!name || Object.keys(overrides).length === 0) continue;

    const charMatch = await db.select({ id: characters.id }).from(characters).where(eq(characters.name, name)).limit(1);
    if (charMatch.length) {
      const sets: Record<string, unknown> = {};
      for (const f of charFields) {
        if (f in overrides) {
          const v = overrides[f];
          sets[f === 'star_rating' ? 'starRating' : f] = f === 'star_rating' ? Number(v) : v;
        }
      }
      if (Object.keys(sets).length) {
        await db.update(characters).set(sets as any).where(eq(characters.name, name));
        updated += 1; // name 是唯一索引，所以最多更新一行
      }
      continue;
    }
    const echoMatch = await db.select({ id: soundSkeletons.id }).from(soundSkeletons).where(eq(soundSkeletons.name, name)).limit(1);
    if (echoMatch.length) {
      const sets: Record<string, unknown> = {};
      for (const f of echoFields) {
        if (f in overrides) {
          const v = overrides[f];
          const mapped = f === 'skill_attribute' ? 'skillAttribute'
            : f === 'is_aberration' ? 'isAberration'
            : f === 'set_name' ? 'setName'
            : f === 'drop_location' ? 'dropLocation'
            : f;
          sets[mapped] = f === 'cost' ? Number(v) : v;
        }
      }
      if (Object.keys(sets).length) {
        await db.update(soundSkeletons).set(sets as any).where(eq(soundSkeletons.name, name));
        updated += 1;
      }
    }
  }
  return c.json(success({ updated }));
});

// Simplified sync stubs (since we don't have Python nanoka_scraper in TS)
// In production these would call the original scraper endpoints or a scheduled Worker
const SYNC_STATE_KEY = 'admin_sync_state';
type SyncState = { status: 'running' | 'idle'; result?: unknown };

app.get('/api/admin/sync/status', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const raw = await c.env.KV.get(SYNC_STATE_KEY);
  let state: SyncState = { status: 'idle' };
  if (raw) {
    try { state = JSON.parse(raw); } catch { /* ignore */ }
  }
  return c.json({ status: state.status === 'running' ? 'running' : 'idle', result: state.result ?? null });
});

app.post('/api/admin/sync/preview', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const body = await readJson(c);
  const syncType = String(body.type ?? 'all').trim();
  const db = c.get('db');
  try {
    const chars = await db.select().from(characters).orderBy(characters.name);
    const echoes = await db.select().from(soundSkeletons).orderBy(soundSkeletons.name);
    const result: Record<string, unknown> = {};
    if (syncType === 'characters') result.characters = { created: [], updated: [], deleted: [], current: chars };
    else if (syncType === 'echoes') result.echoes = { created: [], updated: [], deleted: [], current: echoes };
    else {
      result.characters = { created: [], updated: [], deleted: [], current: chars };
      result.echoes = { created: [], updated: [], deleted: [], current: echoes };
    }
    return c.json(success({ result }));
  } catch (e: any) {
    await appendLog(c.get('db'), 'ERROR', `preview_sync(${syncType}): ${e?.message ?? e}`);
    return error(`${e?.name ?? 'Error'}: ${e?.message ?? e}`, 500);
  }
});

app.post('/api/admin/sync', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const raw = await c.env.KV.get(SYNC_STATE_KEY);
  let state: SyncState = { status: 'idle' };
  if (raw) {
    try { state = JSON.parse(raw); } catch { /* ignore */ }
  }
  if (state.status === 'running') {
    return new Response(JSON.stringify({ status: 'busy', message: '同步任务已在运行中' }), {
      status: 409, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const body = await readJson(c);
  const syncType = String(body.type ?? 'all').trim();
  const db = c.get('db');
  await appendLog(db, 'INFO', `sync ${syncType} started (stub — TS version placeholder)`);

  // Mark running, then complete with stub result (since nanoka_scraper.py isn't ported)
  await c.env.KV.put(SYNC_STATE_KEY, JSON.stringify({ status: 'running' }));
  // In a real deployment, this could go to a Queue + Worker
  const stubResult: Record<string, unknown> = {
    ok: false,
    message: 'TS版本同步占位：请在有爬虫环境的Worker中实现或手动更新数据',
  };
  if (syncType === 'characters') stubResult.characters = { created: 0, updated: 0, deleted: 0 };
  else if (syncType === 'echoes') stubResult.echoes = { created: 0, updated: 0, deleted: 0 };
  else {
    stubResult.characters = { created: 0, updated: 0, deleted: 0 };
    stubResult.echoes = { created: 0, updated: 0, deleted: 0 };
  }
  await c.env.KV.put(SYNC_STATE_KEY, JSON.stringify({ status: 'idle', result: stubResult }));
  await appendLog(db, 'INFO', `sync ${syncType} completed (stub)`);
  return c.json({ status: 'started', message: '同步任务已启动（TS版本占位，若需真实爬虫请扩展Queue Worker）' });
});

// ── 致谢名单（公开） ──────────────────────────────────────────────
app.get('/api/acknowledgements', async (c) => {
  const db = c.get('db');
  const rows = await db.select({
    id: acknowledgements.id,
    player_id: acknowledgements.playerId,
    category: acknowledgements.category,
    description: acknowledgements.description,
    avatar: acknowledgements.avatar,
    sort_order: acknowledgements.sortOrder,
    created_at: acknowledgements.createdAt,
  }).from(acknowledgements).orderBy(acknowledgements.sortOrder, acknowledgements.id);
  return c.json(success({ list: rows }));
});

// ── 致谢名单（管理后台） ──────────────────────────────────────────
app.get('/api/admin/acknowledgements', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const rows = await db.select({
    id: acknowledgements.id,
    player_id: acknowledgements.playerId,
    category: acknowledgements.category,
    description: acknowledgements.description,
    avatar: acknowledgements.avatar,
    sort_order: acknowledgements.sortOrder,
    created_at: acknowledgements.createdAt,
  }).from(acknowledgements).orderBy(acknowledgements.sortOrder, acknowledgements.id);
  return c.json(success({ list: rows }));
});

app.post('/api/admin/acknowledgements', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const body = await readJson(c);
  const playerId = String(body.player_id ?? '').trim();
  const category = String(body.category ?? 'bug').trim();
  const description = String(body.description ?? '').trim();
  const avatar = String(body.avatar ?? '').trim();
  const sortOrder = Number(body.sort_order ?? 0);
  if (!playerId) return error('缺少玩家ID');
  const result = await db.insert(acknowledgements).values({
    playerId, category, description, avatar: avatar || null, sortOrder,
  }).returning({ id: acknowledgements.id });
  await appendLog(db, 'INFO', `ack add: ${playerId} (${category})`);
  return c.json(success({ id: result[0]?.id }));
});

app.put('/api/admin/acknowledgements/:id', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const id = Number(c.req.param('id'));
  if (!id) return error('无效的ID');
  const body = await readJson(c);
  const sets: Record<string, unknown> = {};
  if ('player_id' in body) sets.playerId = String(body.player_id ?? '').trim();
  if ('category' in body) sets.category = String(body.category ?? 'bug').trim();
  if ('description' in body) sets.description = String(body.description ?? '').trim();
  if ('avatar' in body) sets.avatar = String(body.avatar ?? '').trim() || null;
  if ('sort_order' in body) sets.sortOrder = Number(body.sort_order ?? 0);
  if (Object.keys(sets).length === 0) return error('无更新字段');
  const exists = await db.select({ id: acknowledgements.id }).from(acknowledgements).where(eq(acknowledgements.id, id)).limit(1);
  if (!exists.length) return error('记录不存在', 404);
  await db.update(acknowledgements).set(sets as any).where(eq(acknowledgements.id, id));
  await appendLog(db, 'INFO', `ack update #${id}`);
  return c.json(success({}));
});

app.delete('/api/admin/acknowledgements/:id', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = c.get('db');
  const id = Number(c.req.param('id'));
  if (!id) return error('无效的ID');
  const exists = await db.select({ id: acknowledgements.id }).from(acknowledgements).where(eq(acknowledgements.id, id)).limit(1);
  if (!exists.length) return error('记录不存在', 404);
  await db.delete(acknowledgements).where(eq(acknowledgements.id, id));
  await appendLog(db, 'INFO', `ack delete #${id}`);
  return c.json(success({}));
});

// ── Error handler ──────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[API ERROR]', err);
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  return error(err?.message ?? 'Internal Server Error', 500);
});

app.notFound((c) => error('Not Found', 404));

// Cloudflare Pages Functions 入口约定：导出 onRequest
// Hono app.fetch(req, env, ctx) 签名与 PagesFunction 的 EventContext 通过桥接适配
export async function onRequest(
  context: EventContext<Bindings, string, Record<string, unknown>>,
): Promise<Response> {
  return app.fetch(context.request, context.env, context as unknown as ExecutionContext);
}

// 保留 default 导出以兼容 wrangler pages dev 与其他使用场景
export default app;

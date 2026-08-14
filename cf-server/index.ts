// Cloudflare Worker 入口：路由 WebSocket 到 Durable Object
//
// 架构：
//   1. Worker 仅负责路由和身份验证
//   2. Durable Object 直接处理 WebSocket 连接
//   3. DO 使用 Hibernation API（推荐）或标准 WebSocket API
//
// 路由设计：
//   /ws/matchmaker  → Matchmaker Durable Object
//   /ws/room/{code} → Room Durable Object

import { RoomObject } from './room-object';
import { MatchmakerObject } from './matchmaker-object';

export { RoomObject, MatchmakerObject };

// ── 环境绑定类型 ──
export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace<RoomObject>;
  MATCHMAKER: DurableObjectNamespace<MatchmakerObject>;
  SESSION_TTL: string;
  CAPTCHA_TTL: string;
  ADMIN_USER: string;
}

// ── CORS 头 ──
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ── 主入口 ──
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);

      // 处理 CORS 预检请求
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
      }

      // HTTP 健康检查
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', server: 'cf-worker' }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      // WebSocket 升级请求
      if (request.headers.get('Upgrade') === 'websocket') {
        return await routeWebSocket(request, env, ctx, url);
      }

      // HTTP 请求路由（用于状态查询等）
      if (url.pathname.startsWith('/ws/')) {
        return await routeHttp(request, env, ctx, url);
      }

      // 404
      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Worker error:', message);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};

// ── WebSocket 路由 ──
async function routeWebSocket(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const pathname = url.pathname;
  const playerId = url.searchParams.get('playerId') || '';
  const token = url.searchParams.get('token') || '';

  // 验证参数
  if (!playerId || !token) {
    return new Response(JSON.stringify({ error: '缺少 playerId 或 token 参数' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  // 路由到 Matchmaker
  if (pathname === '/ws/matchmaker' || pathname === '/ws') {
    const matchmakerId = env.MATCHMAKER.idFromName('default');
    const matchmaker = env.MATCHMAKER.get(matchmakerId);

    // 直接转发原始请求给 Durable Object，保留 WebSocket 升级头
    return matchmaker.fetch(request);
  }

  // 路由到 Room
  let roomCode = url.searchParams.get('roomCode') || '';
  if (!roomCode && pathname.startsWith('/ws/room/')) {
    roomCode = pathname.slice('/ws/room/'.length);
  }

  if (!roomCode) {
    return new Response(JSON.stringify({ error: '缺少 roomCode 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const roomId = env.ROOM.idFromName(roomCode);
  const room = env.ROOM.get(roomId);

  // 直接转发原始请求给 Durable Object，保留 WebSocket 升级头
  return room.fetch(request);
}

// ── HTTP 路由（用于状态查询等） ──
async function routeHttp(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const pathname = url.pathname;

  // 路由到 Matchmaker
  if (pathname === '/ws/matchmaker' || pathname === '/ws') {
    const matchmakerId = env.MATCHMAKER.idFromName('default');
    const matchmaker = env.MATCHMAKER.get(matchmakerId);

    // 直接转发原始请求
    return matchmaker.fetch(request);
  }

  // 路由到 Room
  let roomCode = url.searchParams.get('roomCode') || '';
  if (!roomCode && pathname.startsWith('/ws/room/')) {
    roomCode = pathname.slice('/ws/room/'.length);
  }

  if (!roomCode) {
    return new Response(JSON.stringify({ error: '缺少 roomCode 参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const roomId = env.ROOM.idFromName(roomCode);
  const room = env.ROOM.get(roomId);

  // 直接转发原始请求
  return room.fetch(request);
}



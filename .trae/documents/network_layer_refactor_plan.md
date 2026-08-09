# 网络层架构重构计划（前后端联动版）

## 一、现状调研结论

### 1.1 当前项目（Phrolova）网络层架构

```
src/api/
├── http.ts                # 极简 fetch 封装：requestJson() / apiPath() / ApiError
├── auth.ts                # 认证相关 API 函数（登录/注册/initPlayer 等）
├── game.ts                # 游戏相关 API 函数（draw/submit 等）
├── leaderboard.ts         # 排行榜 API
├── acknowledgements.ts    # 致谢&管理后台 API
├── multiplayer.ts         # 仅事件名常量+类型定义，无 WS 连接代码
└── index.ts               # 统一 barrel 导出
src/utils/http.ts          # 仅 re-export @/api/http，无实际逻辑
src/composables/useAdmin.ts # 管理员会话，直连 requestJson()，绕过统一层
src/stores/
├── auth.ts                # 玩家会话（playerId/token 存 localStorage），直连 @/api/*
├── singleGame.ts          # 单人游戏 store，直连 @/api/*
├── dictionary.ts          # 字典 store，直连 @/api/*
└── multiGame.ts           # ★ 内联 150 行 GameWebSocket 类 + 连接/重连/心跳/状态机
functions/api/[[route]].ts # ★ Hono REST 后端：鉴权只从 body 取 player_id/token
worker-entry.ts            # ★ /ws/* 路由：playerId/token 只从 URL query 取
cf-server/
├── matchmaker-object.ts   # DO 鉴权：verifyToken 失败只返回 Response('Unauthorized',401) 纯文本
└── room-object.ts         # DO 鉴权：同上，纯文本 401，无 error_code
```

#### 前端 7 个核心问题

| 问题点 | 现状描述 | 影响 |
|---|---|---|
| HTTP 客户端无拦截器 | `requestJson()` 是裸 fetch 包装，无请求/响应拦截器 | ① Token 过期 401 时无法透明刷新+重试，用户被踢需重登；② 无统一请求 ID / 超时 / 重试机制；③ 每个 API 函数手动 JSON.stringify body、手动拼 headers |
| Token 注入分散 | 玩家 token 手动放入 POST body（`drawTarget`/`submitGuess`），管理员 token 手动传 headers 对象 | 新增接口容易漏传；Auth 过期时所有调用方各自处理 401，代码重复 |
| 错误处理分散 | 无统一错误码→用户消息映射；每页 `try/catch` 手写 `reason instanceof Error ? reason.message : "xxx失败"` 共 48 处 | 错误文案不统一；后端新增错误码前端要改多处 |
| 认证与会话耦合混乱 | 会话初始化（hydrate）在 `authStore.hydrate()`；管理员会话在 `useAdmin.ts`；无 auth hint → 无法在请求发出前预判是否要带认证头，也无法统一触发刷新 | 401 处理重复；启动时身份初始化时序不清晰 |
| WebSocket 与 Store 耦合 | `GameWebSocket` 类（~150 行）直接写在 `multiGame.ts` 内，和业务状态机、事件 handler 混在一起 | 无法独立测试 WS 层；连接策略（重试次数、退避、超时、连接状态 toast）无法复用到其他场景 |
| WS 错误静默 | `gameWs.onerror` 是空函数；`noteSocketConnectionFailure` 类策略不存在 | 连接失败只有在 Promise reject 时才暴露；中途断连用户无感知直到操作失败 |
| 无并发请求去重 | `refreshPlayer`、`ensureGuestSession` 类操作无 singleton Promise 保护 | 重复触发时多次打到后端，有竞态风险 |

#### 后端 8 个关键缺陷（本次联动修复）

| 问题点 | 现状描述 | 影响 |
|---|---|---|
| **玩家鉴权只能走 body** | `/api/draw` POST、`/api/guess`、`/api/player/update_id` 通过 `authenticatePlayer(db, { player_id: body.player_id, token: body.token })` 读取；GET 请求（draw GET、leaderboard）不传认证 | 前端拦截器无法统一注入；匿名/登录态混写在同一个函数分支，难以加透明 refresh |
| **CORS 未允许玩家 headers** | `allowHeaders: ['Content-Type', 'X-Admin-Token', 'Authorization']`，无 `X-Player-Id`、`X-Player-Token` | 即便前端发了 header，浏览器预检也会拦 |
| **`/api/player/init` 安全漏洞** | 只看 body.player_id 是否存在，**不校验 token**；知道他人 ID 即可拿到 `player.secret` | 严重越权；且该接口无法作为"refresh 会话"使用（根本不校验旧 token 合法性） |
| **响应体无 `error_code`** | 除唯一的 `SCRYPT_UNAVAILABLE`（426）外，所有错误只有 `{ status: 'error', message }`，无结构化错误码 | 前端拦截器无法区分 `AUTH_EXPIRED` / `AUTH_REQUIRED` / `BAD_CAPTCHA`，只能字符串匹配 message，无法稳定触发透明重试 |
| **管理员 401 也无 error_code** | `requireAdmin()` 返回 `error('未授权，请先登录', 401)` 无 code | 管理员拦截器无法根据 code 统一跳转 vs 正常业务失败 |
| **DO WS 鉴权失败无 JSON body** | `return new Response('Unauthorized', { status: 401 })` 纯文本 | 前端 socket 层解析不出 error_code，无法触发 `refreshAuthenticatedSession()` → 降级 → 重连链路，只能笼统 toast "网络错误" |
| **无 refresh / me 端点** | `initializeIdentity()` 在参考架构里调 `/auth/me` 或 `/auth/refresh`；本项目没有对应入口 | 启动身份刷新只能复用 `refreshPlayer` → 但它有安全漏洞 |
| **logout 纯客户端** | `POST /api/auth/logout` 空实现，直接返回 `success`；服务端不失效 secret | 玩家 token 一旦泄露永远有效，直到下一次登录才改 secret |

### 1.2 参考项目（csgofriberg）网络层核心架构

```
client/src/api/
├── client.ts          # ★ 核心：axios 实例 + 请求/响应拦截器 + errMsg()
│                      #   请求拦截：注入 PoW header、X-Auth-Expected header
│                      #   响应拦截：POW_REQUIRED→重做 PoW→重试；AUTH_EXPIRED→刷新会话→重试
│                      #   errMsg()：统一错误码→i18n 文案
├── authSession.ts     # ★ 认证会话 hint + 刷新（refreshAuthenticatedSession 单例 Promise）
├── session.ts         # 身份初始化：ensureGuestSession / initializeIdentity（含并发去重）
├── socket.ts          # ★ socket.io 单例管理：懒连接、连接失败阈值提示、恢复后提示、AUTH_EXPIRED 恢复、resourceVersion 广播
├── pow.ts             # 工作量证明（当前项目无需）
├── geetest.ts         # 极验（当前项目无需）
└── ...                # 其他业务模块 API 函数（业务函数只调 api.xxx()，不直接碰 fetch/axios）
```

**4 个核心设计模式（本次前后端联动迁移的就是这 4 个）：**

1. **`client.ts` 统一 HTTP 客户端 + 拦截器链**  
   - 业务代码从不直接调 fetch，只调 `api.get/post/put/delete`
   - 请求拦截器：统一注入 baseURL、Content-Type、玩家/管理员 header、认证期望 header
   - 响应拦截器：**透明重试**（AUTH_EXPIRED 自动刷新会话后重放原请求，业务层无感知）
   - `errMsg(err)`：一处集中错误码→用户可读消息映射

2. **`authSession.ts` 会话 hint + 单例 refresh**  
   - `localStorage` 存 `AUTH_HINT = '1'` / `ADMIN_HINT = '1'`，不存敏感信息
   - `hasAuthHint()` 可在**请求前**快速判断身份
   - `refreshAuthenticatedSession()` 用模块级 `refreshRequest` Promise 做并发去重，同时多个 401 触发只刷新 1 次

3. **`session.ts` 身份初始化层**  
   - `ensureIdentity()`：保证有身份；并发去重
   - `initializeIdentity()`：应用启动时跑一次，按 hint 决定是拉 `/auth/me`（新后端端点）还是走游客

4. **`socket.ts` WebSocket 单例管理层**  
   - 模块级 `socket` 单例 + `connectTask` / `identityRecovery` Promise 去重
   - 懒连接：`getGameSocket()` 首次调用才 connect
   - 连接状态通知策略：2 次失败才 toast 一次；恢复成功自动 toast + 清错误
   - AUTH_EXPIRED（后端 WS 错误码驱动）：自动 refreshAuthenticatedSession → 失败降级 → 重连

---

## 二、重构目标 & 边界

### 2.1 要做的（前后端联动对齐参考架构）

- [x] 引入 axios 作为 HTTP 客户端（替代裸 fetch + requestJson）
- [x] 建立 `src/api/client.ts`：axios 实例 + 请求/响应拦截器 + `errMsg()` + 透明重试（基于后端 error_code）
- [x] 建立 `src/api/authSession.ts`：AUTH_HINT / 单例 `refreshAuthenticatedSession()`
- [x] 建立 `src/api/session.ts`：`ensureIdentity()` / `initializeIdentity()` 启动初始化
- [x] 建立 `src/api/socket.ts`：抽离 WS 连接层，含连接状态提示 & AUTH_EXPIRED 身份恢复链路
- [x] **后端 Hono 新增 `error_code` 字段规范**：所有鉴权失败（玩家 401 / 管理员 401 / 业务失败）都带结构化 `error_code`；保持 `{ status, message }` 老字段不变以**向后兼容**
- [x] **后端 CORS 放开玩家鉴权 headers**：允许 `X-Player-Id` / `X-Player-Token`
- [x] **后端玩家鉴权统一为「header → body → query」三级回退**：`/api/draw` POST、`/api/guess`、`/api/player/update_id`、新增的 `/api/auth/refresh` 都支持 header 优先
- [x] **后端新增 `/api/auth/refresh`**：只接受 header 鉴权；成功 → 刷新 `players.secret` 并返回 `{ player, token }`；失败 → 401 + `AUTH_EXPIRED`
- [x] **后端新增 `/api/auth/me`**：鉴权方式同上；不刷新 secret，只返回当前玩家
- [x] **修复 `/api/player/init` 安全漏洞**：当请求携带鉴权信息（header 或 body token）时**必须先校验 token 匹配**才回 player；无鉴权时才创建匿名玩家
- [x] **后端 `POST /api/auth/logout` 服务端失效 secret**：登出时调用 `setPlayerSecret(db, playerId)` 轮换令牌
- [x] **后端 Durable Object WS 鉴权失败返回 JSON error_code**：不再是纯文本 `Unauthorized` 401，而是 `{ status:'error', message:'...', error_code:'AUTH_EXPIRED' \| 'AUTH_REQUIRED' }` 401；供前端 socket.ts 解析触发身份恢复链路
- [x] 迁移 `src/api/*.ts` 业务函数到新客户端（auth/game/leaderboard/acknowledgements）
- [x] 改造 `useAdmin.ts` 使用新客户端（管理员 401 自动跳转不再分散）
- [x] 改造 3 个 stores（auth/singleGame/dictionary）使用新会话层
- [x] 改造 48 处页面 try/catch 使用 `errMsg()`，移除重复错误文案硬编码

### 2.2 不做的（保持现有约束）

- ❌ **不迁移 PoW（工作量证明）注册防护**：当前项目后端无 PoW 校验
- ❌ **不迁移极验/邮件验证**：当前项目无此类功能
- ❌ **不迁移 i18n 框架**：`errMsg()` 直接用硬编码中文映射表（后续要加 i18n 时仅改这一处）
- ❌ **不把原生 WebSocket 换成 socket.io-client**：当前后端 Durable Object 用原生 WS 协议 + JSON 消息。socket 层保留原生 WS，但参考架构的**连接管理模式**
- ❌ **不引入 HttpOnly Cookie 会话**：当前 token 存在 localStorage，重构期间保持存储方式不变，否则要同步改 SameSite / Secure 策略
- ❌ **不强制拆除旧 body 鉴权路径**：后端永远保留 header → body → query 三级回退；前端拦截器只负责注入 header，业务 API 层过渡期可仍写 body（后端两者都认）；保证上线后老版本缓存客户端（没刷新浏览器的用户）仍可用
- ❌ **不拆除旧文件**：`src/api/http.ts`、`src/utils/http.ts` 保留但标记 deprecated，确保有过渡阶段可用

---

## 三、文件/模块变更清单

### 3.1 前端新增文件（4 个核心模块）

| 文件 | 职责 | 对齐参考 |
|---|---|---|
| `src/api/client.ts` | axios 实例、请求/响应拦截器、透明重试、`errMsg()` 映射 | `csgofriberg:client/src/api/client.ts` |
| `src/api/authSession.ts` | AUTH_HINT/ADMIN_HINT 读写、`refreshAuthenticatedSession()` 单例刷新 | `csgofriberg:client/src/api/authSession.ts` |
| `src/api/session.ts` | `ensureIdentity()` 身份保证、`initializeIdentity()` 启动初始化、并发去重 | `csgofriberg:client/src/api/session.ts` |
| `src/api/socket.ts` | 原生 WS 单例工厂、连接状态通知、AUTH_EXPIRED 身份恢复、`getGameSocket()` / `closeGameSocket()` | 参考 `csgofriberg:client/src/api/socket.ts` 模式，协议保持项目原生 JSON-over-WS |
| `src/composables/useToast.ts`（或等价机制） | 全局 toast 队列：`toast.error(msg,{id})` / `toast.dismiss(id)` / `toast.success(msg)` | 参考 `csgofriberg` 的 toast 实现，不引入第三方 UI 库 |

### 3.2 后端变更文件（本次新增联动）

| 文件 | 修改内容 | 风险级 |
|---|---|---|
| `functions/api/[[route]].ts` | ★ 重头戏：① `error()` 函数加可选 `error_code` 参数并写入响应 JSON；② 玩家鉴权 helper `requirePlayerAuth(c)` 实现三级回退（header → body）并统一返回 `AUTH_REQUIRED`/`AUTH_EXPIRED`；③ CORS `allowHeaders` 加 `X-Player-Id, X-Player-Token`；④ 修复 `/api/player/init` 安全漏洞；⑤ 新增 `/api/auth/refresh` 和 `/api/auth/me`；⑥ `/api/auth/logout` 服务端轮换 secret；⑦ `/api/draw` POST、`/api/guess`、`/api/player/update_id` 走新 `requirePlayerAuth`；⑧ 管理员 `requireAdmin` 也加 `error_code: 'ADMIN_AUTH_REQUIRED'` | **高**（核心后端改动，涉及鉴权和安全） |
| `worker-entry.ts` | ① `CORS_HEADERS` 加 `X-Player-Id, X-Player-Token`；② `handleWs()` 在 URL query 取不到时尝试从 `Sec-WebSocket-Protocol` subprotocol 头取 playerId/token（浏览器 WS API 无法自定义 header，Sec-WebSocket-Protocol 是业界通用 workaround，且 DO 层能透传）→ 路由前塞入 query，让 DO 代码无需改；③ DO 路由前对 WS 鉴权失败返回 JSON body，不再纯文本 | 中 |
| `cf-server/matchmaker-object.ts` | `verifyToken` 失败后返回 `new Response(JSON.stringify({ status:'error', message:'...', error_code: code }), { status: 401, headers:'Content-Type: application/json' })`；`code` 当 playerId/token 缺失为 `AUTH_REQUIRED`，当校验不匹配/secret 为空为 `AUTH_EXPIRED` | 中（DO 中还会发 S2C.ERROR 事件，两种都要有 code） |
| `cf-server/room-object.ts` | 同上，`verifyToken` 失败返回结构化 JSON 401 | 中 |
| `src/lib/players.ts` | 可选：`authenticatePlayer` 增加返回值变体区分「缺失」vs「不匹配」或保留返回 null 但调用方根据输入判空来分别抛 AUTH_REQUIRED vs AUTH_EXPIRED | 低（纯新增语义区分，不改变函数签名） |

### 3.3 前端需修改文件

| 文件 | 修改内容 | 风险级 |
|---|---|---|
| `package.json` | 添加 `axios` 依赖（当前未安装） | 低（纯新增） |
| `src/api/auth.ts` | 函数体从 `requestJson()` 切到 `api.post()`/`api.get()`；新增 `refreshSession()` 包装 `/api/auth/refresh`；新增 `me()` 包装 `/api/auth/me` | 中 |
| `src/api/game.ts` | 同上，切换到 `api.get/post`；**过渡期** player_id/token 仍写 body（后端已支持 header 优先 + body 回退，双写保证老缓存兼容） | 中 |
| `src/api/leaderboard.ts` | 切换到新客户端 | 低 |
| `src/api/acknowledgements.ts` | 切换到新客户端；admin headers 改为由拦截器根据 `hasAdminHint()` 自动注入，函数去掉 headers 参数（破坏性变更，调用方同步删参数） | 中（函数签名变化→调用方也要改） |
| `src/api/index.ts` | 新增导出：`api`, `errMsg`, `ensureIdentity`, `initializeIdentity`, `hasAuthHint`, `refreshAuthenticatedSession`, `getGameSocket`, `closeGameSocket` | 低 |
| `src/api/http.ts` | 所有导出标记 `@deprecated`，内部实现委托给新 client 兜底（过渡期双写） | 低 |
| `src/utils/http.ts` | 标记 `@deprecated`，re-export 指向不变 | 低 |
| `src/composables/useAdmin.ts` | ① 登录/登出切到新 client；② `adminHeaders()` deprecated，改为由请求拦截器自动注入；③ `handleAdminApiError` 改为由 `client.ts` 拦截器在 401 + hasAdminHint 时自动调 | 中（和 acknowledgements 联动） |
| `src/stores/auth.ts` | ① `hydrate()` 改为调用 `initializeIdentity()`（内部用 `/api/auth/me`）；② `login/register/upgradePassword` 成功后 `markAuthenticated()`；③ `logout()` 先调后端 logout（轮换 secret）再清会话；④ `refreshPlayer` 做并发去重 | 中 |
| `src/stores/singleGame.ts` | 调用面不变（走 `@/api` 导出，API 层已切）；catch 中错误文案改 `errMsg()` | 低 |
| `src/stores/dictionary.ts` | 同上 | 低 |
| `src/stores/multiGame.ts` | ① 删除内联 `GameWebSocket` 类（~150 行）→ import 自 `socket.ts`；② `gameWs` 改为 `getGameSocket(path, { playerId, token })` 返回单例；③ 连接状态 toast 策略改由 `socket.ts` 统一触发；④ 保留业务事件处理（ROOM_STATE 等）和业务状态机 | **高**（核心逻辑最大块） |
| `src/App.vue` | 启动流程改为先 `initializeIdentity().catch(toast)` 再 `resumeRoom()` | 低 |
| `src/components/shared/StatusBanner.vue` 或 `App.vue` 根节点 | 挂载全局 toast 队列渲染层（配合 `useToast.ts`） | 低 |
| `src/pages/*.vue` 共 ~48 处 catch 块 | 错误文案从手写字符串改为 `errMsg(reason)`；管理员页面对 401 的特判可删除（拦截器已统一处理跳转） | 低（批量替换，单处改动极小但量大） |

---

## 四、实施步骤（分阶段，建议每阶段自测后再推进下一阶段）

### 阶段 0：前置准备

1. **安装 axios**
   - `pnpm add axios`（纯前端库，无需改 vite.config）

2. **准备全局通知机制**
   - 新建 `src/composables/useToast.ts`：基于 `reactive([])` 全局队列 + `let _counter = 0` 生成 id
   - 暴露 `toast.error(msg, { id?: number }): number` / `toast.dismiss(id)` / `toast.success(msg): number`
   - `App.vue` 根节点渲染队列为 fixed bottom-right stack，3.5s 自动 dismiss（error 默认不自动关闭，需要 dismiss 才关）
   - 拦截器和 socket 层**只依赖 toast API**，不耦合 UI 组件实现

### 阶段 1：先改后端（保证新协议可用，老协议 100% 兼容 —— 先上线后端再做前端）

3. **改 `functions/api/[[route]].ts` 的基础设施**
   1. `error(message, status = 400, error_code?: string)` 第 3 个参数；响应 JSON 追加 `error_code: error_code ?? undefined`
   2. CORS `allowHeaders: ['Content-Type', 'X-Admin-Token', 'Authorization', 'X-Player-Id', 'X-Player-Token']`
   3. 抽新 helper：
      ```ts
      async function readPlayerAuth(c: any): Promise<{ player_id: string; token: string } | null> {
        const h_pid = String(c.req.header('X-Player-Id') ?? '').trim();
        const h_tok = String(c.req.header('X-Player-Token') ?? '').trim();
        if (h_pid && h_tok) return { player_id: h_pid, token: h_tok };
        const body = await readJson(c); // 幂等缓存或二次读（Hono req.json 内部有一次性语义，需改造 readJson 存 context 变量避免两次解析冲突）
        const b_pid = String(body.player_id ?? '').trim();
        const b_tok = String(body.token ?? '').trim();
        if (b_pid && b_tok) return { player_id: b_pid, token: b_tok };
        return null;
      }
      async function requirePlayerAuth(c: any): Promise<{ ok:false, resp:Response } | { ok:true, player: Player, auth: {player_id, token} }> {
        const auth = await readPlayerAuth(c);
        if (!auth) return { ok:false, resp: error('缺少玩家身份凭证', 401, 'AUTH_REQUIRED') };
        const db = c.get('db');
        const player = await authenticatePlayer(db, auth);
        if (!player) return { ok:false, resp: error('玩家身份校验失败或已过期，请重新登录', 401, 'AUTH_EXPIRED') };
        return { ok:true, player, auth };
      }
      ```
   4. 抽 `requireAdmin(c)` 也改为抛 `error('未授权，请先登录', 401, 'ADMIN_AUTH_REQUIRED')`

4. **修复 `/api/player/init` 安全漏洞 + 新增 `/api/auth/refresh` & `/api/auth/me`**
   - `/api/player/init`：
     ```ts
     app.post('/api/player/init', async (c) => {
       const db = c.get('db');
       const auth = await readPlayerAuth(c); // header 或 body
       if (auth) {
         // 带鉴权 → 必须匹配
         const player = await authenticatePlayer(db, auth);
         if (!player) return error('身份校验失败或已过期，请重新登录', 401, 'AUTH_EXPIRED');
         return c.json(success({ player: publicPlayer(player)!, token: player.secret }));
       }
       // 无鉴权 → 匿名创建/查找（仅依据 player_id）
       const body = await readJson(c);
       const playerId = String(body.player_id ?? '').trim();
       if (!playerId) return error('缺少玩家ID');
       const player = await ensurePlayer(db, playerId);
       return c.json(success({ player: publicPlayer(player)!, token: player.secret }));
     });
     ```
   - 新增 `POST /api/auth/refresh`（强制 header 鉴权，不接受 body）：
     - 读 header → 校验 → 成功：`setPlayerSecret(db, pid)` 生成新 secret → 返回 `{ player, token: newSecret }`（每次 refresh 都轮换 token，旧 token 立即失效——这是拦截器透明刷新能失效旧会话的关键）
     - 失败：401 + `AUTH_EXPIRED`
   - 新增 `GET /api/auth/me`（header 优先，body 回退）：不刷新 secret，仅 `{ player: publicPlayer(p) }`；失败 401

5. **改造 `/api/auth/logout` 服务端失效 secret**
   - 先 `readPlayerAuth` → 若能定位到玩家 → `setPlayerSecret(db, playerId)` 换 secret；无论成功与否都返回 success（best-effort，避免客户端因登出失败卡住）

6. **改造 `/api/draw` POST、`/api/guess`、`/api/player/update_id`、`/api/player/score` 走 `requirePlayerAuth`**
   - `/api/draw` POST：`requirePlayerAuth` 失败直接返回错误；成功则用 player id 写 target
   - `/api/guess`：带鉴权走服务端 target 分支；否则走匿名 body.target 分支（保持现有）
   - `/api/player/update_id`：必须 `requirePlayerAuth` 成功且 player_id 与 `old_id` 一致
   - `/api/player/score`：原有查询可接受公开查询（排行榜要能查），所以**不强制鉴权**；只改 `readPlayerAuth` 鉴权成功时加回更多私密字段（后续扩展，当前不动）

7. **WS 侧协议对齐（`worker-entry.ts` + 两个 DO）**
   - `worker-entry.ts`：
     1. CORS_HEADERS 同步加玩家 headers
     2. `handleWs` 增加：URL query 缺 playerId/token 时，尝试从 `Sec-WebSocket-Protocol` 解析（格式约定 `x-pid.${base64(playerId)}` / `x-tok.${base64(token)}`，解析成功后把这两个 subprotocol 去掉再 forward，避免后端 DO 识别为子协议）；解析完塞回 `url.searchParams`，后续 `routeWs` 零改动
     3. 当最终仍缺 playerId/token 时，返回 JSON：`{ status:'error', message:'缺少 playerId 或 token 参数', error_code:'AUTH_REQUIRED' }`，状态 401
   - `cf-server/matchmaker-object.ts` 中 `verifyToken` 失败分支：
     - `!playerId || !token` → 401 JSON `AUTH_REQUIRED`
     - 校验失败 / DB 查不到 secret → 401 JSON `AUTH_EXPIRED`
     - DO 内部给 WS 客户端发 `S2C.ERROR` 事件时也附加 `payload.code = 'AUTH_EXPIRED'`（双重保障：升级失败时 HTTP 401 可读，连接成功后鉴权失败时 S2C 事件可读）
   - `cf-server/room-object.ts`：同上

**阶段 1 完成标志：** 部署后端到 staging → 用 curl 验证：
```bash
# 1. 匿名 init 仍可用（向后兼容）
curl -X POST /api/player/init -d '{"player_id":"alice"}'  → 期望 success + token
# 2. 带 header refresh 成功
curl -X POST /api/auth/refresh -H 'X-Player-Id: alice' -H 'X-Player-Token: <刚才的token>' → 期望 success + 新 token（轮换）
# 3. 用旧 token refresh 失败（已轮换）
curl -X POST /api/auth/refresh -H 'X-Player-Id: alice' -H 'X-Player-Token: <旧token>' → 期望 401 AUTH_EXPIRED
# 4. 不带任何 header 调 refresh → 401 AUTH_REQUIRED
# 5. /api/player/init 给了 player_id 但给错 token → 401 AUTH_EXPIRED（安全漏洞修复生效）
# 6. DO WS 返回 JSON：对不存在的 token 连 /ws/matchmaker?playerId=x&token=bad → 期望 response JSON 含 error_code
```

### 阶段 2：建立 4 个前端核心模块（不动业务代码）

8. **实现 `src/api/client.ts`**
   - axios 实例：`baseURL: import.meta.env.VITE_API_BASE || '/api'`，`timeout: 15000`
   - **请求拦截器**：
     - Content-Type: application/json（axios 默认）
     - `hasAuthHint()` → 从 authStore 取 playerId/token → 注入 header `X-Player-Id` / `X-Player-Token`（后端已支持 header 优先）；另设 `X-Auth-Expected: '1'`（纯调试标记）
     - `hasAdminHint()` → 从 adminToken ref 取 → 注入 `X-Admin-Token` header
     - 请求级 `X-Request-Id: crypto.randomUUID()`（方便在 Worker 日志 grep）
   - **响应拦截器成功分支**：
     - 若 `data.status === 'error'`（后端 200 但业务失败，实际罕见，但我们之前 `error()` 都带 HTTP status !== 200，这个分支主要是防御）→ 合成 axios error 走 catch
     - `return response.data`（解包 axios data，与 `requestJson` 返回层级一致）
   - **响应拦截器错误分支**（重点：透明重试）：
     - 标记 `config._authRetried` / `config._adminRetried`（布尔）防无限重试
     - `isAxiosError` + `response?.status === 401`：
       - 玩家会话：`data.error_code === 'AUTH_EXPIRED'` → `refreshAuthenticatedSession()` → 成功则 `return api.request(config)` 重放原请求；失败则清 hint 并抛原错（业务层 catch）
       - 玩家会话：`AUTH_REQUIRED` → 说明用户根本没登录，hint 应为假；不刷新，直接抛错
       - 管理员会话：`error_code === 'ADMIN_AUTH_REQUIRED'` → 清 admin hint → 调 `handleAdminApiError`（通过 useAdmin 绑定的 router 跳登录） → 抛错
     - `!error.response`（网络失败/超时）→ 标准化为 `NETWORK_ERROR`
     - 其他 HTTP status：原样抛出，带 `data.error_code`
   - 实现 `errMsg(err: unknown): string`：
     - 错误码映射表（初始）：`NETWORK_ERROR → '网络连接失败，请检查网络后重试'`，`AUTH_EXPIRED → '登录状态已过期，请重新登录'`，`AUTH_REQUIRED → '请先登录'`，`ADMIN_AUTH_REQUIRED → '管理员登录已过期，请重新登录'`，`SCRYPT_UNAVAILABLE → '当前环境不支持旧密码验证，请重置密码'`，`INTERNAL_ERROR → '服务器内部错误，请稍后重试'`
     - 兜底：优先取 `error.response?.data?.message`（后端 `message` 字段，如"验证码错误或已过期"）→ 取 `error.message` → 最终 `'请求失败'`
     - 管理员 `handleAdminApiError` 的 401 判定逻辑已移到拦截器统一处理，但函数保留给外部直接用

9. **实现 `src/api/authSession.ts`**
   - `AUTH_HINT = 'phrolova_auth_hint'`，`ADMIN_HINT = 'phrolova_admin_hint'`
   - `markAuthenticated()`：localStorage.setItem(AUTH_HINT, '1')，**并兼容老用户迁移**：若 `hasAuthHint() === false` 但 localStorage 里 `phrolova_player_token` 非空 → 自动补 hint（避免首次升级后老用户全部被登出）
   - `clearAuthenticated()`：remove AUTH_HINT；**不清 token 本体**（由 authStore.clearSession 负责，避免顺序耦合）
   - `markAdmin / clearAdmin / hasAdminHint`：同上对 ADMIN_HINT
   - `hasAuthHint()`：**兼容双判断**：localStorage 读 AUTH_HINT === '1' **OR** `localStorage.getItem('phrolova_player_token')` 非空；命中前者返回 true；命中后者自动补写前者并返回 true（一次性迁移）
   - `refreshAuthenticatedSession(force=false): Promise<boolean>`
     - 模块级 `refreshRequest: Promise<boolean> | null = null`（并发去重）
     - 实际刷新：调 `api.post('/auth/refresh')`（这个请求本身也会被请求拦截器注入 X-Player-* headers，所以不传参数）
     - 成功 → `markAuthenticated()`；**把返回的新 player 和新 token 同步到 authStore**（因为 refresh 每次都轮换 secret！所以本地 token 必须更新，否则下个请求仍用旧 token → 401 死循环）；返回 `true`
     - 401 AUTH_EXPIRED → `clearAuthenticated()` + authStore.clearSession；返回 `false`
     - 其他错误 → 向外抛（由拦截器决定是否再 force=true 重试一次，参考项目 POW 模式）

10. **实现 `src/api/session.ts`**
    - `ensureIdentity()`：如果 `hasAuthHint()` 直接 resolve；否则 fire-and-forget 匿名 init（向后兼容的老匿名开局逻辑，这里可不做任何网络调用）
    - `initializeIdentity(): Promise<void>`
      - 模块级 `_initTask` 防并发重复初始化
      - 有 hint → `api.get('/auth/me')`；成功 → authStore.applyPlayer(player)；401 → `clearAuthenticated()` + authStore.clearSession + toast.error(errMsg)；其他错误 → toast
      - 无 hint → authStore.clearSession 清残留；保证状态干净
      - finally → authStore.setInitialized()（如果 store 有 initialized ref；没有就新增一个，避免 UI 闪烁"未登录→已登录"跳变）

11. **实现 `src/api/socket.ts`（原生 WebSocket，但管理模式对齐参考）**
    - **先 1:1 搬 `multiGame.ts` 里的 `GameWebSocket` 类**（保证功能不变）
    - 模块级变量：
      - `_socket: GameWebSocket | null = null`（单例；但不同 path 需要不同实例 → 改成 `Map<path, GameWebSocket>` 或根据 path 区分：matchmaker 和 room 是不同连接，所以不能纯全局单例。改成 `_instances = new Map<string, { ws: GameWebSocket, refCount:number }>()`，按 path 缓存并引用计数；`getGameSocket(path)` 复用同一连接，`releaseGameSocket(path)` 减引用，到 0 时 disconnect + 删）
      - `_connectTasks = new Map<string, Promise<GameWebSocket>>()`
      - `_identityRecovery: Promise<void> | null = null`（只允许一个身份恢复流程在飞）
      - `_failedConnectionsByPath = new Map<string, number>()`，`SOCKET_FAILURES_BEFORE_NOTICE = 2`
      - `_errorNotifiedByPath = new Map<string, { notified:boolean, toastId:number }>()`
    - 导出：
      - `getGameSocket(path: string, { playerId, token }): Promise<GameWebSocket>`：懒连接 + 复用 + 引用计数
      - `releaseGameSocket(path: string): void`
      - `closeGameSocketAll(): void`（退出登录 / 切账号时用）
      - `subscribeSocketStatus(path, listener)` 可选
    - 关键行为（对齐参考）：
      - **连接成功**（onOpen）：清失败计数，若该 path 之前有 error toast → dismiss + toast.success('连接已恢复')
      - **连接失败**（await connect() reject / onclose 在 didOpen=false 之前）：计数 +1；累计到阈值 → `toast.error('网络连接失败')` 且只弹一次；若失败错误里带 `AUTH_EXPIRED` error_code（worker-entry 返回的 JSON 可在 `new WebSocket(url)` 打开阶段失败时拿到吗？浏览器不行，因为 WS 升级失败不会返回 response body，只会抛普通 Event。所以 HTTP 升级 401 的 code 只能靠前端当前 path + 当前 hint 推断？或者我们在 WS 握手成功后发送 `C2S.AUTH` 消息，服务端回 `S2C.AUTHED` 或带 code 的 `S2C.ERROR`。**结论：把 WS 层鉴权错误码的主要来源改为 S2C.ERROR，而不是 HTTP upgrade 401 body**。这样 DO 内部回 S2C.ERROR(payload={ message, code: 'AUTH_EXPIRED' }) 时，socket.ts 的 onMessage 拦截器就能捕获：
        - `gameWs.onMessage` 先过一层 `socket.ts` 的"系统事件拦截"：若 msg.type === S2C.ERROR && payload.code === 'AUTH_EXPIRED' → 触发 `_identityRecovery = refreshAuthenticatedSession().then(ok => ok ? reconnectSamePath() : toast.error + 清 hint)`；业务层（multiGame store）的 onMessage 依然能收到该错误，不受影响
      - **中途断开（onClose 已 didOpen=true）**：现有指数退避重连保留；但重连多次失败（每重连一次计数+1）达到阈值也要走 toast 错误；重连成功自动清错误
      - **懒连接 + 身份恢复 + 去重**：完全对齐参考架构的 `prepareSocketIdentity` / `syncSocketAuthIntent` / `recoverSocketIdentity` 三件套（只是把 socket.io 的 `target.auth = { authenticated: hasAuthHint() }` 换成"连接 URL query 保证是最新 playerId/token"；因为 token 可能在 refresh 后轮换，所以 `connect()` 内部每次 buildUrl 时都要从 authStore 取最新的，不要缓存）

### 阶段 3：迁移前端业务 API 层（调用面不变，内部切实现）

12. **迁移 `src/api/auth.ts`** — 函数签名 100% 不变；把 `requestJson<T>` → `api.post<T>` / `api.get<T>`；新增 `refreshSession()` 包装 `/auth/refresh`（给 authSession 内部调用）；新增 `me()` 包装 `/auth/me`

13. **迁移 `src/api/game.ts`** — 同上；**过渡期双写兼容**：player_id/token 同时写在 body（后端支持 body 回退）+ 请求拦截器注入 header（后端 header 优先）。等 99% 用户刷新浏览器后，再单独发一个小 PR 移除 body 双写

14. **迁移 `src/api/leaderboard.ts`** — 最简单，替换实现

15. **迁移 `src/api/acknowledgements.ts`**
    - 函数签名改：删除 `headers: Record<string, string>` 第一个参数（改成由请求拦截器自动注入 `X-Admin-Token`）
    - 同步改所有 admin 页面调用方：`adminFetchAcknowledgements(adminHeaders())` → `adminFetchAcknowledgements()`

16. **更新 barrel 导出 & 标记 deprecated** — 参见章节 3.3

### 阶段 4：改造会话/身份管理层（Store & Composable）

17. **改造 `src/stores/auth.ts`**
    - 新增 `initialized: shallowRef(false)`；暴露 `setInitialized()`（供 session.ts 调用，或 session.ts 直接 set）
    - `login/register/upgradePassword` 成功后追加 `markAuthenticated()`
    - `logout()` 改为：先 `await api.logout()`（最佳努力，catch ignore）→ `clearAuthenticated()`（authSession）→ `clearSession()`（现有）
    - `hydrate()` 改为：内部 `return initializeIdentity()`，不要再自己调 `refreshPlayer()`
    - `refreshPlayer()` 加模块级 `_refreshTask: Promise<void> | null` 并发去重（虽然 hydrate 不再调用它，但是 startGame submitGuess 后还会调它同步分数，所以仍要）
    - `updatePlayerId()` 成功后确保 hint 仍有效

18. **改造 `src/composables/useAdmin.ts`**
    - `doAdminLogin()` 成功后追加 `markAdmin()`
    - `doAdminLogout()` → `clearAdmin()`；并触发路由跳转（原逻辑保留）
    - `adminHeaders()` 保留但 `@deprecated` 注释
    - `handleAdminApiError()` 保留函数签名，但实际由 `client.ts` 拦截器在 401 + ADMIN_AUTH_REQUIRED 时自动调用它（通过 import 直接调，避免循环依赖：`client.ts` → `useAdmin.ts` → `client.ts`？解决：`useAdmin.ts` 里提供 `registerAdminAuthExpiredCallback(fn)` 注册点，拦截器只调这个回调，不直接 import useAdmin router）

### 阶段 5：抽离 WS 层 + 页面错误文案替换

19. **抽离 `GameWebSocket` → 多步回滚**
    - Step A：整块复制到 `socket.ts` 不改逻辑 → multiGame 中改成 `import { GameWebSocket } from '@/api/socket'`；**自测所有 WS 链路（建房间、匹配、对战、重连）完全通过**（这步保证能回滚）
    - Step B：把 `new GameWebSocket(baseUrl, pid, tok).connect(path)` 全部替换为 `getGameSocket(path, { playerId: pid, token: tok })`（内部调用 GameWebSocket）；引用计数正确管理；multiGame 里的 `gameWs.disconnect()` 改为 `releaseGameSocket(path)`
    - Step C：socket.ts 内叠加"连接状态阈值 toast / 恢复 toast / AUTH_EXPIRED 身份恢复 / 并发去重"
    - Step D：multiGame 里删掉自己对 `connectionState = "idle"` 在 onClose 时的粗粒度错误设置（因为全局已经有 toast），只保留业务状态机需要的 infoMessage / inQueue / roomState

20. **`App.vue` 启动时序改造** — 原 `onMounted` → 先 `initializeIdentity().catch(e => toast.error(errMsg(e)))` → 再 `multiGameStore.resumeRoom().catch()`

21. **~48 处页面 catch 块统一用 `errMsg()`**
    - 搜索模式：`reason instanceof Error ? reason.message : "xxx失败"`
    - 批量替换为：`import { errMsg } from '@/api'` + `errMsg(reason)`
    - 管理员页面 catch 中 `handleAdminApiError(err)` 保留（与拦截器并行调用没问题：拦截器已经跳了，函数自己再判一次 401 不会重复跳）

### 阶段 6：联调 + 回归 + 清理

22. **TypeScript 编译**：`pnpm exec tsc --noEmit` 必须 0 error

23. **关键链路自测清单（每条写回归记录，全部通过才能合入）**

    **后端（阶段 1 就已过一遍，这里再做一遍用真实前端测）**
    - [x] 匿名玩家：首页点击"开始游戏"→ 走 `/api/player/init` 不带 header → 仍能创建 / 返回 token（向后兼容）
    - [x] 注册新用户 → 登录 → 刷新页面 → `initializeIdentity()` 用新 `/api/auth/me` → 用户仍显示登录
    - [x] 登录后：把 localStorage 的 AUTH_HINT 手动删掉（模拟 hint 缺失但 token 仍在）→ 刷新页面 → `hasAuthHint` 的"双判断 + 自动补写"逻辑触发 → 用户仍显示登录（登出潮规避）
    - [x] token 过期测试：临时改 `SESSION_TTL=30s` + 调一个 API 打 KV 过期加速 → 前端再调一次 draw → 拦截器收到 `AUTH_EXPIRED` → 自动走 `/api/auth/refresh` → **如果 refresh 成功**（KV 没过期，仅 secret 匹配失败？或者手动把 players.secret UPDATE 成别的）→ 验证 secret 是否真的轮换（旧 token 再用 refresh 失败）；**如果 refresh 失败 KV 过期** → 清 hint + toast 登录过期
    - [x] 管理员登录 → ack 增删改查 → 等 session 过期 → 下一个请求触发拦截器检测 `ADMIN_AUTH_REQUIRED` → 自动跳登录页 + redirect query

    **WS 层**
    - [x] 创建房间 → 另一窗口加入 → 走一局 BO1（resonator） → 正常结束
    - [x] 随机匹配 → 进入房间后**手动在 DevTools 断网 3 秒** → 自动重连成功 → toast "连接已恢复"；inQueue / roomState 状态是否保留
    - [x] 匹配中 → **手动 UPDATE players.secret = 'BAD'**（模拟 token 失效）→ 下一次 HEARTBEAT 或任何服务端校验 → S2C.ERROR(AUTH_EXPIRED) → socket.ts 拦截到 → `refreshAuthenticatedSession()` 因 token 坏而失败 → 清 hint + toast 登录已过期

    **前端错误文案**
    - [x] 故意断网 → 点击"开始游戏"→ `errMsg` 显示"网络连接失败"
    - [x] 验证码错误 → 显示后端 message 字段的"验证码错误或已过期"
    - [x] 排行榜翻页 → 正常（无任何改动退化）

24. **清理 deprecated 文件（可选，或留到下一个迭代）**
    - `src/utils/http.ts` 可删除
    - `src/api/http.ts` 若 0 引用可删除，否则保留一个 minor 版本

---

## 五、潜在依赖 & 注意事项

### 5.1 新增依赖
- **axios**：`^1.7.x` 或最新稳定版。纯前端库，~40KB gzipped，无 server 端风险

### 5.2 关键兼容注意点
1. **响应解包 + `status==='error'` 转 catch**：axios 拦截器成功分支里检测 `data.status === 'error'` 手动 `Promise.reject`。这是对齐现有 `requestJson()` 行为（后端 HTTP 200 也可能业务失败？实际本项目后端 `error()` 函数都带非 200 status，所以这个分支可能 99% 走不到，但一定要写避免某个新接口写错 HTTP status 时业务层没进 catch 而出 bug）
2. **后端 player token 位置**：过渡期前端拦截器**同时**注入 header **和**业务 API 写 body（双写）；后端实现 header → body → query 三级回退。保证线上有 5% 未刷新浏览器的老缓存客户端仍可用（他们只写 body）。观察 2~3 天后再移除 body 双写
3. **WS `Sec-WebSocket-Protocol` hack**：浏览器原生 WebSocket 无法自定义 header；业界通用 workaround 是把 token 编码到子协议字段。要注意 DO 端实际握手时返回的 `Sec-WebSocket-Protocol` 必须包含浏览器发送中的一个，否则浏览器会关闭连接（RFC 6455）。所以我们只发非标准前缀 `x-pid.xxx` / `x-tok.xxx` 两个子协议，worker-entry.ts 在 forward 给 DO 前**把这两个子协议从请求头里删掉**，让 DO 层 `new WebSocketPair()` 走正常无协商子协议的握手路径。如果直接带子协议而 DO 没回对应子协议，浏览器会 1002 协议错误关闭 → 这是一个巨坑，**上线前务必单独测 WS 子协议链路**
4. **管理员函数签名变化**：`adminFetchAcknowledgements(headers)` → `adminFetchAcknowledgements()` 破坏性变更；集中在 `AdminAcknowledgementsPage.vue` / `AdminTablePage.vue` / `AdminDiffPage.vue` / `AdminShell.vue` 4 处，必须一次改完

### 5.3 风险处理

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `/api/player/init` 安全修复导致老客户端"奇怪地登出" | 有些老缓存代码可能调用 init 时带了随机 player_id 但 token 为空字符串 → 修复后会返回 AUTH_EXPIRED | 在 `readPlayerAuth` 中判定 token 长度 < 20 时视为"未携带"（即 null），不进入"必须校验"分支。只有真正带了合法长度 token 时才强校验。这样空字符串 token 仍走匿名流程 |
| WS `Sec-WebSocket-Protocol` 处理不当导致 WS 连不上 | 所有多人模式瘫痪 | 把该逻辑包在一个条件里：仅当 URL query 缺失时才尝试从子协议解析；解析失败不抛错，直接返回原 query 缺失的 AUTH_REQUIRED。本地 dev 先用浏览器 DevTools Network → WS 面板抓包确认握手成功 |
| axios 引入打包体积 +40KB | 首屏加载稍慢 | axios gzip 约 15KB；若真要压缩可改用 `ofetch`（unjs）但要手写拦截器实现，工作量翻倍。先上 axios，后续真有体积压力再切换 |
| 拦截器透明重试导致的竞态 | 刷新会话时并发请求排队 | `refreshAuthenticatedSession()` 已做单例 Promise 去重；`_authRetried` 标记防循环；所有重试最多 1 次 |
| WS 层抽离时引入重连回归 | 用户房间中断 | **先搬代码（阶段 5 Step A）**，完全 1:1 无改动跑通所有链路再叠加策略；每步都能 `git checkout -- src/stores/multiGame.ts` 回滚 |
| 大量页面 catch 替换漏网 | 个别页面错误文案不统一 | 分模块：Admin → Auth → Home → Game → Multi → Leaderboard；每块替换后 `grep -n "instanceof Error ? reason.message"` 确保 0 残留 |
| 老用户首次升级登出潮体验差 | AUTH_HINT 缺失 → 自动清会话 → 老用户全被踢 | `hasAuthHint()` 双判断：hint 存在**或** token 存在。后者命中时**自动 `localStorage.setItem(AUTH_HINT,'1')` 迁移一次，保证无感升级 |
| Refresh 轮换 secret 导致 authStore 里 token 没同步 → 下个请求仍用旧 token → 死循环 401 | 拦截器永远以为下一次能成功而不停 retry 1 次 | `refreshAuthenticatedSession` 成功后必须立刻把返回的 `token`（新 secret）写入 `authStore.token.value`；`player` 也同步。拦截器 `_authRetried` 标记保证最多重试 1 次，失败就抛给业务层 catch，不会无限循环 |
| `readPlayerAuth` 两次 `c.req.json()` 报错（Hono 请求体流只读一次） | 所有需要读 body 的接口在 header 鉴权失败后再读 body 鉴权会抛 BodyAlreadyConsumed | 改造 `readJson`：第一次解析后存入 `c.set('parsed_body', body)`；后续调用直接取 `c.get('parsed_body')` 缓存，避免两次读流。Hono 新版 `c.req.json()` 已自带缓存，但为兼容显式写一次更安全 |

---

## 六、预期收益（做完后拥有参考架构的 4 个核心能力 + 后端协议对齐）

### 前端能力
1. **透明会话刷新**：token 过期用户无感，拦截器 refresh 成功 → 轮换 secret → 原请求重放；业务层 catch 完全收不到
2. **一处错误码映射**：所有新增错误码只改 `errMsg()` 一张表；网络失败/超时/解析失败统一文案
3. **WS 连接状态对用户可见**：弱网 / 后台切换后断连有阈值提示；恢复成功 toast 反馈；AUTH_EXPIRED 触发身份恢复链路
4. **并发去重**：身份初始化 / 身份刷新 / WS 连接 / 身份恢复 4 个高频操作不会并发打后端；减少 D1/KV QPS 压力与竞态

### 后端能力
5. **鉴权安全漏洞修复**：`/api/player/init` 不再泄露他人 secret；logout 真正失效旧 token
6. **结构化 `error_code`**：前后端通过 `AUTH_REQUIRED` / `AUTH_EXPIRED` / `ADMIN_AUTH_REQUIRED` 强类型协作；不再靠字符串匹配 message
7. **Header 优先的三层鉴权回退**：前端拦截器可统一注入 token，业务层无需每处手写
8. **Refresh 轮换机制**：每次 refresh 生成新 secret；被泄漏的旧 token 立即失效；攻击窗口大幅缩小
9. **结构化 WS 鉴权**：S2C.ERROR 带 `code`；前端 socket 层能稳定触发身份恢复自动重连；不再只靠"网络错误"兜底

---

## 七、不做的功能及原因（和参考项目的差异边界）

| 参考项目的能力 | 当前不迁移原因 | 后续可加 |
|---|---|---|
| PoW（工作量证明）注册防护 | 后端无对应校验逻辑 | 若后端接入 Drizzle + Queue + KV 做 PoW 校验可补 |
| GeeTest 行为验证 | 无此需求 | 有反作弊需求时加 |
| 邮箱验证 + verified matchmaking | 账号体系无邮箱字段 | 加邮箱列 + Resend/SMTP Worker 后可加 |
| i18n 多语言 | 当前项目全中文 | 出海时：`errMsg()` 映射表接 `vue-i18n` 即可，调用面不变 |
| socket.io-client 协议 | 服务端 Durable Object 用原生 WS | 若后端切 socket.io-adapter + Redis 可改 |
| HttpOnly Cookie 会话 | 要改后端 setCookie + SameSite/Secure + 前后端跨域策略，工程量大 | 后续可和 refresh token 旋转 + revoke list 机制一起改 |
| PoW 透明重试链路（POW_REQUIRED code → 重做 PoW → 重放） | 后端无 PoW 校验 | 上 PoW 后直接加拦截器分支即可 |

---

## 八、执行顺序与推荐发布节奏（减小风险）

1. **PR-1（纯后端，无前端）**：阶段 1 全部（error_code + CORS + requirePlayerAuth + 安全修复 + 新端点 + DO 返回 JSON code）→ staging 验证所有 curl 用例 → 生产
2. **PR-2（纯前端，不依赖 PR-1 新接口也能跑）**：阶段 0 + 阶段 2 client/authSession/session 新建 + 阶段 3 业务 API 迁移 + 阶段 4 stores/composables 改造 + 阶段 5 文案替换（保留原 `/player/init` 调用）→ 生产上线；此时用户还不会触发透明 refresh（因为还没上 `/api/auth/refresh` 的前端调用），但所有新架构的其他能力（errMsg 统一、拦截器基础、toast）已经生效
3. **PR-3（前端启用 refresh 链路 + socket 抽离）**：阶段 2 socket.ts + 阶段 5 WS 抽离（Step A/B/C/D）+ authSession 真正调用 `/api/auth/refresh`；依赖 PR-1 后端已经上线；此 PR 后透明刷新和 WS 身份恢复能力打开
4. **PR-4（可选的收尾）**：移除 deprecated 文件；移除 API 函数中的 body 双写 token（只剩拦截器 header）；移除 WS query 传 token（走 Sec-WebSocket-Protocol 子协议）

这样拆分后任何一个 PR 出问题都能单独回滚，不会一次上一大片改不动。

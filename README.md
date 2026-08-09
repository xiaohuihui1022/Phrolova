# Phrolova / 弗一把

> 鸣潮角色猜谜游戏 — 基于角色属性与声骸信息的 Web 多人猜谜对战平台

面向中文用户的全栈 TypeScript 项目，部署在 Cloudflare 全球边缘网络：**Pages** 托管前端，**Workers** 运行 API 与实时 WebSocket，**D1** 提供零配置 SQLite，**Durable Objects** 承担多人房间与匹配队列的有状态协调。

---

## 技术栈

### 前端

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue 3（Composition API + `<script setup>`） | ^3.5 |
| 状态管理 | Pinia | ^2.3 |
| 路由 | Vue Router | ^4.5 |
| 构建工具 | Vite | ^6.3 |
| 语言 | TypeScript | ^5.8 |
| 实时通信 | 原生 WebSocket | — |
| 动画 | GSAP | ^3.15 |
| 图标 | @iconify/vue（Phosphor） | ^5.0 |

### 后端（Cloudflare Workers）

| 类别 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript | 类型安全的 Workers 代码 |
| Web 框架 | Hono | 轻量、边缘原生路由 |
| ORM | Drizzle ORM | D1 专用、类型安全的查询 |
| 实时通信 | Durable Objects WebSocket Hibernation | 低成本长连接管理 |
| 房间协调 | Durable Object `RoomObject` | 单局状态机（回合/计时/结算） |
| 匹配队列 | Durable Object `MatchmakerObject` | 跨 Worker 的玩家配对 |
| 数据库 | Cloudflare D1 | 零运维、事务性 SQLite |

### 基础设施

| 类别 | 技术 |
|------|------|
| 静态托管 | Cloudflare Pages |
| 边缘计算 | Cloudflare Workers + Durable Objects |
| 关系数据库 | Cloudflare D1 |
| 密码哈希 | scrypt（hash-wasm，前端即时哈希，后端零明文接触） |
| 包管理 | pnpm |

---

## 游戏玩法

详见 [`docs/游戏规则.md`](docs/游戏规则.md)，以下为摘要。

### 颜色反馈

每次猜测后各字段以颜色标记比对结果，多值字段（技能/词条）使用 **词条颜色 + 整格底色** 双层反馈：

| 颜色 | 含义 | 说明 |
|------|------|------|
| 🟢 绿色 | 完全匹配 | 该字段与答案完全一致 |
| 🟠 橙色 | 同组 / 接近 | 数值相近（版本/等级/COST）或同分类属性 |
| 🟡 黄底 | 数量不对 | 词条整体缺项或多余（仅多值字段底色） |
| ⚪ 灰色 | 不匹配 | 该字段与答案完全不同 |

版本号与声骸 COST 除颜色外还附带箭头：
- `↑` 目标比你的猜测更新/更大
- `↓` 目标比你的猜测更旧/更小

### 单人模式

**共鸣者** — 每局 **4 次** 猜测机会，字段：属性、星级、武器、出生地、实装版本。

**声骸** — 每局 **8 次** 猜测机会，分两种难度：
- **简单**：仅抽取 4 COST 声骸
- **困难**：全部 COST 声骸池

字段：属性、星级、COST、所属套装、掉落位置、主词条、副词条。

### 多人对战

- **创建房间**：房主选择 题型（共鸣者 / 声骸）、难度、赛制（BO1 / BO3 / BO5），生成 6 位房间码邀请对手
- **加入房间**：输入房间码即可加入，双方就绪后房主启动
- **随机匹配**：系统自动配对在线玩家，**固定 BO3 赛制**
- **回合流程**：双方对同一目标同时独立猜测，先猜中者赢下该回合；回合倒计时结束均未猜中则判平局（不分胜负，继续下一回合）
- **时间限制**：共鸣者每局 **90 秒**，声骸每局 **150 秒**
- **隐私保护**：对手猜测内容以 `***` 遮蔽，但各字段颜色反馈完整保留

### 积分结算

| 模式 | BO1 | BO3 | BO5 |
|------|-----|-----|-----|
| 共鸣者 | ±10 | ±30 | ±50 |
| 声骸·简单 | ±5 | ±10 | ±15 |
| 声骸·困难 | ±30 | ±50 | ±70 |

### 对局判定

- **逃逸（对手逃跑）**：对方直接赢得整场，按获胜时的模式与局制正常加减积分
- **断线**：异常断线保留房间续接能力；游戏中长时间无响应按逃逸处理
- **平局**：BO3 / BO5 中单回合平局不累计胜场，自动继续下一回合直到有人达到胜场阈值

---

## 功能概览

- ✅ 单人模式（共鸣者 / 声骸简单 / 声骸困难）
- ✅ 多人对战（创建房间 / 加入房间 / 随机匹配 / BO1·BO3·BO5）
- ✅ 积分系统与排行榜（模式维度独立累计）
- ✅ 登录 / 注册 / 验证码（scrypt 全程前端即时哈希）
- ✅ 玩家昵称修改
- ✅ 数据图鉴浏览（角色、声骸全条目搜索/分页）
- ✅ 逃逸判负 / 断线重连 / 平局逻辑
- ✅ 管理员后台（数据表管理、词条差异对比）

---

## 目录结构

```text
.
├── cf-server/                   # Cloudflare Workers 后端（Durable Objects + D1）
│   ├── game.ts                  # 核心游戏逻辑（抽题/对比/积分）
│   ├── room-object.ts           # DO：房间状态机（回合/计时/结算）
│   ├── matchmaker-object.ts     # DO：随机匹配队列
│   ├── protocol.ts              # C2S / S2C 消息协议枚举
│   ├── index.ts                 # Workers fetch 入口
│   └── wrangler.jsonc           # Worker + DO 部署配置
├── src/                         # Vue 3 前端
│   ├── pages/                   # 路由页面（单人/多人/登录/排行榜/规则/图鉴/后台）
│   ├── components/              # 通用组件 + 对局组件
│   ├── stores/                  # Pinia 状态（认证/单人游戏/多人游戏/字典）
│   ├── lib/compare.ts           # 核心对比逻辑（颜色/箭头/多值 cell）
│   ├── utils/game.ts            # 猜测值格式化、状态样式映射
│   ├── api/                     # Hono 前端代理接口
│   └── assets/css/              # Token 主题 + 组件样式 + 页面样式
├── functions/api/[[route]].ts   # Pages Functions（Hono 路由入口，同步 cf-server 逻辑）
├── public/media/                # 角色/声骸/属性/武器 图像资源
├── seed/                        # D1 种子数据（角色、声骸、初始玩家）
├── drizzle/                     # D1 迁移脚本
├── docs/
│   ├── 游戏规则.md              # 完整游戏规则文档
│   └── CHANGELOG.md
├── index.html                   # Vite 入口 HTML
├── vite.config.ts               # 主应用构建配置
├── vite.worker.config.ts        # Pages Functions worker 打包配置
├── worker-entry.ts              # Pages Functions Worker 入口（导出 Hono fetch）
├── drizzle.config.ts            # Drizzle + D1 配置
├── wrangler.jsonc               # Pages 项目级 Wrangler 配置（示例见 wrangler.jsonc.example）
├── .env.example                 # 本地开发环境变量示例
├── package.json                 # pnpm 工作区根配置
└── tsconfig.json
```

---

## 快速开始（本地开发）

### 1. 环境准备

- Node.js ≥ 22
- pnpm ≥ 11（`corepack enable && corepack prepare pnpm@latest --activate`）
- Cloudflare 账号（部署阶段需要，本地开发可用 `--local`）

### 2. 安装依赖

```bash
pnpm install
```

### 3. 环境变量与配置

```bash
cp .env.example .env
# 按注释编辑 .env
```

部署参考 `wrangler.jsonc.example`：复制为 `wrangler.jsonc` 并替换 `<account_id>`、`<d1_database_id>` 等占位符。

### 4. 初始化 D1 本地数据库

```bash
# 1) 创建本地 D1 并执行迁移
pnpm d1:migrate:local

# 2) 灌入角色与声骸种子数据
pnpm d1:seed:local

# 3) 可选：灌入测试玩家
pnpm d1:seed:players:local
```

### 5. 启动本地开发

多开三个终端分别运行（推荐顺序）：

```bash
# 终端 A：Workers + Durable Objects（房间/匹配/实时 WebSocket，端口 8788）
pnpm dev:ws

# 终端 B：构建前端产物
pnpm build

# 终端 C：Wrangler Pages Dev 模拟 Pages + Functions（端口 5174，含 Hono API）
pnpm dev:cf
```

浏览器访问 <http://127.0.0.1:5174>。

> 💡 日常仅改前端时可直接 `pnpm dev` 用纯 Vite HMR（5173），但此时无法使用需要 Workers/Functions 的接口与实时多人。

---

## 部署（Cloudflare 生产）

### 一次性准备

```bash
# 登录 Cloudflare
wrangler login

# 创建 D1 数据库（记录返回的 database_id 填入 wrangler.jsonc）
pnpm d1:create
```

### 迁移 + 种子（远端）

```bash
pnpm d1:migrate:remote
pnpm d1:seed:remote
pnpm d1:seed:players:remote
```

### 部署 Workers 后端 + 前端 Pages

```bash
pnpm deploy:production
```

命令内部依次执行：`deploy:ws`（部署 cf-server Worker + Durable Objects）→ `build` → `wrangler pages deploy dist --branch production`。

部署完成后：
- Pages 前端：`https://<pages-project>.pages.dev`（或绑定的自定义域）
- Workers + Durable Objects：由 Pages 通过 Service Binding 内部调用，对外无独立域名

### GitHub Actions 自动部署

项目内置了 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)，push 到 `main` / `master` 分支时自动触发：构建前端 → 应用 D1 迁移 → 部署 Workers → 部署 Pages。也可在 Actions 页面手动触发（`workflow_dispatch`）。

#### 1. 配置 GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions** 中添加以下 4 个 Secrets：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需具备 Workers / Pages / D1 / KV 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID（Dashboard 右侧栏可见） |
| `D1_DATABASE_ID` | D1 数据库 ID（`wrangler d1 create` 返回值或 Dashboard 中查看） |
| `KV_NAMESPACE_ID` | KV 命名空间 ID |

#### 2. 推送代码

```bash
git push origin main
```

推送后 GitHub Actions 会自动执行：从 `wrangler.jsonc.example` 模板 + Secrets 生成配置 → `pnpm build` → `pnpm d1:migrate:remote` → `wrangler deploy`（cf-server）→ `wrangler pages deploy dist --branch production`。

> ⚠️ 首次使用前需确保已完成一次性准备（创建 D1 数据库、KV 命名空间），并将对应 ID 配置为 Secrets。种子数据需手动执行一次 `pnpm d1:seed:remote`。

---

## 数据库与迁移

本项目使用 **Drizzle ORM** 与 Cloudflare D1 交互，schema 在 [`src/lib/db/schema.ts`](src/lib/db/schema.ts)。

常用命令：

```bash
# 根据 schema 变更生成下一个迁移文件
pnpm d1:generate

# 本地应用迁移
pnpm d1:migrate:local

# 远端应用迁移
pnpm d1:migrate:remote

# 打开 Drizzle Studio 图形化浏览 D1
pnpm d1:studio
```

主要数据表：
- `characters` — 共鸣者（角色）属性
- `sound_skeletons` — 声骸属性、词条、套装
- `players` — 玩家账号、scrypt 哈希、积分、胜场/总场
- `matches` / `match_rounds` — 对战记录（可扩展）

---

## 贡献

欢迎通过 Issue 和 Pull Request 参与本项目。仓库已内置贡献基建，帮助你标准化地提交反馈与代码。

### 提交 Issue

仓库提供了 4 种 Issue 模板（[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/)），新建 Issue 时会自动出现选择器：

| 模板 | 适用场景 |
|------|----------|
| 🐛 Bug 报告 | 功能异常、报错、多人连接失败等 |
| ✨ 功能需求 | 新玩法、新功能或交互改进建议 |
| 📊 数据勘误 | 角色 / 声骸属性、词条、版本等信息填错 |
| ©️ 素材版权投诉 | `public/media/` 下美术素材的版权或署名问题 |

> 空白 Issue 已禁用，请选择对应模板填写。想法交流、玩法讨论请前往 [Discussions](https://github.com/MoonCC233/Phrolova/discussions)。

### 提交 Pull Request

1. Fork 仓库并创建功能分支（建议从 `main` 拉取）。
2. 本地开发后，提交前请确保以下检查通过：

   ```bash
   pnpm typecheck          # 前端 + API 类型检查（vue-tsc）
   pnpm typecheck:server   # cf-server Durable Objects 类型检查
   pnpm build              # 前端 + Pages Worker 构建
   ```

3. 若修改了数据库 schema，请通过 `pnpm d1:generate` 生成迁移文件并一并提交。
4. 提交 PR 时会自动加载 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md)，请按清单逐项自检并补充变更说明、影响范围与截图。

### CI 自动检查

每个 PR 都会触发 [.github/workflows/ci.yml](.github/workflows/ci.yml)，依次执行：

- **TypeScript 类型检查**（前端 + cf-server）
- **构建验证**（确保 `dist/` 与 `dist/_worker.js` 正常产出）
- **Preview 部署**（自动部署到 Cloudflare Pages Preview 并在 PR 评论中回贴预览链接）
- **代码审查报告**（聚合各步骤结果，评论在 PR 中）

> Preview 部署需要仓库 Secrets 已配置（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_DATABASE_ID` / `KV_NAMESPACE_ID`）；未配置时该步骤会跳过，不影响类型与构建检查。

### 代码所有者与依赖

- [`.github/CODEOWNERS`](.github/CODEOWNERS) 标注了关键路径（Durable Objects、认证、数据库 schema、CI 配置等）的所有者，相关变更会自动请求审查。
- [`.github/dependabot.yml`](.github/dependabot.yml) 每周检查 npm 依赖与 GitHub Actions 版本更新，并按生态分组（Vue / Cloudflare / Drizzle）合并 PR。

---

## 安全与隐私

- **密码零明文**：注册/登录时前端使用 scrypt（hash-wasm）即时哈希为 32 字节 hex，后端仅存储 hex 摘要并在 D1 中再次用 scrypt 工作因子包装，全程不接触原始密码。
- **会话 token**：登录后下发一次性 token，房间 WebSocket 连接必须携带 token 并校验玩家身份。
- **CORS / CSRF**：Pages 与 Functions 同域部署，默认同源；外部调用通过 `wrangler.jsonc` 的 `headers` 限制。
- **房间隔离**：每局使用独立 Durable Object，房间码为一次性随机短码，玩家 ID 通过 token 校验后才能写入 Socket。

---

## 许可与数据版权声明

- 代码部分见 [`LICENSE`](LICENSE)
- 游戏内涉及的「鸣潮」角色、声骸、属性等名称与美术素材，版权归库洛游戏所有，本项目仅供学习与非盈利娱乐使用，素材若有侵权请联系移除。
- `public/media/` 下的头像图来自公开社区整理，若你是原作者且不希望被使用，请提交 Issue。

---

## FAQ

**Q：多人对战连接失败？**
A：确认 `cf-server` Worker 已部署且 Pages 项目已配置 Service Binding 到该 Worker，`wrangler.jsonc` 中的 `services` 段不能缺失；本地开发时 `pnpm dev:cf` 会通过 `--worker` 绑定本地 dev:ws。

**Q：本地 D1 数据如何清空重来？**
A：删除 `.wrangler/state/v3/d1/`，然后重新 `pnpm d1:migrate:local` + `pnpm d1:seed:local`。

**Q：如何添加新角色 / 声骸？**
A：更新 `seed/seed.sql` 或使用管理员后台（`/admin/login`，需要在 `players` 表手动把 `is_admin` 改为 1）。

**Q：scrypt 参数怎么调？**
A：在 `src/lib/scrypt-client.ts`（前端哈希）和 D1 种子/升级脚本（后端二次哈希）中统一调整，两端必须一致。

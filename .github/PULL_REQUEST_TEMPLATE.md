<!--
感谢你的贡献！请先阅读 CONTRIBUTING（README「贡献」章节）。
提交前请确保本地通过：pnpm typecheck && pnpm typecheck:server && pnpm build
-->

## 变更说明

<!-- 这个 PR 做了什么？为什么需要？关联了哪个 Issue（如 Closes #123）？ -->

Closes #

## 变更类型

- [ ] 🐛 Bug 修复（不破坏现有功能）
- [ ] ✨ 新功能
- [ ] 🎨 UI / 样式调整
- [ ] ♻️ 重构 / 架构优化
- [ ] ⚡ 性能优化
- [ ] 📊 数据勘误（角色 / 声骸属性）
- [ ] 📦 依赖升级 / 构建配置
- [ ] 📝 文档更新
- [ ] 🔧 基础设施 / CI / 部署

## 影响范围

<!-- 勾选本次涉及的模块，便于审查聚焦 -->
- [ ] 前端 (`src/`)
- [ ] 后端 API (`functions/api/`)
- [ ] Durable Objects (`cf-server/`)
- [ ] Pages Worker 入口 (`worker-entry.ts`)
- [ ] 数据库 / 迁移 (`drizzle/`, `seed/`)
- [ ] 基础设施 (`.github/`, `wrangler`, 构建配置)
- [ ] 其他：

## 自检清单

- [ ] 本地已运行 `pnpm typecheck` 通过
- [ ] 本地已运行 `pnpm typecheck:server` 通过
- [ ] 本地已运行 `pnpm build` 成功
- [ ] 已自测核心路径未回归（单人 / 多人连接 / 登录）
- [ ] 若涉及数据库 schema 变更，已通过 `pnpm d1:generate` 生成迁移
- [ ] 若涉及新环境变量 / Secrets，已在 `.env.example` 或文档中说明
- [ ] 未提交 `wrangler.jsonc`、`.env`、`.wrangler/` 等本地配置

## 截图 / 预览

<!-- 可选：UI 改动请附截图；接口改动可附请求/响应示例。 -->

## 备注

<!-- 可选：需要 reviewer 特别注意的点、迁移步骤、后续待办等。 -->

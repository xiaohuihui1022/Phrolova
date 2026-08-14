-- Drizzle migration: 0000_initial.sql
-- 角色&声骸&玩家表

CREATE TABLE IF NOT EXISTS "characters" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"attribute" text NOT NULL,
	"star_rating" integer NOT NULL,
	"weapon" text NOT NULL,
	"birthplace" text NOT NULL,
	"version" real NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "characters_name_unique" ON "characters" ("name");

CREATE TABLE IF NOT EXISTS "sound_skeletons" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"name" text NOT NULL,
	"skill_attribute" text NOT NULL,
	"cost" integer NOT NULL,
	"is_aberration" text NOT NULL DEFAULT '无',
	"set_name" text NOT NULL,
	"drop_location" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sound_skeletons_name_unique" ON "sound_skeletons" ("name");

CREATE TABLE IF NOT EXISTS "players" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"player_id" text NOT NULL,
	"score" integer NOT NULL DEFAULT 0,
	"secret" text NOT NULL DEFAULT '',
	"password" text NOT NULL DEFAULT '',
	"wins" integer NOT NULL DEFAULT 0,
	"matches" integer NOT NULL DEFAULT 0,
	"single_resonator_score" integer NOT NULL DEFAULT 0,
	"single_skeleton_score" integer NOT NULL DEFAULT 0,
	"created_at" text DEFAULT CURRENT_TIMESTAMP,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "players_player_id_unique" ON "players" ("player_id");
CREATE INDEX IF NOT EXISTS "idx_players_score" ON "players" ("score" DESC);
CREATE INDEX IF NOT EXISTS "idx_players_single_resonator" ON "players" ("single_resonator_score" DESC);
CREATE INDEX IF NOT EXISTS "idx_players_single_skeleton" ON "players" ("single_skeleton_score" DESC);

CREATE TABLE IF NOT EXISTS "player_targets" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"player_id" text NOT NULL UNIQUE,
	"quiz_type" text NOT NULL,
	"target_json" text NOT NULL,
	"attempts" integer NOT NULL DEFAULT 0,
	"created_at" text DEFAULT CURRENT_TIMESTAMP
);

--> drizzle statement: statement-end

-- 管理员日志表

CREATE TABLE IF NOT EXISTS "admin_logs" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"time" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL
);

--> drizzle statement: statement-end

-- 致谢名单表

CREATE TABLE IF NOT EXISTS "acknowledgements" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"player_id" text NOT NULL,
	"category" text NOT NULL DEFAULT 'bug',
	"description" text NOT NULL DEFAULT '',
	"sort_order" integer NOT NULL DEFAULT 0,
	"created_at" text DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_acknowledgements_sort" ON "acknowledgements" ("sort_order" ASC, "id" ASC);

--> drizzle statement: statement-end

-- 致谢名单表新增 avatar 字段（可为空）

ALTER TABLE "acknowledgements" ADD COLUMN "avatar" text;

--> drizzle statement: statement-end

-- 登录验证码表

CREATE TABLE IF NOT EXISTS "captchas" (
	"captcha_id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"expire" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_captchas_expire" ON "captchas" ("expire");

--> drizzle statement: statement-end

-- 管理员会话 + 同步状态表

CREATE TABLE IF NOT EXISTS "admin_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"expiry" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_admin_sessions_expiry" ON "admin_sessions" ("expiry");

CREATE TABLE IF NOT EXISTS "admin_sync_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL DEFAULT 'idle',
	"result_json" text
);

--> drizzle statement: statement-end

-- player_targets 新增 expires_at 字段：玩家关闭网页时设置，10s 后延迟清理

ALTER TABLE "player_targets" ADD COLUMN "expires_at" text DEFAULT CURRENT_TIMESTAMP;

--> drizzle statement: statement-end

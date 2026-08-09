-- Drizzle migration: 0000_initial.sql
-- Phrolova D1 SQLite 初始建表脚本

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

CREATE TABLE IF NOT EXISTS "admin_logs" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"time" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL
);

--> drizzle statement: statement-end

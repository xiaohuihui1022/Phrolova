-- Drizzle migration: 0001_acknowledgements.sql
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

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql, desc } from 'drizzle-orm';

// ── 角色表 ──────────────────────────────────────────────
export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  attribute: text('attribute').notNull(),
  starRating: integer('star_rating').notNull(),
  weapon: text('weapon').notNull(),
  birthplace: text('birthplace').notNull(),
  version: real('version').notNull(),
});

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

// ── 声骸表 ──────────────────────────────────────────────
export const soundSkeletons = sqliteTable('sound_skeletons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  skillAttribute: text('skill_attribute').notNull(),
  cost: integer('cost').notNull(),
  isAberration: text('is_aberration').notNull().default('无'),
  setName: text('set_name').notNull(),
  dropLocation: text('drop_location').notNull(),
});

export type SoundSkeleton = typeof soundSkeletons.$inferSelect;
export type NewSoundSkeleton = typeof soundSkeletons.$inferInsert;

// ── 玩家表 ──────────────────────────────────────────────
export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: text('player_id').notNull().unique(),
  score: integer('score').notNull().default(0),
  secret: text('secret').notNull().default(''),
  password: text('password').notNull().default(''),
  wins: integer('wins').notNull().default(0),
  matches: integer('matches').notNull().default(0),
  singleResonatorScore: integer('single_resonator_score').notNull().default(0),
  singleSkeletonScore: integer('single_skeleton_score').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idx_players_score: index('idx_players_score').on(desc(table.score)),
  idx_players_single_resonator: index('idx_players_single_resonator').on(desc(table.singleResonatorScore)),
  idx_players_single_skeleton: index('idx_players_single_skeleton').on(desc(table.singleSkeletonScore)),
}));

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;

// ── 单人游戏目标会话（替代 Python 的内存 _player_targets） ──
export const playerTargets = sqliteTable('player_targets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: text('player_id').notNull().unique(),
  quizType: text('quiz_type').notNull(), // 'resonator' | 'skeleton'
  targetJson: text('target_json').notNull(), // JSON serialized target row
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export type PlayerTarget = typeof playerTargets.$inferSelect;
export type NewPlayerTarget = typeof playerTargets.$inferInsert;

// ── 管理后台错误日志（替代 Python 的 deque _logs） ─────
export const adminLogs = sqliteTable('admin_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  time: text('time').notNull(),
  level: text('level').notNull(), // 'INFO' | 'ERROR'
  message: text('message').notNull(),
});

export type AdminLog = typeof adminLogs.$inferSelect;
export type NewAdminLog = typeof adminLogs.$inferInsert;

// ── 致谢名单表 ──────────────────────────────────────────
export const acknowledgements = sqliteTable('acknowledgements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: text('player_id').notNull(),
  category: text('category').notNull().default('bug'), // 'bug' | 'feature' | 'support' | 'other'
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export type Acknowledgement = typeof acknowledgements.$inferSelect;
export type NewAcknowledgement = typeof acknowledgements.$inferInsert;

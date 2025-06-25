import { pgTable, serial, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const tokens = pgTable(
  'tokens',
  {
    id: serial('id').primaryKey(),
    bondingCurveAddress: text('bonding_curve_address').notNull().unique(),
    complete: boolean('complete').notNull().default(false),
    creator: text('creator').notNull(),
    tokenAddress: text('token_address').notNull().unique(),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    uri: text('uri'),
    description: text('description'),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [
    // Indexes for better performance
    index('idx_tokens_bonding_curve').on(table.bondingCurveAddress),
    index('idx_tokens_address').on(table.tokenAddress),
    index('idx_tokens_symbol').on(table.symbol),
    index('idx_tokens_name').on(table.name),
    index('idx_tokens_complete').on(table.complete),
    index('idx_tokens_creator').on(table.creator),
    index('idx_tokens_created_at').on(table.createdAt),
  ]
);

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;

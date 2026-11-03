import { integer, pgTable, varchar } from 'drizzle-orm/pg-core';

export const demoCatalog = pgTable('demo_catalog', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  framework: varchar('framework', { length: 32 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

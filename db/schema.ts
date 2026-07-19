import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const infringementRecords = sqliteTable(
  "infringement_records",
  {
    id: text("id").primaryKey(),
    infringementUrl: text("infringement_url").notNull(),
    platform: text("platform").notNull(),
    infringementType: text("infringement_type").notNull(),
    sourceUrl: text("source_url"),
    title: text("title"),
    discoveredAt: text("discovered_at").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("待核实"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("records_status_idx").on(table.status),
    index("records_created_at_idx").on(table.createdAt),
  ],
);

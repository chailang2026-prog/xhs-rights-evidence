import { env } from "cloudflare:workers";

export const recordStatuses = ["待核实", "处理中", "已解决"] as const;
export type RecordStatus = (typeof recordStatuses)[number];

export type InfringementRecord = {
  id: string;
  infringementUrl: string;
  platform: string;
  infringementType: string;
  sourceUrl: string | null;
  title: string | null;
  discoveredAt: string;
  notes: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
};

type RecordRow = {
  id: string;
  infringement_url: string;
  platform: string;
  infringement_type: string;
  source_url: string | null;
  title: string | null;
  discovered_at: string;
  notes: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
};

function database() {
  if (!env.DB) throw new Error("数据库暂时不可用");
  return env.DB;
}

let schemaReady: Promise<unknown> | null = null;

async function ensureSchema() {
  if (!schemaReady) {
    const db = database();
    schemaReady = db
      .batch([
        db.prepare(`
          CREATE TABLE IF NOT EXISTS infringement_records (
            id TEXT PRIMARY KEY,
            infringement_url TEXT NOT NULL,
            platform TEXT NOT NULL,
            infringement_type TEXT NOT NULL,
            source_url TEXT,
            title TEXT,
            discovered_at TEXT NOT NULL,
            notes TEXT,
            status TEXT NOT NULL DEFAULT '待核实',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
        db.prepare("CREATE INDEX IF NOT EXISTS records_status_idx ON infringement_records (status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS records_created_at_idx ON infringement_records (created_at)"),
      ])
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

function toRecord(row: RecordRow): InfringementRecord {
  return {
    id: row.id,
    infringementUrl: row.infringement_url,
    platform: row.platform,
    infringementType: row.infringement_type,
    sourceUrl: row.source_url,
    title: row.title,
    discoveredAt: row.discovered_at,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRecords() {
  await ensureSchema();
  const result = await database()
    .prepare(`SELECT id, infringement_url, platform, infringement_type, source_url,
      title, discovered_at, notes, status, created_at, updated_at
      FROM infringement_records ORDER BY created_at DESC`)
    .all<RecordRow>();
  return result.results.map(toRecord);
}

export async function createRecord(input: {
  infringementUrl: string;
  platform: string;
  infringementType: string;
  sourceUrl?: string | null;
  title?: string | null;
  discoveredAt: string;
  notes?: string | null;
}) {
  await ensureSchema();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database()
    .prepare(`INSERT INTO infringement_records (
      id, infringement_url, platform, infringement_type, source_url,
      title, discovered_at, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待核实', ?, ?)`) 
    .bind(
      id,
      input.infringementUrl,
      input.platform,
      input.infringementType,
      input.sourceUrl || null,
      input.title || null,
      input.discoveredAt,
      input.notes || null,
      now,
      now,
    )
    .run();

  return {
    id,
    ...input,
    sourceUrl: input.sourceUrl || null,
    title: input.title || null,
    notes: input.notes || null,
    status: "待核实" as const,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateRecordStatus(id: string, status: RecordStatus) {
  await ensureSchema();
  const result = await database()
    .prepare("UPDATE infringement_records SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), id)
    .run();
  return result.meta.changes > 0;
}

export async function deleteRecord(id: string) {
  await ensureSchema();
  const result = await database()
    .prepare("DELETE FROM infringement_records WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

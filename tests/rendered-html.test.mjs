import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("implements the source-note scanning workflow", async () => {
  const [scanner, route, rerunRoute, imageRoute, search, source] = await Promise.all([
    readFile(new URL("../app/Scanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scans/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scans/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/source-image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/source-note.ts", import.meta.url), "utf8"),
  ]);

  assert.match(scanner, /贴入一条笔记/);
  assert.match(scanner, /大众点评/);
  assert.match(scanner, /Google Lens/);
  assert.match(scanner, /疑似侵权线索/);
  assert.match(scanner, /导出 CSV/);
  assert.match(route, /extractSourceNote/);
  assert.match(route, /scanPublicWeb/);
  assert.match(rerunRoute, /extractSourceNote/);
  assert.match(rerunRoute, /refreshScanSource/);
  assert.match(search, /\["baidu", "google"\]/);
  assert.match(search, /engine: "google_lens"/);
  assert.match(search, /createSourceImageProxyUrl/);
  assert.match(imageRoute, /verifySourceImageProxyUrl/);
  assert.match(imageRoute, /12_000_000/);
  assert.match(source, /xhslink\.com/);
  assert.doesNotMatch(scanner, /添加侵权链接|手工登记/);
});

test("keeps secrets server-side and protects the database", async () => {
  const [auth, supabase, migration, envExample] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/001_original_radar.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(supabase, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(migration, /enable row level security/);
  assert.match(envExample, /SERPAPI_API_KEY/);
  assert.doesNotMatch(envExample, /sk-|eyJ[a-zA-Z0-9]/);
});

test("removes platform-specific D1 runtime files", async () => {
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
  await assert.rejects(access(new URL("../db/records.ts", import.meta.url)));
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare:workers/);
});

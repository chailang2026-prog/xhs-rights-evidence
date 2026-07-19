import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

test("contains the complete infringement-tracking workflow", async () => {
  const tracker = await readFile(new URL("../app/Tracker.tsx", import.meta.url), "utf8");
  assert.match(tracker, /侵权取证夹/);
  assert.match(tracker, /收好证据/);
  assert.match(tracker, /我的侵权记录/);
  assert.match(tracker, /添加侵权链接/);
  assert.match(tracker, /\/api\/records/);
  assert.match(tracker, /exportCsv/);
  assert.doesNotMatch(tracker, /codex-preview|react-loading-skeleton/);
});

test("replaces starter metadata and disposable preview", async () => {
  const [css, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(css, /--red:\s*#ff2442/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /<Tracker \/>/);
  assert.match(layout, /侵权取证夹/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

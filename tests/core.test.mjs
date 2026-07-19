import assert from "node:assert/strict";
import test from "node:test";
import { extractSourceNote } from "../lib/source-note.ts";
import { createSessionToken, isSessionValid, sessionCookie, verifyPassword } from "../lib/auth.ts";
import { extractSearchPhrases, textSimilarity } from "../lib/matching.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("extracts public note metadata without pulling unrelated page content", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.xiaohongshu.com/explore/abc123",
    headers: new Headers({ "content-length": "900" }),
    text: async () => `<!doctype html><html><head>
      <meta property="og:title" content="周末去海边散步">
      <meta property="og:description" content="这条海边路线很安静，傍晚的光线特别适合拍照。">
      <meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/example.jpg">
    </head><body><script>window.__INITIAL_STATE__={"hotlistData":[{"title":"不相关热榜"}]}</script></body></html>`,
  });

  const note = await extractSourceNote("https://xhslink.com/example");
  assert.equal(note.title, "周末去海边散步");
  assert.match(note.text, /海边路线/);
  assert.deepEqual(note.imageUrls, ["https://sns-webpic-qc.xhscdn.com/example.jpg"]);
  assert.doesNotMatch(note.title, /不相关热榜/);
});

test("rejects an unavailable note page instead of using hot-list text", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.xiaohongshu.com/explore/missing",
    headers: new Headers(),
    text: async () => `<html><body><script>window.__INITIAL_STATE__={"noteData":[],"hotlistData":[{"title":"旅行热门内容"}]}</script></body></html>`,
  });

  await assert.rejects(
    extractSourceNote("https://www.xiaohongshu.com/explore/missing"),
    /没有返回公开图文内容/,
  );
});

test("rejects non-Xiaohongshu source links before fetching", async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("should not fetch"); };
  await assert.rejects(extractSourceNote("https://example.com/post"), /只支持小红书/);
  assert.equal(fetched, false);
});

test("protects private scan APIs with a signed HttpOnly session", () => {
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "a-strong-private-password";
  try {
    assert.equal(verifyPassword("wrong"), false);
    assert.equal(verifyPassword("a-strong-private-password"), true);
    const token = createSessionToken();
    const cookie = sessionCookie(token);
    assert.match(cookie, /HttpOnly/);
    assert.doesNotMatch(cookie, /a-strong-private-password/);
    const request = new Request("https://example.com/api/scans", { headers: { cookie } });
    assert.equal(isSessionValid(request), true);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
  }
});

test("scores copied Chinese text above loosely related text", () => {
  const source = "沿着海边木栈道一直走，傍晚六点可以看到整片橘色晚霞";
  const copied = "沿着海边木栈道一直走，傍晚六点可以看到整片橘色晚霞，真的很美";
  const unrelated = "这家酒店早餐丰富，距离机场大约二十分钟";
  assert.ok(textSimilarity(source, copied) > 0.9);
  assert.ok(textSimilarity(source, unrelated) < 0.3);
});

test("builds distinctive search phrases and removes hashtags", () => {
  const phrases = extractSearchPhrases({
    title: "青岛海边散步路线",
    text: "从小麦岛沿着海边木栈道一直走到日落。#青岛旅行 傍晚六点可以看到整片橘色晚霞。",
  });
  assert.ok(phrases.length >= 2);
  assert.ok(phrases.every((phrase) => !phrase.includes("#")));
  assert.ok(phrases.some((phrase) => phrase.includes("木栈道")));
});

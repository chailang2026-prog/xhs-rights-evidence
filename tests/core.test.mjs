import assert from "node:assert/strict";
import test from "node:test";
import { extractSourceNote } from "../lib/source-note.ts";
import { createSessionToken, isSessionValid, sessionCookie, verifyPassword } from "../lib/auth.ts";
import { extractSearchPhrases, textSimilarity } from "../lib/matching.ts";
import { createSourceImageProxyUrl, isAllowedSourceImageUrl, normalizeSourceImageUrl, verifySourceImageProxyUrl } from "../lib/source-images.ts";
import { GET as getSourceImage } from "../app/api/source-image/route.ts";
import { scanPublicWeb } from "../lib/scanner.ts";
import { publicRequestOrigin } from "../lib/request-origin.ts";

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

test("extracts the current Xiaohongshu initial-state note object and one URL per original image", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.xiaohongshu.com/discovery/item/abc123",
    headers: new Headers({ "content-length": "1800" }),
    text: async () => `<!doctype html><html><head>
      <meta property="og:title" content=" - 小红书">
      <meta property="og:image" content="https://ci.xiaohongshu.com/?imageMogr2/format/jpg">
    </head><body><script>window.__INITIAL_STATE__={"noteData":{"routeQuery":{},"data":{"noteData":{"noteId":"abc123","title":"厦门老街散步路线","desc":"从八市沿着开元路慢慢走，傍晚会经过几家很安静的老店。","user":{"nickName":"原创作者"},"imageList":[{"url":"http://sns-webpic-qc.xhscdn.com/note/first.jpg","infoList":[{"url":"http://sns-webpic-qc.xhscdn.com/note/first-preview.jpg"}]},{"infoList":[{"url":"https://sns-webpic-qc.xhscdn.com/note/second.jpg"}]}]},"commentData":{}}}};</script></body></html>`,
  });

  const note = await extractSourceNote("https://www.xiaohongshu.com/explore/abc123");
  assert.equal(note.title, "厦门老街散步路线");
  assert.match(note.text, /八市沿着开元路/);
  assert.equal(note.author, "原创作者");
  assert.deepEqual(note.imageUrls, [
    "https://sns-webpic-qc.xhscdn.com/note/first.jpg",
    "https://sns-webpic-qc.xhscdn.com/note/second.jpg",
  ]);
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

test("rejects a real-style unavailable page even when it has Open Graph metadata", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.xiaohongshu.com/discovery/item/dead123",
    headers: new Headers(),
    text: async () => `<html><head>
      <meta property="og:title" content="你访问的页面不见了 - 小红书">
      <meta property="og:image" content="https://ci.xiaohongshu.com/?imageMogr2/format/jpg">
    </head><body><script>window.__INITIAL_STATE__={"hotlistData":[{"title":"旅行热门内容"}]};</script></body></html>`,
  });

  await assert.rejects(
    extractSourceNote("https://www.xiaohongshu.com/explore/dead123"),
    /已删除、不可见|失效/,
  );
});

test("rejects non-Xiaohongshu source links before fetching", async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("should not fetch"); };
  await assert.rejects(extractSourceNote("https://example.com/post"), /只支持小红书/);
  assert.equal(fetched, false);
});

test("does not follow Xiaohongshu redirects to untrusted hosts", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: false,
      status: 302,
      url: "https://xhslink.com/example",
      headers: new Headers({ location: "http://127.0.0.1/internal" }),
    };
  };
  await assert.rejects(extractSourceNote("https://xhslink.com/example"), /不受信任/);
  assert.equal(fetchCount, 1);
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
    text: "从小麦岛沿着海边木栈道一直走到日落。\n#青岛旅行 傍晚六点可以看到整片橘色晚霞。",
  });
  assert.ok(phrases.length >= 2);
  assert.ok(phrases.every((phrase) => !phrase.includes("#")));
  assert.ok(phrases.some((phrase) => phrase.includes("木栈道")));
});

test("samples the middle and end of a long paragraph instead of searching only its opening", () => {
  const phrases = extractSearchPhrases({
    title: "厦门旧城慢走记录",
    text: "这一段开头先介绍普通的出发准备和天气情况然后继续描述沿途街景没有使用句号直到中段出现只有本次路线才有的B17蓝色门牌和榕树拐角接着继续向前经过几段安静巷道最后抵达隐藏观景台并看到钟楼倒影这个结尾同样很有辨识度",
  });
  assert.ok(phrases.some((phrase) => phrase.includes("B17蓝色门牌")));
  assert.ok(phrases.some((phrase) => phrase.includes("隐藏观景台")));
});

test("signs short-lived image proxy URLs and rejects tampering or SSRF targets", () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.APP_PASSWORD = "a-strong-private-password";
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example";
  try {
    const source = "https://sns-webpic-qc.xhscdn.com/notes/photo.webp";
    const now = 1_800_000_000_000;
    const proxy = createSourceImageProxyUrl(source, { now });
    assert.equal(verifySourceImageProxyUrl(proxy, now + 60_000), source);
    const tampered = new URL(proxy);
    tampered.searchParams.set("url", "https://example.com/private.png");
    assert.equal(verifySourceImageProxyUrl(tampered.toString(), now + 60_000), null);
    assert.equal(verifySourceImageProxyUrl(proxy, now + 31 * 60_000), null);
    assert.equal(isAllowedSourceImageUrl("http://127.0.0.1/admin.png"), false);
    assert.equal(isAllowedSourceImageUrl("https://evil-xhscdn.com/photo.png"), false);
    assert.equal(normalizeSourceImageUrl("http://sns-webpic-qc.xhscdn.com/photo.png"), "https://sns-webpic-qc.xhscdn.com/photo.png");
    assert.equal(normalizeSourceImageUrl("https://ci.xiaohongshu.com/?imageMogr2/format/jpg"), null);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("image proxy returns only signed, supported image bytes", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.APP_PASSWORD = "a-strong-private-password";
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example";
  try {
    const source = "https://sns-webpic-qc.xhscdn.com/notes/photo.webp";
    const proxy = createSourceImageProxyUrl(source);
    let requestedUrl = "";
    globalThis.fetch = async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options?.redirect, "error");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "4" },
      });
    };
    const response = await getSourceImage(new Request(proxy));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(requestedUrl, source);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);

    const invalid = new URL(proxy);
    invalid.searchParams.set("signature", "tampered");
    const rejected = await getSourceImage(new Request(invalid));
    assert.equal(rejected.status, 403);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("combines copied text and Lens image evidence into one reviewable link", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousSerpKey = process.env.SERPAPI_API_KEY;
  const previousLimit = process.env.SCAN_MAX_TEXT_SEARCHES;
  const previousImageEngines = process.env.SCAN_IMAGE_ENGINES;
  process.env.APP_PASSWORD = "a-strong-private-password";
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example";
  process.env.SERPAPI_API_KEY = "test-serp-key";
  process.env.SCAN_MAX_TEXT_SEARCHES = "6";
  process.env.SCAN_IMAGE_ENGINES = "google_lens";
  try {
    const engines = new Set();
    globalThis.fetch = async (value) => {
      const url = new URL(String(value));
      assert.equal(url.hostname, "serpapi.com");
      const engine = url.searchParams.get("engine");
      engines.add(engine);
      if (engine === "google_lens") {
        assert.match(url.searchParams.get("url") || "", /^https:\/\/radar\.example\/api\/source-image/);
        return Response.json({
          visual_matches: [{
            position: 1,
            title: "青岛小麦岛沿海路线",
            link: "https://www.dianping.com/shop/123/review/456?utm_source=test",
            thumbnail: "https://images.example/match.webp",
            exact_matches: true,
          }],
        });
      }
      if (engine === "baidu" || engine === "google") {
        return Response.json({
          organic_results: [{
            position: 1,
            title: "青岛海边散步路线",
            link: "https://www.dianping.com/shop/123/review/456",
            snippet: "从小麦岛沿着海边木栈道一直走到日落，傍晚六点可以看到整片橘色晚霞。",
          }, {
            position: 2,
            title: "不安全链接",
            link: "javascript:alert(1)",
            snippet: "从小麦岛沿着海边木栈道一直走到日落。",
          }],
        });
      }
      return Response.json({ error: "unexpected engine" }, { status: 400 });
    };

    const result = await scanPublicWeb({
      url: "https://www.xiaohongshu.com/explore/source-note",
      title: "青岛海边散步路线",
      text: "从小麦岛沿着海边木栈道一直走到日落。傍晚六点可以看到整片橘色晚霞。",
      imageUrls: ["https://sns-webpic-qc.xhscdn.com/notes/source.webp"],
      author: "原创作者",
    }, ["dianping", "web"], "https://radar.example");

    assert.equal(result.partial, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].platform, "dianping");
    assert.equal(result.matches[0].matchType, "图文相似");
    assert.ok(result.matches[0].textScore > 0.9);
    assert.equal(result.matches[0].imageScore, 0.98);
    assert.ok(result.matches[0].evidence.some((item) => item.startsWith("百度文字命中")));
    assert.ok(result.matches[0].evidence.some((item) => item.startsWith("Google文字命中")));
    assert.ok(result.matches[0].evidence.some((item) => item.startsWith("Google Lens 精确图片命中")));
    assert.doesNotMatch(result.matches[0].targetUrl, /utm_source/);
    assert.deepEqual([...engines].sort(), ["baidu", "google", "google_lens"]);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
    if (previousSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpKey;
    if (previousLimit === undefined) delete process.env.SCAN_MAX_TEXT_SEARCHES;
    else process.env.SCAN_MAX_TEXT_SEARCHES = previousLimit;
    if (previousImageEngines === undefined) delete process.env.SCAN_IMAGE_ENGINES;
    else process.env.SCAN_IMAGE_ENGINES = previousImageEngines;
  }
});

test("covers every named travel platform across Baidu and Google results", async () => {
  const previousSerpKey = process.env.SERPAPI_API_KEY;
  const previousLimit = process.env.SCAN_MAX_TEXT_SEARCHES;
  process.env.SERPAPI_API_KEY = "test-serp-key";
  process.env.SCAN_MAX_TEXT_SEARCHES = "12";
  try {
    const organicResults = [
      ["https://www.dianping.com/shop/1/review/1", "大众点评"],
      ["https://you.ctrip.com/travels/xiamen21/1.html", "携程"],
      ["https://travel.qunar.com/p-pl1", "去哪儿"],
      ["https://travel.taobao.com/item/1", "飞猪"],
      ["https://www.amap.com/place/B1", "高德地图"],
      ["https://travel.example.com/post/1", "其他网页"],
    ].map(([link, title], index) => ({
      position: index + 1,
      title: `${title}厦门老街路线`,
      link,
      snippet: "从八市沿着开元路慢慢走，傍晚会经过几家很安静的老店。",
    }));
    const engines = new Set();
    globalThis.fetch = async (value) => {
      const engine = new URL(String(value)).searchParams.get("engine");
      engines.add(engine);
      assert.ok(engine === "baidu" || engine === "google");
      return Response.json({ organic_results: organicResults });
    };

    const result = await scanPublicWeb({
      url: "https://www.xiaohongshu.com/explore/source-note",
      title: "厦门老街散步路线",
      text: "从八市沿着开元路慢慢走，傍晚会经过几家很安静的老店。",
      imageUrls: [],
      author: "原创作者",
    }, ["dianping", "ctrip", "qunar", "fliggy", "amap", "web"]);

    assert.equal(result.partial, false);
    assert.deepEqual(result.matches.map((match) => match.platform).sort(), ["amap", "ctrip", "dianping", "fliggy", "qunar", "web"]);
    assert.deepEqual([...engines].sort(), ["baidu", "google"]);
    assert.ok(result.matches.every((match) => match.textScore >= 0.9));
  } finally {
    if (previousSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpKey;
    if (previousLimit === undefined) delete process.env.SCAN_MAX_TEXT_SEARCHES;
    else process.env.SCAN_MAX_TEXT_SEARCHES = previousLimit;
  }
});

test("raises image lead strength when multiple original images point to the same page", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousSerpKey = process.env.SERPAPI_API_KEY;
  const previousImageEngines = process.env.SCAN_IMAGE_ENGINES;
  process.env.APP_PASSWORD = "a-strong-private-password";
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example";
  process.env.SERPAPI_API_KEY = "test-serp-key";
  process.env.SCAN_IMAGE_ENGINES = "google_lens";
  try {
    let imageSearches = 0;
    globalThis.fetch = async (value) => {
      const engine = new URL(String(value)).searchParams.get("engine");
      assert.equal(engine, "google_lens");
      imageSearches += 1;
      return Response.json({
        visual_matches: [{
          position: imageSearches === 1 ? 2 : 8,
          title: "同一篇旅行攻略",
          link: "https://travel.example.com/copied-post",
        }],
      });
    };

    const result = await scanPublicWeb({
      url: "https://www.xiaohongshu.com/explore/source-note",
      title: "短标题",
      text: "短正文",
      imageUrls: [
        "https://sns-webpic-qc.xhscdn.com/notes/one.webp",
        "https://sns-webpic-qc.xhscdn.com/notes/two.webp",
      ],
      author: null,
    }, ["web"], "https://radar.example");

    assert.equal(imageSearches, 2);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].matchType, "图片相似");
    assert.equal(result.matches[0].imageScore, 0.91);
    assert.equal(result.matches[0].evidence.length, 2);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
    if (previousSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpKey;
    if (previousImageEngines === undefined) delete process.env.SCAN_IMAGE_ENGINES;
    else process.env.SCAN_IMAGE_ENGINES = previousImageEngines;
  }
});

test("collects Bing pages-with-this-image results as exact image leads", async () => {
  const previousPassword = process.env.APP_PASSWORD;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousSerpKey = process.env.SERPAPI_API_KEY;
  const previousImageEngines = process.env.SCAN_IMAGE_ENGINES;
  process.env.APP_PASSWORD = "a-strong-private-password";
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example";
  process.env.SERPAPI_API_KEY = "test-serp-key";
  process.env.SCAN_IMAGE_ENGINES = "bing_reverse_image";
  try {
    globalThis.fetch = async (value) => {
      const url = new URL(String(value));
      assert.equal(url.searchParams.get("engine"), "bing_reverse_image");
      assert.match(url.searchParams.get("image_url") || "", /^https:\/\/radar\.example\/api\/source-image/);
      return Response.json({
        pages_with_this_image: [{
          position: 1,
          title: "飞猪上的同图旅行内容",
          link: "https://www.bing.com/images/search?id=wrapped",
          source: "https://travel.taobao.com/trip/copied-image?utm_source=bing",
          original: "https://img.example.com/copied.jpg",
          thumbnail: "https://thumb.example.com/copied.jpg",
        }],
      });
    };

    const result = await scanPublicWeb({
      url: "https://www.xiaohongshu.com/explore/source-note",
      title: "短标题",
      text: "短正文",
      imageUrls: ["https://sns-webpic-qc.xhscdn.com/notes/source.webp"],
      author: null,
    }, ["fliggy"], "https://radar.example");

    assert.equal(result.partial, false);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].platform, "fliggy");
    assert.equal(result.matches[0].imageScore, 0.96);
    assert.match(result.matches[0].evidence[0], /^Bing 同图页面命中/);
    assert.doesNotMatch(result.matches[0].targetUrl, /utm_source/);
  } finally {
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
    if (previousSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpKey;
    if (previousImageEngines === undefined) delete process.env.SCAN_IMAGE_ENGINES;
    else process.env.SCAN_IMAGE_ENGINES = previousImageEngines;
  }
});

test("uses the configured public deployment origin for image callbacks", () => {
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://radar.example/app";
  try {
    const request = new Request("http://internal-service:3000/api/scans", {
      headers: { "x-forwarded-host": "proxy.internal", "x-forwarded-proto": "http" },
    });
    assert.equal(publicRequestOrigin(request), "https://radar.example");
  } finally {
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

# 原创雷达

面向小红书创作者的图文侵权线索发现工具。粘贴一条公开的小红书笔记链接，或手机端“复制链接”得到的整段分享文字后，系统会：

1. 提取笔记标题、正文和图片地址；
2. 用百度和 Google 的公开索引搜索正文精确原句与改写特征词；
3. 用 Google Lens 和 Bing 反向图片搜索查找相似图或同图页面；
4. 重点标记大众点评、携程、去哪儿、飞猪和高德地图，同时保留其他公开网页候选；
5. 对文字和图片线索评分，交给用户人工确认、排除或继续处理。

> 结果是“疑似侵权线索”，不是法律结论。系统不会绕过平台登录、验证码或反爬机制，因此无法覆盖仅 App 内可见、未被搜索引擎收录或限制公开访问的内容。

## 部署环境

- Node.js 20.9 或更高版本
- Supabase 数据库
- SerpApi 账号（文字搜索和 Google Lens 图片匹配）

复制 `.env.example` 为 `.env.local` 并配置：

```bash
APP_PASSWORD=至少8位的访问密码
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=服务端专用密钥
SERPAPI_API_KEY=SerpApi密钥
NEXT_PUBLIC_SITE_URL=https://你的正式域名
SCAN_MAX_TEXT_SEARCHES=24
SCAN_MAX_IMAGES=8
SCAN_MAX_IMAGE_SEARCHES=24
SCAN_MAX_PLATFORM_PAGE_FETCHES=12
SCAN_IMAGE_ENGINES=google_lens_exact,google_lens,bing_reverse_image
```

`SUPABASE_SERVICE_ROLE_KEY` 与 `SERPAPI_API_KEY` 只能配置在服务端环境变量中，禁止写进浏览器代码或提交到 GitHub。`SCAN_MAX_TEXT_SEARCHES` 默认 24 次，按平台轮流执行不同原句和独立特征组合，不会把预算全部耗在同一个长句上。`SCAN_MAX_IMAGES` 默认从整篇笔记均匀选取最多 8 张原图，`SCAN_MAX_IMAGE_SEARCHES` 默认 24 次。`SCAN_MAX_PLATFORM_PAGE_FETCHES` 默认读取最多 12 个已经发现的公开平台页面，用完整段落复核改写内容；它不会登录平台、处理验证码或绕过反爬。`SCAN_IMAGE_ENGINES` 默认同时使用 Google Lens 精确同图、Google Lens 视觉相似与 Bing 同图页面。

图片检索不会直接把可能失效的小红书 CDN 地址交给 Google Lens。应用会生成一个 30 分钟有效、带 HMAC 签名的只读图片代理地址；代理仅允许小红书的 `xhscdn.com`、`xhscdn.net`、官网图片域名和固定 Picasso 素材桶，限定图片格式与 12MB 大小，并拒绝其他云存储桶或任意外部 URL，避免 SSRF。

在 Supabase SQL Editor 中按文件名顺序执行 `supabase/migrations/` 下的全部 SQL。已有数据库至少需要补执行 `002_match_history.sql`，然后：

```bash
npm install
npm run dev
npm test
```

## 扣子云部署

1. 从本 GitHub 仓库导入 Web 项目；
2. 创建 Supabase 数据库并执行迁移文件；
3. 设置前五个必需环境变量，并按需设置两个扫描预算选项；
4. 使用 `npm run build` 构建，使用 `npm start` 启动；
5. 在正式环境用一条可公开访问的小红书图文笔记完成端到端扫描。

部署后先登录应用，点击右上角“部署检查”。它会验证正式网址、Supabase 连接和历史字段、扫描预算、图片引擎，以及 SerpApi 账户状态和剩余次数。该接口受登录会话保护，只返回检查结论，不返回访问密码、数据库密钥、SerpApi Key 或账户邮箱。SerpApi 账户状态通过官方 [Account API](https://serpapi.com/account-api) 查询；该查询本身不计入搜索次数。

正式环境可用本人刚复制的公开图文笔记执行自动验收。脚本会登录、检查部署、提交全平台扫描，并确认正文、图片和扫描记录均已生成；它不会输出密码、密钥或笔记正文，也不会删除生成的扫描记录：

```bash
VERIFY_BASE_URL=https://你的正式网址 \
VERIFY_NOTE_INPUT='小红书链接或整段分享文字' \
VERIFY_APP_PASSWORD='访问密码' \
npm run verify:deployment
```

若在已经配置 `APP_PASSWORD` 的扣子云运行，可省略 `VERIFY_APP_PASSWORD`。验收要求扫描状态为“已完成”；“部分完成”会按失败处理，便于暴露任何未成功的搜索引擎或平台查询。

## 当前匹配范围

| 平台 | 域名 |
| --- | --- |
| 大众点评 | `dianping.com`, `dpurl.cn` |
| 携程 | `ctrip.com`, `trip.com` |
| 去哪儿 | `qunar.com` |
| 飞猪 | `fliggy.com`, `alitrip.com`, `travel.taobao.com`, `trip.taobao.com` |
| 高德地图 | `amap.com`, `gaode.com` |
| 其他公开网页 | 除小红书和搜索引擎本身之外的公开域名 |

文字检索会先删除话题标签、`@生活薯` 等账号召唤、平台助手名称、点赞收藏等公共操作文本，再从正文选取有区分度的地点、路线、出口、距离和关键句。查询预算按平台轮流分配给不同原句与特征组合；候选链接被发现后，系统会在不登录、不绕过验证码的前提下读取已知平台的公开页面，用“段落对段落”方式复核改写内容。图片检索从整篇笔记均匀选图，并分别请求 Google Lens 精确同图、Google Lens 视觉相似和 Bing 同图页面。普通视觉相似结果不再自动越过阈值；同一目标页面命中多张不同原图时才会明显升权，以兼顾裁切、调色、去水印和拼图复用。图片分数仍是“线索强度”，不是侵权概率。

大众点评、携程、去哪儿、飞猪和高德的用户内容搜索并没有统一的匿名公开 API：例如高德公开接口主要返回 POI，大众点评公开搜索可能要求身份核实。项目不会调用未公开接口或绕过平台安全机制。若后续取得平台开放接口、合作权限或一个获授权的站内搜索服务，可在候选发现层接入；当前版本会优先用图片反查发现这些未被普通搜索引擎收录的公开页面，再直接读取页面进行图文复核。

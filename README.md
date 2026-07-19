# 原创雷达

面向小红书创作者的图文侵权线索发现工具。粘贴一条公开的小红书笔记链接后，系统会：

1. 提取笔记标题、正文和图片地址；
2. 用百度和 Google 的公开索引搜索正文关键句；
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
SCAN_MAX_TEXT_SEARCHES=18
SCAN_IMAGE_ENGINES=google_lens,bing_reverse_image
```

`SUPABASE_SERVICE_ROLE_KEY` 与 `SERPAPI_API_KEY` 只能配置在服务端环境变量中，禁止写进浏览器代码或提交到 GitHub。`SCAN_MAX_TEXT_SEARCHES` 可选，默认每条笔记最多执行 18 次文字检索；调低会减少 SerpApi 用量，也会降低覆盖率。`SCAN_IMAGE_ENGINES` 默认同时使用 Google Lens 与 Bing，若额度有限可只填写其中一个引擎。

图片检索不会直接把可能失效的小红书 CDN 地址交给 Google Lens。应用会生成一个 30 分钟有效、带 HMAC 签名的只读图片代理地址；代理仅允许小红书图片域名、限定图片格式与 12MB 大小，并拒绝任意外部 URL，避免 SSRF。

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

## 当前匹配范围

| 平台 | 域名 |
| --- | --- |
| 大众点评 | `dianping.com` |
| 携程 | `ctrip.com`, `trip.com` |
| 去哪儿 | `qunar.com` |
| 飞猪 | `fliggy.com`, `alitrip.com`, `travel.taobao.com`, `trip.taobao.com` |
| 高德地图 | `amap.com`, `gaode.com` |
| 其他公开网页 | 除小红书和搜索引擎本身之外的公开域名 |

文字检索从正文选取最多三个有区分度的关键句，在查询预算内交叉使用百度和 Google 逐平台检索；图片检索最多处理原笔记前四张图片，并合并 Google Lens 视觉/精确结果与 Bing 的同图页面。图片分数是根据精确匹配标记、视觉结果排序、搜索引擎交叉命中以及同一页面命中的原图数量形成的“线索强度”，不是侵权概率。重新扫描会先刷新小红书正文和可能已过期的原图地址。已经收集的链接不会因为后续搜索暂时未命中而被删除；系统保留首次发现、最近命中与本轮状态。单个查询失败不会丢弃其他已成功的结果，匹配结果按综合线索强度排序并可导出 CSV。

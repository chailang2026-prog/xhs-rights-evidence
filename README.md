# 原创雷达

面向小红书创作者的图文侵权线索发现工具。粘贴一条公开的小红书笔记链接后，系统会：

1. 提取笔记标题、正文和图片地址；
2. 用百度公开索引搜索正文关键句；
3. 用 Google Lens 搜索相似图片；
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
SCAN_MAX_TEXT_SEARCHES=12
```

`SUPABASE_SERVICE_ROLE_KEY` 与 `SERPAPI_API_KEY` 只能配置在服务端环境变量中，禁止写进浏览器代码或提交到 GitHub。`SCAN_MAX_TEXT_SEARCHES` 可选，默认每条笔记最多执行 12 次文字检索。

图片检索不会直接把可能失效的小红书 CDN 地址交给 Google Lens。应用会生成一个 30 分钟有效、带 HMAC 签名的只读图片代理地址；代理仅允许小红书图片域名、限定图片格式与 12MB 大小，并拒绝任意外部 URL，避免 SSRF。

在 Supabase SQL Editor 中执行 `supabase/migrations/001_original_radar.sql`，然后：

```bash
npm install
npm run dev
npm test
```

## 扣子云部署

1. 从本 GitHub 仓库导入 Web 项目；
2. 创建 Supabase 数据库并执行迁移文件；
3. 设置上述五个环境变量；
4. 使用 `npm run build` 构建，使用 `npm start` 启动；
5. 在正式环境用一条可公开访问的小红书图文笔记完成端到端扫描。

## 当前匹配范围

| 平台 | 域名 |
| --- | --- |
| 大众点评 | `dianping.com` |
| 携程 | `ctrip.com`, `trip.com` |
| 去哪儿 | `qunar.com` |
| 飞猪 | `fliggy.com`, `alitrip.com` |
| 高德地图 | `amap.com`, `gaode.com` |
| 其他公开网页 | 除小红书和搜索引擎本身之外的公开域名 |

文字检索从正文选取最多两个有区分度的关键句，按查询预算逐平台检索；图片检索最多处理原笔记前四张图片。单个查询失败不会丢弃其他已成功的结果，匹配结果按综合相似度排序并可导出 CSV。

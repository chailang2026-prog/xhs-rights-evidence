import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f3ed",
};

const description = "粘贴小红书原创笔记链接，自动在旅行出游与生活探店平台中寻找疑似文字搬运和图片盗用线索。";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "原创雷达｜小红书笔记侵权匹配",
  description,
  openGraph: {
    title: "原创雷达",
    description,
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og-radar.png", width: 1200, height: 630, alt: "原创雷达：贴入笔记，寻找搬运痕迹" }],
  },
  twitter: { card: "summary_large_image", title: "原创雷达", description, images: ["/og-radar.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

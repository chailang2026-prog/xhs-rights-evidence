export const platformIds = ["dianping", "ctrip", "qunar", "fliggy", "amap", "web"] as const;
export type PlatformId = (typeof platformIds)[number];

export const targetPlatforms: Array<{
  id: PlatformId;
  name: string;
  domains: string[];
}> = [
  { id: "dianping", name: "大众点评", domains: ["dianping.com"] },
  { id: "ctrip", name: "携程", domains: ["ctrip.com", "trip.com"] },
  { id: "qunar", name: "去哪儿", domains: ["qunar.com"] },
  { id: "fliggy", name: "飞猪", domains: ["fliggy.com", "alitrip.com"] },
  { id: "amap", name: "高德地图", domains: ["amap.com", "gaode.com"] },
  { id: "web", name: "其他公开网页", domains: [] },
];

export const reviewStatuses = ["待复核", "确认侵权", "已排除", "处理中", "已解决"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export type ScanStatus = "扫描中" | "已完成" | "部分完成" | "扫描失败";

export type SourceNote = {
  url: string;
  title: string;
  text: string;
  imageUrls: string[];
  author: string | null;
};

export type ScanMatch = {
  id: string;
  scanId: string;
  targetUrl: string;
  platform: PlatformId;
  platformName: string;
  title: string;
  snippet: string;
  thumbnailUrl: string | null;
  textScore: number;
  imageScore: number;
  overallScore: number;
  matchType: "文字相似" | "图片相似" | "图文相似";
  reviewStatus: ReviewStatus;
  evidence: string[];
  discoveredAt: string;
};

export type NoteScan = {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceText: string;
  sourceImages: string[];
  sourceAuthor: string | null;
  selectedPlatforms: PlatformId[];
  status: ScanStatus;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  matches: ScanMatch[];
};

export type CandidateMatch = Omit<ScanMatch, "id" | "scanId" | "reviewStatus" | "discoveredAt">;

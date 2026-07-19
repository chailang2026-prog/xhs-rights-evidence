import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidateMatch,
  NoteScan,
  PlatformId,
  ReviewStatus,
  ScanMatch,
  ScanStatus,
  SourceNote,
} from "./types";

let client: SupabaseClient | null = null;

function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("尚未配置 Supabase 数据库。请在部署环境设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。");
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

type MatchRow = {
  id: string;
  scan_id: string;
  target_url: string;
  platform: PlatformId;
  platform_name: string;
  title: string;
  snippet: string;
  thumbnail_url: string | null;
  text_score: number;
  image_score: number;
  overall_score: number;
  match_type: ScanMatch["matchType"];
  review_status: ReviewStatus;
  evidence: string[] | null;
  discovered_at: string;
};

type ScanRow = {
  id: string;
  source_url: string;
  source_title: string;
  source_text: string;
  source_images: string[] | null;
  source_author: string | null;
  selected_platforms: PlatformId[];
  status: ScanStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  scan_matches?: MatchRow[];
};

function toMatch(row: MatchRow): ScanMatch {
  return {
    id: row.id,
    scanId: row.scan_id,
    targetUrl: row.target_url,
    platform: row.platform,
    platformName: row.platform_name,
    title: row.title,
    snippet: row.snippet,
    thumbnailUrl: row.thumbnail_url,
    textScore: Number(row.text_score),
    imageScore: Number(row.image_score),
    overallScore: Number(row.overall_score),
    matchType: row.match_type,
    reviewStatus: row.review_status,
    evidence: row.evidence || [],
    discoveredAt: row.discovered_at,
  };
}

function toScan(row: ScanRow): NoteScan {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceText: row.source_text,
    sourceImages: row.source_images || [],
    sourceAuthor: row.source_author,
    selectedPlatforms: row.selected_platforms,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    matches: (row.scan_matches || []).map(toMatch).sort((a, b) => b.overallScore - a.overallScore),
  };
}

export async function listScans() {
  const { data, error } = await database()
    .from("note_scans")
    .select("*, scan_matches(*)")
    .order("created_at", { ascending: false })
    .order("overall_score", { referencedTable: "scan_matches", ascending: false });
  if (error) throw error;
  return (data as ScanRow[]).map(toScan);
}

export async function getScan(id: string) {
  const { data, error } = await database()
    .from("note_scans")
    .select("*, scan_matches(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return toScan(data as ScanRow);
}

export async function createScan(source: SourceNote, selectedPlatforms: PlatformId[]) {
  const { data, error } = await database()
    .from("note_scans")
    .insert({
      source_url: source.url,
      source_title: source.title,
      source_text: source.text,
      source_images: source.imageUrls,
      source_author: source.author,
      selected_platforms: selectedPlatforms,
      status: "扫描中",
    })
    .select()
    .single();
  if (error) throw error;
  return toScan({ ...(data as ScanRow), scan_matches: [] });
}

export async function finishScan(id: string, status: ScanStatus, errorMessage: string | null = null) {
  const { error } = await database()
    .from("note_scans")
    .update({ status, error_message: errorMessage, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markScanRunning(id: string) {
  const { error } = await database()
    .from("note_scans")
    .update({ status: "扫描中", error_message: null, completed_at: null })
    .eq("id", id);
  if (error) throw error;
}

export async function refreshScanSource(id: string, source: SourceNote) {
  const { error } = await database()
    .from("note_scans")
    .update({
      source_url: source.url,
      source_title: source.title,
      source_text: source.text,
      source_images: source.imageUrls,
      source_author: source.author,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function replaceMatches(scanId: string, matches: CandidateMatch[]) {
  const db = database();
  const { data: previous, error: previousError } = await db
    .from("scan_matches")
    .select("target_url, review_status")
    .eq("scan_id", scanId);
  if (previousError) throw previousError;
  const previousStatuses = new Map((previous || []).map((item) => [item.target_url as string, item.review_status as ReviewStatus]));
  const { error: deleteError } = await db.from("scan_matches").delete().eq("scan_id", scanId);
  if (deleteError) throw deleteError;
  if (!matches.length) return;
  const { error } = await db.from("scan_matches").insert(
    matches.map((match) => ({
      scan_id: scanId,
      target_url: match.targetUrl,
      platform: match.platform,
      platform_name: match.platformName,
      title: match.title,
      snippet: match.snippet,
      thumbnail_url: match.thumbnailUrl,
      text_score: match.textScore,
      image_score: match.imageScore,
      overall_score: match.overallScore,
      match_type: match.matchType,
      review_status: previousStatuses.get(match.targetUrl) || "待复核",
      evidence: match.evidence,
    })),
  );
  if (error) throw error;
}

export async function updateMatchReview(id: string, reviewStatus: ReviewStatus) {
  const { data, error } = await database()
    .from("scan_matches")
    .update({ review_status: reviewStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function deleteScan(id: string) {
  const { data, error } = await database().from("note_scans").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

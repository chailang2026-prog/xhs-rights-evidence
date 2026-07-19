create extension if not exists pgcrypto;

create table if not exists public.note_scans (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  source_title text not null default '',
  source_text text not null default '',
  source_images jsonb not null default '[]'::jsonb,
  source_author text,
  selected_platforms jsonb not null default '[]'::jsonb,
  status text not null default '扫描中' check (status in ('扫描中', '已完成', '部分完成', '扫描失败')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.scan_matches (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.note_scans(id) on delete cascade,
  target_url text not null,
  platform text not null check (platform in ('dianping', 'ctrip', 'qunar', 'fliggy', 'amap', 'web')),
  platform_name text not null,
  title text not null default '',
  snippet text not null default '',
  thumbnail_url text,
  text_score numeric(4, 3) not null default 0,
  image_score numeric(4, 3) not null default 0,
  overall_score numeric(4, 3) not null default 0,
  match_type text not null check (match_type in ('文字相似', '图片相似', '图文相似')),
  review_status text not null default '待复核' check (review_status in ('待复核', '确认侵权', '已排除', '处理中', '已解决')),
  evidence jsonb not null default '[]'::jsonb,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scan_id, target_url)
);

create index if not exists note_scans_created_at_idx on public.note_scans(created_at desc);
create index if not exists scan_matches_scan_id_idx on public.scan_matches(scan_id);
create index if not exists scan_matches_review_status_idx on public.scan_matches(review_status);
create index if not exists scan_matches_overall_score_idx on public.scan_matches(overall_score desc);

alter table public.note_scans enable row level security;
alter table public.scan_matches enable row level security;

-- The application uses SUPABASE_SERVICE_ROLE_KEY on the server. No anonymous
-- browser policy is created, so note content and matches are not publicly readable.

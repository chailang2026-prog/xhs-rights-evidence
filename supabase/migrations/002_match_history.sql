alter table public.scan_matches
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_current boolean not null default true;

update public.scan_matches
set last_seen_at = coalesce(last_seen_at, discovered_at),
    is_current = coalesce(is_current, true);

create index if not exists scan_matches_is_current_idx
  on public.scan_matches(scan_id, is_current);

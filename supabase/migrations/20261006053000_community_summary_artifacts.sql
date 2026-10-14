-- Grounded, permission-aware interval summaries for public communities.
-- The table is intentionally service-role-only; the API verifies membership
-- before reading or writing an artifact.
begin;
set local lock_timeout = '5s';

create table if not exists public.community_summary_artifacts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  window_hours smallint not null check (window_hours in (6, 12, 24, 72)),
  window_start timestamptz not null,
  window_end timestamptz not null,
  source_fingerprint text not null check (char_length(source_fingerprint) between 16 and 128),
  source_ids text[] not null default '{}',
  model_version text not null,
  prompt_version text not null,
  result jsonb not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint community_summary_window_valid check (window_start < window_end)
);

create unique index if not exists community_summary_current_idx
  on public.community_summary_artifacts(community_id, window_hours, window_end, source_fingerprint);
create index if not exists community_summary_lookup_idx
  on public.community_summary_artifacts(community_id, window_hours, window_end desc);

alter table public.community_summary_artifacts enable row level security;
revoke all on public.community_summary_artifacts from public, anon, authenticated;
grant all on public.community_summary_artifacts to service_role;

commit;

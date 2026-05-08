-- ============================================================================
-- 20260508000000_ai_memory_layer.sql
-- ----------------------------------------------------------------------------
-- Phase 1 of the AI-native overhaul: introduces a persistent memory layer the
-- AI can read from and write to across sessions. Three scopes:
--
--   workspace_memory  — facts, preferences, tone, USPs, "what works"
--   lead_memory       — per-lead context, prior interactions, reactions
--   campaign_memory   — campaign-level outcomes, CTAs, subject-line patterns
--
-- All tables are ADDITIVE. No existing column or row is modified. RLS is
-- workspace-scoped to match the post-20260305200002_rls_workspace_rewrite
-- conventions. JSONB `embedding_meta` is reserved for a follow-up migration
-- that will add a pgvector column once the embedding pipeline is in place
-- (Phase 2). Vector search is NOT yet implemented — `kind`+`scope_id`+`tags`
-- give us a workable retrieval path until then.
-- ============================================================================

-- ── workspace_memory ────────────────────────────────────────────────────────
create table if not exists public.workspace_memory (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null,
  -- e.g. 'preference' | 'fact' | 'tone' | 'usp' | 'winning_pattern' | 'avoid'
  key           text,
  value         jsonb not null,
  source        text,
  -- e.g. 'user' | 'campaign_feedback' | 'business_profile' | 'ai_inference'
  confidence    numeric(3,2) not null default 0.50 check (confidence between 0 and 1),
  tags          text[] not null default '{}',
  embedding_meta jsonb,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz
);

create index if not exists idx_workspace_memory_workspace_kind
  on public.workspace_memory (workspace_id, kind);
create index if not exists idx_workspace_memory_tags
  on public.workspace_memory using gin (tags);
create index if not exists idx_workspace_memory_recent
  on public.workspace_memory (workspace_id, updated_at desc);

alter table public.workspace_memory enable row level security;

create policy workspace_memory_select on public.workspace_memory
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy workspace_memory_write on public.workspace_memory
  for all using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  ) with check (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- ── lead_memory ─────────────────────────────────────────────────────────────
create table if not exists public.lead_memory (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  kind          text not null,
  -- e.g. 'interaction' | 'objection' | 'interest' | 'context' | 'reaction'
  value         jsonb not null,
  source        text,
  confidence    numeric(3,2) not null default 0.50 check (confidence between 0 and 1),
  tags          text[] not null default '{}',
  embedding_meta jsonb,
  occurred_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_lead_memory_lead
  on public.lead_memory (lead_id, created_at desc);
create index if not exists idx_lead_memory_workspace_kind
  on public.lead_memory (workspace_id, kind);
create index if not exists idx_lead_memory_tags
  on public.lead_memory using gin (tags);

alter table public.lead_memory enable row level security;

create policy lead_memory_select on public.lead_memory
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy lead_memory_write on public.lead_memory
  for all using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  ) with check (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- ── campaign_memory ─────────────────────────────────────────────────────────
-- Campaign FK is left soft (text identifier) because campaigns/sequences may
-- live in multiple tables (email_sequences, social_posts, automations). The
-- writer is responsible for setting `campaign_kind` + `campaign_id` correctly.
create table if not exists public.campaign_memory (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  campaign_kind text not null,
  -- e.g. 'email_sequence' | 'social_post' | 'automation'
  campaign_id   text not null,
  kind          text not null,
  -- e.g. 'outcome' | 'best_subject' | 'best_cta' | 'send_window' | 'segment_fit'
  value         jsonb not null,
  metric_value  numeric,
  -- optional headline metric (open rate, reply rate, conversion %, etc.)
  source        text,
  confidence    numeric(3,2) not null default 0.50 check (confidence between 0 and 1),
  tags          text[] not null default '{}',
  embedding_meta jsonb,
  observed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_campaign_memory_workspace_kind
  on public.campaign_memory (workspace_id, kind);
create index if not exists idx_campaign_memory_campaign
  on public.campaign_memory (campaign_kind, campaign_id, observed_at desc);
create index if not exists idx_campaign_memory_tags
  on public.campaign_memory using gin (tags);

alter table public.campaign_memory enable row level security;

create policy campaign_memory_select on public.campaign_memory
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy campaign_memory_write on public.campaign_memory
  for all using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  ) with check (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- ── updated_at trigger for workspace_memory ─────────────────────────────────
create or replace function public.touch_workspace_memory()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_workspace_memory_touch on public.workspace_memory;
create trigger trg_workspace_memory_touch
  before update on public.workspace_memory
  for each row execute function public.touch_workspace_memory();

-- ── Comments (self-documenting) ─────────────────────────────────────────────
comment on table public.workspace_memory is
  'Persistent AI memory at workspace scope. Tone, preferences, USPs, winning patterns. Read on every Gemini call to prime the system prompt.';
comment on table public.lead_memory is
  'Per-lead context the AI can recall: prior interactions, objections, interests, sentiment.';
comment on table public.campaign_memory is
  'Per-campaign outcomes: best-performing subjects, CTAs, send windows, segment fit. Feeds back into future campaign generation.';

-- ============================================================
-- SCALIYO MVP MIGRATION
-- Safe to run on existing database — uses IF NOT EXISTS everywhere
-- Run in Supabase SQL Editor (paste entire file, run once)
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 1: WORKSPACE FOUNDATION                            ║
-- ║  Creates workspaces + workspace_members if they don't    ║
-- ║  exist. These are prerequisites for everything else.     ║
-- ╚══════════════════════════════════════════════════════════╝

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL DEFAULT 'My Workspace',
  slug       TEXT UNIQUE,
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_tier  TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- Workspace role enum (skip if exists)
DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Workspace members table
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  invited_by   UUID REFERENCES auth.users(id),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Helper: check workspace membership
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$;

-- Workspace RLS policies
DO $$ BEGIN
  CREATE POLICY "workspace_select" ON workspaces FOR SELECT
    USING (is_workspace_member(id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "workspace_update" ON workspaces FOR UPDATE
    USING (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "workspace_insert" ON workspaces FOR INSERT
    WITH CHECK (owner_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Membership RLS
DO $$ BEGIN
  CREATE POLICY "members_select" ON workspace_members FOR SELECT
    USING (is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members_insert" ON workspace_members FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = workspace_members.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
      )
      OR user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "members_delete" ON workspace_members FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = workspace_members.workspace_id
          AND wm.user_id = auth.uid()
          AND wm.role IN ('owner', 'admin')
      )
      OR user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-create workspace on user signup
CREATE OR REPLACE FUNCTION handle_new_user_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO workspaces (id, name, owner_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'My Workspace'), NEW.id);

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_auth_user_created_workspace ON auth.users;
CREATE TRIGGER on_auth_user_created_workspace
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_workspace();

-- Backfill: create workspaces for existing users who don't have one
INSERT INTO workspaces (id, name, owner_id)
SELECT u.id, COALESCE(p.name, 'My Workspace'), u.id
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = u.id)
ON CONFLICT DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'owner'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_members WHERE workspace_id = w.id AND user_id = w.owner_id
)
ON CONFLICT DO NOTHING;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 2: ADD COLUMNS TO EXISTING TABLES                  ║
-- ╚══════════════════════════════════════════════════════════╝

-- profiles: onboarding + settings fields
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_role TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_team_size TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN others THEN NULL; END $$;

-- Sync full_name from existing 'name' column
UPDATE profiles SET full_name = name WHERE full_name = '' AND name IS NOT NULL AND name != '';

-- workspaces: business profile fields
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS company_name TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS website TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS industry TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN others THEN NULL; END $$;

-- leads: workspace + expanded fields
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS title TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_size TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS location TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS knowledge_base JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS import_batch_id TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'; EXCEPTION WHEN others THEN NULL; END $$;

-- Backfill leads.workspace_id from client_id for existing rows
UPDATE leads SET workspace_id = client_id WHERE workspace_id IS NULL AND client_id IS NOT NULL;

-- subscriptions: credits + billing fields
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS seats_included INTEGER NOT NULL DEFAULT 1; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS seats_extra INTEGER NOT NULL DEFAULT 0; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credits_total INTEGER NOT NULL DEFAULT 100; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ; EXCEPTION WHEN others THEN NULL; END $$;

-- Backfill subscriptions.workspace_id from user_id
UPDATE subscriptions SET workspace_id = user_id WHERE workspace_id IS NULL AND user_id IS NOT NULL;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 3: NEW TABLES                                      ║
-- ╚══════════════════════════════════════════════════════════╝

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#6366f1',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "tags_select" ON tags FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tags_insert" ON tags FOR INSERT WITH CHECK (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tags_update" ON tags FOR UPDATE USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "tags_delete" ON tags FOR DELETE USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lead Tag Assignments
CREATE TABLE IF NOT EXISTS lead_tag_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lead_id, tag_id)
);
ALTER TABLE lead_tag_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "lta_select" ON lead_tag_assignments FOR SELECT USING (EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_id AND is_workspace_member(l.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "lta_insert" ON lead_tag_assignments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_id AND is_workspace_member(l.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "lta_delete" ON lead_tag_assignments FOR DELETE USING (EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_id AND is_workspace_member(l.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lead Notes
CREATE TABLE IF NOT EXISTS lead_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES auth.users(id),
  content         TEXT NOT NULL,
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);
ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "notes_select" ON lead_notes FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "notes_insert" ON lead_notes FOR INSERT WITH CHECK (is_workspace_member(workspace_id) AND author_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "notes_update" ON lead_notes FOR UPDATE USING (author_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "notes_delete" ON lead_notes FOR DELETE USING (author_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Workspace Invites
CREATE TABLE IF NOT EXISTS workspace_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          workspace_role NOT NULL DEFAULT 'member',
  invited_by    UUID NOT NULL REFERENCES auth.users(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  token         TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, email)
);
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "invites_select" ON workspace_invites FOR SELECT USING (is_workspace_member(workspace_id) OR email = (SELECT email FROM profiles WHERE id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invites_insert" ON workspace_invites FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = workspace_invites.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner', 'admin'))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invites_update" ON workspace_invites FOR UPDATE USING (email = (SELECT email FROM profiles WHERE id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Email Sequences
CREATE TABLE IF NOT EXISTS email_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  goal          TEXT,
  tone          TEXT DEFAULT 'professional',
  total_leads   INTEGER NOT NULL DEFAULT 0,
  total_sent    INTEGER NOT NULL DEFAULT 0,
  total_opened  INTEGER NOT NULL DEFAULT 0,
  total_clicked INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sequences_workspace ON email_sequences(workspace_id);
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "seq_select" ON email_sequences FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "seq_insert" ON email_sequences FOR INSERT WITH CHECK (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "seq_update" ON email_sequences FOR UPDATE USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "seq_delete" ON email_sequences FOR DELETE USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sequence Steps
CREATE TABLE IF NOT EXISTS sequence_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number     INTEGER NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  delay_days      INTEGER NOT NULL DEFAULT 0,
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sequence_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON sequence_steps(sequence_id);
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "steps_select" ON sequence_steps FOR SELECT USING (EXISTS (SELECT 1 FROM email_sequences s WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "steps_insert" ON sequence_steps FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM email_sequences s WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "steps_update" ON sequence_steps FOR UPDATE USING (EXISTS (SELECT 1 FROM email_sequences s WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "steps_delete" ON sequence_steps FOR DELETE USING (EXISTS (SELECT 1 FROM email_sequences s WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sequence Enrollments
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  current_step    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'bounced', 'unsubscribed')),
  next_send_at    TIMESTAMPTZ,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE(sequence_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_next ON sequence_enrollments(next_send_at) WHERE status = 'active' AND next_send_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_workspace ON sequence_enrollments(workspace_id);
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "enroll_select" ON sequence_enrollments FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "enroll_insert" ON sequence_enrollments FOR INSERT WITH CHECK (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "enroll_update" ON sequence_enrollments FOR UPDATE USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  title         TEXT NOT NULL,
  message       TEXT,
  link          TEXT,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "notif_select" ON notifications FOR SELECT USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "notif_update" ON notifications FOR UPDATE USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Activity Feed
CREATE TABLE IF NOT EXISTS activity_feed (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  description   TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_feed(workspace_id, created_at DESC);
ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "activity_select" ON activity_feed FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Usage Counters
CREATE TABLE IF NOT EXISTS usage_counters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  counter_type    TEXT NOT NULL,
  period_key      TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, counter_type, period_key)
);
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "usage_select" ON usage_counters FOR SELECT USING (is_workspace_member(workspace_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 4: SEQUENCE COLUMNS ON email_messages              ║
-- ╚══════════════════════════════════════════════════════════╝

DO $$ BEGIN ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sequence_id UUID REFERENCES email_sequences(id) ON DELETE SET NULL; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS sequence_step INTEGER; EXCEPTION WHEN others THEN NULL; END $$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 5: HELPER FUNCTIONS                                ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION consume_credits(ws_id UUID, amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
  current_used INTEGER;
BEGIN
  SELECT credits_total, credits_used INTO current_credits, current_used
  FROM subscriptions WHERE workspace_id = ws_id FOR UPDATE;

  IF current_credits IS NULL OR current_credits - current_used < amount THEN
    RETURN FALSE;
  END IF;

  UPDATE subscriptions
  SET credits_used = credits_used + amount
  WHERE workspace_id = ws_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_usage(ws_id UUID, ctype TEXT, amount INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_counters (workspace_id, counter_type, period_key, count)
  VALUES (ws_id, ctype, to_char(NOW(), 'YYYY-MM'), amount)
  ON CONFLICT (workspace_id, counter_type, period_key)
  DO UPDATE SET count = usage_counters.count + amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_lead_notes_updated_at ON lead_notes;
  CREATE TRIGGER trg_lead_notes_updated_at BEFORE UPDATE ON lead_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_sequences_updated_at ON email_sequences;
  CREATE TRIGGER trg_sequences_updated_at BEFORE UPDATE ON email_sequences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_steps_updated_at ON sequence_steps;
  CREATE TRIGGER trg_steps_updated_at BEFORE UPDATE ON sequence_steps FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN others THEN NULL;
END $$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  PART 6: INDEXES                                         ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE INDEX IF NOT EXISTS idx_leads_workspace_id ON leads(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_workspace_status ON leads(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_workspace_score ON leads(workspace_id, score DESC) WHERE deleted_at IS NULL;


-- ============================================================
-- DONE. Tables created:
--   workspaces, workspace_members, tags, lead_tag_assignments,
--   lead_notes, workspace_invites, email_sequences, sequence_steps,
--   sequence_enrollments, notifications, activity_feed, usage_counters
--
-- Columns added to: profiles, workspaces, leads, subscriptions, email_messages
-- Functions: is_workspace_member, consume_credits, increment_usage, update_updated_at
-- Trigger: auto-create workspace on signup + backfill for existing users
-- ============================================================

-- ============================================================
-- SCALIYO DATABASE SCHEMA
-- Version: 1.0 (MVP)
-- ============================================================
-- This schema is designed for Supabase (PostgreSQL 15+)
-- with Row-Level Security on all tables.
--
-- Conventions:
--   - All tables use UUID primary keys
--   - All timestamps are timestamptz
--   - workspace_id is the tenant isolation column
--   - created_at / updated_at on every table
--   - Soft deletes via deleted_at where appropriate
-- ============================================================

-- =========================
-- EXTENSIONS
-- =========================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- ENUMS
-- =========================

CREATE TYPE user_role AS ENUM ('super_admin', 'user');
CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost');
CREATE TYPE lead_source AS ENUM ('csv_import', 'manual', 'apollo', 'api', 'website', 'referral');
CREATE TYPE email_provider AS ENUM ('gmail', 'sendgrid', 'smtp', 'mailchimp');
CREATE TYPE sender_status AS ENUM ('active', 'paused', 'error', 'needs_reauth');
CREATE TYPE email_msg_status AS ENUM ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed');
CREATE TYPE email_event_type AS ENUM ('open', 'click', 'delivered', 'bounced', 'unsubscribe', 'spam_report');
CREATE TYPE scheduled_email_status AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled');
CREATE TYPE sequence_status AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');
CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'paused');
CREATE TYPE workflow_exec_status AS ENUM ('running', 'completed', 'failed', 'cancelled');
CREATE TYPE node_type AS ENUM ('trigger', 'action', 'condition', 'wait');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete');
CREATE TYPE billing_interval AS ENUM ('monthly', 'annual');
CREATE TYPE notification_type AS ENUM ('info', 'success', 'warning', 'error');
CREATE TYPE audit_category AS ENUM ('auth', 'lead', 'email', 'team', 'billing', 'admin', 'automation', 'system');

-- =========================
-- 1. PROFILES
-- =========================
-- Purpose: Stores user account data, linked 1:1 with auth.users.
-- Created automatically via trigger on auth.users INSERT.

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'user',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  -- Onboarding
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_role      TEXT,        -- 'sdr', 'revops', 'agency', 'founder'
  onboarding_team_size TEXT,        -- 'solo', '2-5', '6-20', '20+'

  -- Preferences (JSONB for flexibility)
  preferences   JSONB NOT NULL DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);

-- RLS: Users can read/update own profile. Super admins can read all.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin'
  ));

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_self" ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- =========================
-- 2. WORKSPACES
-- =========================
-- Purpose: Tenant container. All business data is scoped to a workspace.

CREATE TABLE workspaces (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  owner_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Business profile
  company_name  TEXT,
  website       TEXT,
  industry      TEXT,
  description   TEXT,
  logo_url      TEXT,

  -- Settings
  settings      JSONB NOT NULL DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- =========================
-- 3. WORKSPACE MEMBERS
-- =========================
-- Purpose: Junction table linking profiles to workspaces with roles.

CREATE TABLE workspace_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role          workspace_role NOT NULL DEFAULT 'member',
  invited_by    UUID REFERENCES profiles(id),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_wm_user ON workspace_members(user_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- Helper function: check workspace membership
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check workspace role
CREATE OR REPLACE FUNCTION get_workspace_role(ws_id UUID)
RETURNS workspace_role AS $$
  SELECT role FROM workspace_members
  WHERE workspace_id = ws_id AND user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS for workspace_members
CREATE POLICY "wm_select" ON workspace_members FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "wm_insert" ON workspace_members FOR INSERT
  WITH CHECK (
    get_workspace_role(workspace_id) IN ('owner', 'admin')
    OR user_id = auth.uid() -- self-join via invite
  );

CREATE POLICY "wm_delete" ON workspace_members FOR DELETE
  USING (
    get_workspace_role(workspace_id) IN ('owner', 'admin')
    OR user_id = auth.uid() -- can leave
  );

-- RLS for workspaces
CREATE POLICY "ws_select" ON workspaces FOR SELECT
  USING (is_workspace_member(id));

CREATE POLICY "ws_update" ON workspaces FOR UPDATE
  USING (get_workspace_role(id) IN ('owner', 'admin'));

CREATE POLICY "ws_insert" ON workspaces FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- =========================
-- 4. WORKSPACE INVITES
-- =========================
-- Purpose: Pending team invitations.

CREATE TABLE workspace_invites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          workspace_role NOT NULL DEFAULT 'member',
  invited_by    UUID NOT NULL REFERENCES profiles(id),
  status        invite_status NOT NULL DEFAULT 'pending',
  token         TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id, email)
);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites_select" ON workspace_invites FOR SELECT
  USING (is_workspace_member(workspace_id) OR email = (SELECT email FROM profiles WHERE id = auth.uid()));

CREATE POLICY "invites_insert" ON workspace_invites FOR INSERT
  WITH CHECK (get_workspace_role(workspace_id) IN ('owner', 'admin'));

CREATE POLICY "invites_update" ON workspace_invites FOR UPDATE
  USING (email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- =========================
-- 5. TAGS
-- =========================
-- Purpose: Workspace-level tags for categorizing leads.

CREATE TABLE tags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#6366f1',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id, name)
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_select" ON tags FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "tags_mutate" ON tags FOR ALL
  USING (is_workspace_member(workspace_id));

-- =========================
-- 6. LEADS
-- =========================
-- Purpose: Core CRM entity. Every prospect/contact in the workspace.

CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES profiles(id),
  assigned_to     UUID REFERENCES profiles(id),

  -- Identity
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  email           TEXT,
  phone           TEXT,

  -- Company
  company         TEXT,
  title           TEXT,
  industry        TEXT,
  company_size    TEXT,
  website         TEXT,
  linkedin_url    TEXT,
  location        TEXT,

  -- Pipeline
  status          lead_status NOT NULL DEFAULT 'new',
  score           INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  source          lead_source NOT NULL DEFAULT 'manual',

  -- Enrichment
  knowledge_base  JSONB NOT NULL DEFAULT '{}',
  custom_fields   JSONB NOT NULL DEFAULT '{}',

  -- Import tracking
  import_batch_id TEXT,

  -- Activity
  last_activity_at TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ  -- soft delete
);

CREATE INDEX idx_leads_workspace ON leads(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_workspace_status ON leads(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_workspace_score ON leads(workspace_id, score DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_email ON leads(workspace_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_leads_import_batch ON leads(workspace_id, import_batch_id) WHERE import_batch_id IS NOT NULL;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select" ON leads FOR SELECT
  USING (is_workspace_member(workspace_id) AND deleted_at IS NULL);

CREATE POLICY "leads_insert" ON leads FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "leads_update" ON leads FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "leads_delete" ON leads FOR DELETE
  USING (get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- =========================
-- 7. LEAD TAG ASSIGNMENTS
-- =========================
-- Purpose: Many-to-many junction between leads and tags.

CREATE TABLE lead_tag_assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(lead_id, tag_id)
);

ALTER TABLE lead_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lta_select" ON lead_tag_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM leads l WHERE l.id = lead_id AND is_workspace_member(l.workspace_id)
  ));

CREATE POLICY "lta_mutate" ON lead_tag_assignments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM leads l WHERE l.id = lead_id AND is_workspace_member(l.workspace_id)
  ));

-- =========================
-- 8. LEAD NOTES
-- =========================
-- Purpose: Notes/comments on leads.

CREATE TABLE lead_notes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES profiles(id),
  content       TEXT NOT NULL,
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_notes_lead ON lead_notes(lead_id);

ALTER TABLE lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_select" ON lead_notes FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "notes_insert" ON lead_notes FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id) AND author_id = auth.uid());

CREATE POLICY "notes_update" ON lead_notes FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "notes_delete" ON lead_notes FOR DELETE
  USING (author_id = auth.uid() OR get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- =========================
-- 9. SENDER ACCOUNTS
-- =========================
-- Purpose: Email sending identities (Gmail, SendGrid, SMTP).
-- Credentials stored in separate secrets table.

CREATE TABLE sender_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider        email_provider NOT NULL,
  from_email      TEXT NOT NULL,
  from_name       TEXT NOT NULL DEFAULT '',
  status          sender_status NOT NULL DEFAULT 'active',
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Rate limiting
  daily_limit     INTEGER NOT NULL DEFAULT 50,
  daily_sent      INTEGER NOT NULL DEFAULT 0,
  daily_reset_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',

  -- Health
  health_score    INTEGER NOT NULL DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),

  -- Warmup
  warmup_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  warmup_daily    INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sender_workspace ON sender_accounts(workspace_id);

ALTER TABLE sender_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sender_select" ON sender_accounts FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "sender_mutate" ON sender_accounts FOR ALL
  USING (get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- =========================
-- 10. SENDER ACCOUNT SECRETS
-- =========================
-- Purpose: Encrypted credentials for email providers.
-- Only accessible via service_role (Edge Functions).

CREATE TABLE sender_account_secrets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_account_id UUID NOT NULL REFERENCES sender_accounts(id) ON DELETE CASCADE UNIQUE,

  -- Provider-specific credentials
  api_key           TEXT,
  smtp_host         TEXT,
  smtp_port         INTEGER,
  smtp_user         TEXT,
  smtp_pass         TEXT,
  oauth_access_token  TEXT,
  oauth_refresh_token TEXT,
  oauth_expires_at    TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sender_account_secrets ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — service_role only

-- =========================
-- 11. EMAIL SEQUENCES
-- =========================
-- Purpose: Multi-step email campaigns.

CREATE TABLE email_sequences (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES profiles(id),
  name          TEXT NOT NULL,
  description   TEXT,
  status        sequence_status NOT NULL DEFAULT 'draft',
  goal          TEXT,                  -- 'book_meeting', 'product_demo', 'nurture', etc.
  tone          TEXT DEFAULT 'professional',

  -- Stats (denormalized for performance)
  total_leads   INTEGER NOT NULL DEFAULT 0,
  total_sent    INTEGER NOT NULL DEFAULT 0,
  total_opened  INTEGER NOT NULL DEFAULT 0,
  total_clicked INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sequences_workspace ON email_sequences(workspace_id);

ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seq_select" ON email_sequences FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "seq_mutate" ON email_sequences FOR ALL
  USING (is_workspace_member(workspace_id));

-- =========================
-- 12. SEQUENCE STEPS
-- =========================
-- Purpose: Individual steps within an email sequence.

CREATE TABLE sequence_steps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id   UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number   INTEGER NOT NULL,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  delay_days    INTEGER NOT NULL DEFAULT 0,   -- days to wait before sending
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(sequence_id, step_number)
);

CREATE INDEX idx_steps_sequence ON sequence_steps(sequence_id);

ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "steps_select" ON sequence_steps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM email_sequences s
    WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id)
  ));

CREATE POLICY "steps_mutate" ON sequence_steps FOR ALL
  USING (EXISTS (
    SELECT 1 FROM email_sequences s
    WHERE s.id = sequence_id AND is_workspace_member(s.workspace_id)
  ));

-- =========================
-- 13. SEQUENCE ENROLLMENTS
-- =========================
-- Purpose: Tracks which leads are enrolled in which sequences.

CREATE TABLE sequence_enrollments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id     UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  current_step    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'bounced', 'unsubscribed')),
  next_send_at    TIMESTAMPTZ,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  UNIQUE(sequence_id, lead_id)
);

CREATE INDEX idx_enrollments_next ON sequence_enrollments(next_send_at)
  WHERE status = 'active' AND next_send_at IS NOT NULL;
CREATE INDEX idx_enrollments_workspace ON sequence_enrollments(workspace_id);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enroll_select" ON sequence_enrollments FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "enroll_mutate" ON sequence_enrollments FOR ALL
  USING (is_workspace_member(workspace_id));

-- =========================
-- 14. EMAIL MESSAGES
-- =========================
-- Purpose: Record of every email sent through the platform.

CREATE TABLE email_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  sender_account_id   UUID REFERENCES sender_accounts(id) ON DELETE SET NULL,
  sequence_id         UUID REFERENCES email_sequences(id) ON DELETE SET NULL,
  sequence_step       INTEGER,

  -- Email content
  subject             TEXT NOT NULL,
  to_email            TEXT NOT NULL,
  from_email          TEXT NOT NULL,
  body_html           TEXT,

  -- Provider
  provider            email_provider,
  provider_message_id TEXT,

  -- Status
  status              email_msg_status NOT NULL DEFAULT 'queued',

  -- Tracking flags
  track_opens         BOOLEAN NOT NULL DEFAULT TRUE,
  track_clicks        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Timestamps
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_emails_workspace ON email_messages(workspace_id);
CREATE INDEX idx_emails_lead ON email_messages(lead_id);
CREATE INDEX idx_emails_sequence ON email_messages(sequence_id);
CREATE INDEX idx_emails_status ON email_messages(workspace_id, status);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "emails_select" ON email_messages FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "emails_insert" ON email_messages FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

-- =========================
-- 15. EMAIL LINKS
-- =========================
-- Purpose: Tracked URLs within emails for click tracking.

CREATE TABLE email_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  destination_url TEXT NOT NULL,
  link_label      TEXT,
  link_index      INTEGER NOT NULL DEFAULT 0,
  click_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_links_message ON email_links(message_id);

ALTER TABLE email_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "links_select" ON email_links FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM email_messages m
    WHERE m.id = message_id AND is_workspace_member(m.workspace_id)
  ));

-- =========================
-- 16. EMAIL EVENTS
-- =========================
-- Purpose: Open/click/bounce/delivery events for email tracking.

CREATE TABLE email_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  link_id         UUID REFERENCES email_links(id) ON DELETE SET NULL,
  event_type      email_event_type NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
  is_apple_privacy BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_message ON email_events(message_id);
CREATE INDEX idx_events_type ON email_events(message_id, event_type);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select" ON email_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM email_messages m
    WHERE m.id = message_id AND is_workspace_member(m.workspace_id)
  ));

-- Public insert for tracking pixel/redirect (via Edge Function with service_role)
-- No user-facing insert policy

-- =========================
-- 17. SCHEDULED EMAILS
-- =========================
-- Purpose: Queue of emails waiting to be sent at a specific time.

CREATE TABLE scheduled_emails (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sender_account_id UUID REFERENCES sender_accounts(id),
  sequence_id     UUID REFERENCES email_sequences(id),
  step_number     INTEGER,

  to_email        TEXT NOT NULL,
  from_email      TEXT,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,

  status          scheduled_email_status NOT NULL DEFAULT 'pending',
  scheduled_at    TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_pending ON scheduled_emails(scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_workspace ON scheduled_emails(workspace_id);

ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sched_select" ON scheduled_emails FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "sched_mutate" ON scheduled_emails FOR ALL
  USING (is_workspace_member(workspace_id));

-- =========================
-- 18. WORKFLOWS
-- =========================
-- Purpose: Automation workflow definitions.

CREATE TABLE workflows (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES profiles(id),
  name          TEXT NOT NULL,
  description   TEXT,
  status        workflow_status NOT NULL DEFAULT 'draft',

  -- Workflow definition as JSON (nodes + edges)
  definition    JSONB NOT NULL DEFAULT '{"nodes": [], "edges": []}',

  -- Stats
  total_runs    INTEGER NOT NULL DEFAULT 0,
  success_runs  INTEGER NOT NULL DEFAULT 0,
  failed_runs   INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wf_select" ON workflows FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "wf_mutate" ON workflows FOR ALL
  USING (get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- =========================
-- 19. WORKFLOW EXECUTIONS
-- =========================
-- Purpose: Individual workflow run records.

CREATE TABLE workflow_executions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  triggered_by  TEXT,               -- event that triggered this run
  status        workflow_exec_status NOT NULL DEFAULT 'running',
  current_node  TEXT,
  steps_log     JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_wf_exec_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_wf_exec_workspace ON workflow_executions(workspace_id);

ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wfe_select" ON workflow_executions FOR SELECT
  USING (is_workspace_member(workspace_id));

-- =========================
-- 20. SUBSCRIPTIONS
-- =========================
-- Purpose: Billing subscription state, linked to Stripe.

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,

  -- Plan
  plan_name             TEXT NOT NULL DEFAULT 'free',
  status                subscription_status NOT NULL DEFAULT 'trialing',
  billing_interval      billing_interval NOT NULL DEFAULT 'monthly',

  -- Stripe
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id       TEXT,

  -- Limits
  seats_included        INTEGER NOT NULL DEFAULT 1,
  seats_extra           INTEGER NOT NULL DEFAULT 0,
  credits_total         INTEGER NOT NULL DEFAULT 100,
  credits_used          INTEGER NOT NULL DEFAULT 0,
  credits_reset_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',

  -- Period
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at         TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subs_workspace ON subscriptions(workspace_id);
CREATE INDEX idx_subs_stripe_customer ON subscriptions(stripe_customer_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subs_select" ON subscriptions FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "subs_update" ON subscriptions FOR UPDATE
  USING (get_workspace_role(workspace_id) = 'owner');

-- =========================
-- 21. AUDIT LOGS
-- =========================
-- Purpose: Immutable record of all important actions for compliance and debugging.

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  category      audit_category NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  details       JSONB DEFAULT '{}',
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_workspace ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_category ON audit_logs(workspace_id, category);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select" ON audit_logs FOR SELECT
  USING (
    is_workspace_member(workspace_id)
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

-- Insert via service_role only (no user-facing insert policy)

-- =========================
-- 22. NOTIFICATIONS
-- =========================
-- Purpose: In-app notification system for users.

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          notification_type NOT NULL DEFAULT 'info',
  title         TEXT NOT NULL,
  message       TEXT,
  link          TEXT,                -- optional deep link
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select" ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notif_update" ON notifications FOR UPDATE
  USING (user_id = auth.uid());

-- =========================
-- 23. AI USAGE LOGS
-- =========================
-- Purpose: Track AI operations for credit billing and analytics.

CREATE TABLE ai_usage_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id),
  operation     TEXT NOT NULL,        -- 'email_generation', 'lead_research', etc.
  credits_used  INTEGER NOT NULL,
  tokens_input  INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  model         TEXT,
  latency_ms    INTEGER,
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_workspace ON ai_usage_logs(workspace_id, created_at DESC);

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_select" ON ai_usage_logs FOR SELECT
  USING (is_workspace_member(workspace_id));

-- =========================
-- 24. ACTIVITY FEED
-- =========================
-- Purpose: User-visible activity stream for workspace events.

CREATE TABLE activity_feed (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  description   TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_workspace ON activity_feed(workspace_id, created_at DESC);

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_select" ON activity_feed FOR SELECT
  USING (is_workspace_member(workspace_id));

-- =========================
-- 25. USAGE COUNTERS
-- =========================
-- Purpose: Track workspace-level usage for plan limit enforcement.

CREATE TABLE usage_counters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  counter_type    TEXT NOT NULL,       -- 'emails_sent', 'leads_created', 'ai_credits'
  period_key      TEXT NOT NULL,       -- '2026-03' for monthly
  count           INTEGER NOT NULL DEFAULT 0,

  UNIQUE(workspace_id, counter_type, period_key)
);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_select" ON usage_counters FOR SELECT
  USING (is_workspace_member(workspace_id));

-- =========================
-- HELPER FUNCTIONS
-- =========================

-- Auto-create profile and workspace on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  ws_id UUID;
  ws_slug TEXT;
BEGIN
  -- Create profile
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );

  -- Generate unique workspace slug
  ws_slug := replace(split_part(NEW.email, '@', 1), '.', '-') || '-' || substr(NEW.id::text, 1, 8);

  -- Create default workspace
  INSERT INTO workspaces (id, name, slug, owner_id)
  VALUES (uuid_generate_v4(), 'My Workspace', ws_slug, NEW.id)
  RETURNING id INTO ws_id;

  -- Add user as workspace owner
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (ws_id, NEW.id, 'owner');

  -- Create free subscription
  INSERT INTO subscriptions (workspace_id, plan_name, status, credits_total)
  VALUES (ws_id, 'free', 'trialing', 100);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sender_accounts_updated_at BEFORE UPDATE ON sender_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sequences_updated_at BEFORE UPDATE ON email_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_subs_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Consume AI credits atomically
CREATE OR REPLACE FUNCTION consume_credits(ws_id UUID, amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
  current_used INTEGER;
BEGIN
  SELECT credits_total, credits_used INTO current_credits, current_used
  FROM subscriptions WHERE workspace_id = ws_id FOR UPDATE;

  IF current_credits - current_used < amount THEN
    RETURN FALSE;
  END IF;

  UPDATE subscriptions
  SET credits_used = credits_used + amount
  WHERE workspace_id = ws_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment usage counter atomically
CREATE OR REPLACE FUNCTION increment_usage(ws_id UUID, ctype TEXT, amount INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage_counters (workspace_id, counter_type, period_key, count)
  VALUES (ws_id, ctype, to_char(NOW(), 'YYYY-MM'), amount)
  ON CONFLICT (workspace_id, counter_type, period_key)
  DO UPDATE SET count = usage_counters.count + amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================
-- MATERIALIZED VIEW: Email Analytics
-- =========================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_email_analytics AS
SELECT
  m.workspace_id,
  COUNT(*) AS total_sent,
  COUNT(*) FILTER (WHERE m.status = 'delivered') AS total_delivered,
  COUNT(*) FILTER (WHERE m.status = 'bounced') AS total_bounced,
  COUNT(DISTINCT CASE WHEN e.event_type = 'open' AND NOT e.is_bot THEN m.id END) AS unique_opens,
  COUNT(DISTINCT CASE WHEN e.event_type = 'click' AND NOT e.is_bot THEN m.id END) AS unique_clicks
FROM email_messages m
LEFT JOIN email_events e ON e.message_id = m.id
WHERE m.status IN ('sent', 'delivered', 'bounced')
GROUP BY m.workspace_id;

CREATE UNIQUE INDEX idx_mv_email_analytics ON mv_email_analytics(workspace_id);

-- Refresh function (call via cron or manually)
CREATE OR REPLACE FUNCTION refresh_email_analytics()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_email_analytics;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

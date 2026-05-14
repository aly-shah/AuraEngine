# Scaliyo — Implementation Plan

**Version**: 1.0
**Last Updated**: 2026-03-16

---

## Phase 1: Foundation

**Duration**: ~1 week
**Goal**: Core infrastructure that every other feature depends on.

### Goals
- User can sign up, verify email, log in, and reset password
- Auto-created workspace and profile on signup
- App shell with sidebar navigation and layout
- Router with auth guards and role guards
- Supabase client setup with React Query integration
- Zustand store for UI state
- Onboarding wizard (role, company, team size)
- Profile settings page
- Type system established

### Backend Tasks
- [ ] Deploy database schema (profiles, workspaces, workspace_members, subscriptions)
- [ ] Create `handle_new_user` trigger (auto-create profile + workspace)
- [ ] Set up RLS policies for foundation tables
- [ ] Create `auth-send-email` Edge Function for custom auth emails (optional, can use Supabase defaults initially)

### Frontend Tasks
- [ ] Project setup: Vite + React 19 + TypeScript + Tailwind
- [ ] Install and configure: React Router 7, React Query, Zustand, Lucide icons
- [ ] Supabase client initialization (`lib/supabase.ts`)
- [ ] Auth hooks: `useAuth` (session, login, signup, logout, resetPassword)
- [ ] Workspace context hook: `useWorkspace` (current workspace, members, role)
- [ ] Auth pages: Login, Signup, ConfirmEmail, ResetPassword, ForgotPassword
- [ ] Auth guards: `AuthGuard` (redirect to /auth if not logged in), `RoleGuard` (check workspace role)
- [ ] App shell: `AppLayout` with sidebar, top bar, mobile nav
- [ ] Sidebar navigation component with links
- [ ] Onboarding page: 3-step wizard
- [ ] Profile settings page
- [ ] Error boundary and 404 page
- [ ] Toast/notification system (Zustand-based)
- [ ] Type definitions: `types/index.ts`
- [ ] Config: `config/routes.ts`, `config/plans.ts`
- [ ] Base UI components: Button, Input, Modal, Card, Badge, Avatar, Spinner

### Risks
- Supabase trigger timing on auth.users INSERT (test thoroughly)
- React StrictMode double-render with Supabase auth listeners
- Email verification redirect URL configuration

### Acceptance Criteria
- [ ] User can sign up with email/password
- [ ] Email verification works
- [ ] Login/logout works
- [ ] Password reset flow works
- [ ] Onboarding wizard completes and saves data
- [ ] App shell renders with sidebar navigation
- [ ] Profile page shows and edits user data
- [ ] Unauthorized users are redirected to /auth
- [ ] Workspace context is available throughout the app

---

## Phase 2: CRM & Leads

**Duration**: ~1 week
**Goal**: Full lead management with import, pipeline, scoring, and notes.

### Goals
- Lead database with CRUD
- CSV import with column mapping
- Pipeline stages with visual indicators
- Lead scoring (basic rule-based)
- Lead profile page with notes, tags, and timeline
- Bulk operations (tag, status update, delete)
- Lead search and filtering

### Backend Tasks
- [ ] Deploy schema: leads, lead_notes, tags, lead_tag_assignments
- [ ] RLS policies for all lead tables
- [ ] Bulk import RPC function
- [ ] Lead search/filter queries

### Frontend Tasks
- [ ] Leads list page with table, search, filters
- [ ] Lead create/edit modal
- [ ] Lead profile page with tabs (overview, notes, activity, emails)
- [ ] CSV import wizard (upload → preview → map columns → confirm)
- [ ] Pipeline view (stage columns or status badges)
- [ ] Tag management (create, assign, filter by)
- [ ] Lead notes (create, view, delete)
- [ ] Bulk actions toolbar
- [ ] Lead scoring display and breakdown
- [ ] React Query hooks for all lead operations

### Risks
- Large CSV imports (>10K rows) may need chunked processing
- Column mapping UX complexity

### Acceptance Criteria
- [ ] Create, edit, view, delete leads
- [ ] Import leads from CSV with column mapping
- [ ] Filter leads by status, score, tags, search query
- [ ] View lead profile with notes
- [ ] Apply tags to leads
- [ ] Bulk update status and tags
- [ ] Pipeline stages display correctly

---

## Phase 3: Outreach

**Duration**: ~1.5 weeks
**Goal**: Email sending, sequences, tracking, AI generation, sender accounts.

### Backend Tasks
- [ ] Deploy schema: sender_accounts, sender_account_secrets, email_sequences, sequence_steps, sequence_enrollments, email_messages, email_links, email_events, scheduled_emails
- [ ] Edge Functions: `connect-gmail`, `connect-sendgrid`, `connect-smtp`
- [ ] Edge Function: `send-email` (multi-provider with tracking instrumentation)
- [ ] Edge Function: `email-track` (open pixel + click redirect)
- [ ] Edge Function: `process-scheduled-emails` (cron job)
- [ ] Edge Functions: `ai-generate-email`, `ai-generate-sequence`, `ai-research-lead`
- [ ] Edge Function: `webhook-sendgrid` (delivery/bounce events)
- [ ] Personalization tag resolution logic
- [ ] Bot detection logic
- [ ] Rate limiting per sender account

### Frontend Tasks
- [ ] Sender accounts page (list, add, remove, set default)
- [ ] Gmail OAuth flow
- [ ] SendGrid API key setup
- [ ] SMTP credentials form
- [ ] Campaign/sequence creation wizard
- [ ] Sequence step editor (subject, body, delay)
- [ ] AI email generation UI (generate → review → edit → approve)
- [ ] Lead enrollment in sequences
- [ ] Campaign list page with stats
- [ ] Campaign detail page with recipient tracking
- [ ] Email engagement on lead profile (opens, clicks, timeline)
- [ ] Personalization tag picker
- [ ] Email composer with rich text editing

### Risks
- Gmail OAuth approval process can be slow
- Email deliverability depends on proper SPF/DKIM/DMARC setup by user
- AI generation latency (Gemini API response time)

### Acceptance Criteria
- [ ] Connect at least one sender account
- [ ] Create a multi-step email sequence
- [ ] AI generates personalized emails per lead
- [ ] Emails are sent on schedule via selected provider
- [ ] Open and click tracking works
- [ ] Campaign stats update in real-time
- [ ] Rate limits are enforced per sender

---

## Phase 4: Automation

**Duration**: ~1 week
**Goal**: Basic workflow automation with triggers, conditions, and actions.

### Backend Tasks
- [ ] Deploy schema: workflows, workflow_executions
- [ ] Edge Function: `execute-workflow`
- [ ] Workflow event listener (database trigger or polling)
- [ ] Action implementations: send_email, update_status, add_tag, assign_member, create_notification, fire_webhook

### Frontend Tasks
- [ ] Workflow list page
- [ ] Workflow builder (visual node editor or form-based)
- [ ] Trigger configuration
- [ ] Action configuration (per action type)
- [ ] Condition builder (field comparisons)
- [ ] Workflow execution logs
- [ ] Workflow stats display
- [ ] Workflow enable/disable toggle

### Risks
- Workflow execution loops (workflow triggers itself)
- Complex conditional logic UX

### Acceptance Criteria
- [ ] Create a workflow with trigger + action
- [ ] Workflow fires when trigger condition is met
- [ ] Actions execute correctly (email sent, status updated, etc.)
- [ ] Execution logs are recorded
- [ ] Workflows can be paused and resumed

---

## Phase 5: Analytics, Billing & Admin

**Duration**: ~1.5 weeks
**Goal**: Dashboard analytics, Stripe billing, team management, and admin panel.

### Backend Tasks
- [ ] Materialized view for email analytics
- [ ] Analytics query functions
- [ ] Edge Functions: `billing-checkout`, `billing-webhook`, `billing-portal`
- [ ] Stripe plan configuration
- [ ] Team invite/accept flow
- [ ] Usage counter enforcement
- [ ] Audit log writing from all Edge Functions

### Frontend Tasks
- [ ] Dashboard page: KPI cards, funnel chart, email stats, activity feed
- [ ] Analytics page: report types, date ranges, export
- [ ] Billing page: current plan, upgrade/downgrade, invoice history
- [ ] Stripe checkout integration
- [ ] Team settings: invite members, manage roles, remove members
- [ ] Admin dashboard: user count, system health, revenue
- [ ] Admin user management: list, disable, change plan
- [ ] Admin audit logs: searchable log viewer
- [ ] Notification center (bell icon + dropdown)
- [ ] Activity feed component

### Risks
- Stripe webhook reliability (implement idempotent handlers)
- Analytics query performance at scale (use materialized views)
- Team seat limit enforcement across invite + accept flow

### Acceptance Criteria
- [ ] Dashboard shows accurate KPIs and charts
- [ ] Stripe checkout works end-to-end
- [ ] Plan limits are enforced (leads, emails, credits, seats)
- [ ] Team invites sent and accepted
- [ ] Role changes take effect immediately
- [ ] Admin can view all users and audit logs
- [ ] Activity feed shows recent workspace events

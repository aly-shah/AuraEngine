# Scaliyo — System Architecture

**Version**: 1.0
**Last Updated**: 2026-03-16

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│          React 19 + TypeScript + Vite + Tailwind         │
│          React Query (server state) + Zustand (UI)       │
│          React Router 7 + Recharts                       │
├─────────────────────────────────────────────────────────┤
│                      SUPABASE                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │   Auth   │ │ Database │ │  Edge    │ │ Realtime │   │
│  │  (JWT)   │ │ (PG+RLS) │ │Functions │ │  (WS)    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐                                            │
│  │ Storage  │                                            │
│  │  (S3)    │                                            │
│  └──────────┘                                            │
├─────────────────────────────────────────────────────────┤
│                  EXTERNAL SERVICES                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Gemini  │ │  Stripe  │ │ SendGrid │ │  Gmail   │   │
│  │   (AI)   │ │(Billing) │ │ (Email)  │ │ (OAuth)  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Architecture

### Routing Structure

```
/                           → Marketing (public)
/auth                       → Auth pages (login, signup, forgot-password)
/auth/confirm               → Email verification
/auth/reset-password        → Password reset
/onboarding                 → Post-signup wizard
/app                        → App shell (authenticated)
  /app/dashboard            → Main dashboard
  /app/leads                → Lead management
  /app/leads/:id            → Lead profile
  /app/leads/import         → CSV import
  /app/campaigns            → Email campaigns/sequences
  /app/campaigns/new        → Create campaign
  /app/campaigns/:id        → Campaign detail
  /app/automation           → Workflows
  /app/analytics            → Reports
  /app/settings             → User settings
  /app/settings/senders     → Sender accounts
  /app/settings/team        → Team management
  /app/settings/billing     → Billing/subscription
  /app/settings/profile     → Profile
/admin                      → Admin panel (super admin only)
  /admin/users              → User management
  /admin/health             → System health
  /admin/audit              → Audit logs
```

### State Management Strategy

| Layer | Tool | Purpose |
|-------|------|---------|
| **Server state** | React Query (TanStack Query) | All Supabase data fetching, caching, invalidation |
| **UI state** | Zustand | Sidebar open/close, modals, UI preferences, command palette |
| **URL state** | React Router | Page navigation, filters, search params |
| **Form state** | Local component state | Form inputs, validation |
| **Auth state** | Custom hook + Zustand | Session, user profile, workspace context |

### Component Organization

```
src/
├── components/
│   ├── ui/               # Primitive UI components (Button, Input, Modal, etc.)
│   ├── layout/           # AppShell, Sidebar, TopBar, MobileNav
│   ├── auth/             # AuthGuard, RoleGuard
│   ├── leads/            # Lead-specific components
│   ├── campaigns/        # Campaign/sequence components
│   ├── dashboard/        # Dashboard widgets
│   ├── automation/       # Workflow builder components
│   └── settings/         # Settings page components
├── pages/
│   ├── marketing/        # Public pages
│   ├── auth/             # Auth pages
│   ├── app/              # Authenticated app pages
│   └── admin/            # Admin pages
├── hooks/                # Custom React hooks
├── lib/                  # Business logic, API clients, utilities
├── stores/               # Zustand stores
├── types/                # TypeScript types and enums
└── config/               # Static configuration
```

---

## 3. Backend Architecture

### Supabase Edge Functions

All server-side logic runs as Supabase Edge Functions (Deno runtime). Functions are organized by domain:

| Domain | Functions | Auth |
|--------|----------|------|
| **AI** | `ai-generate-email`, `ai-research-lead`, `ai-generate-sequence` | JWT |
| **Email** | `send-email`, `process-scheduled-emails`, `email-track` | JWT / Service / Public |
| **Email Providers** | `connect-gmail`, `connect-sendgrid`, `connect-smtp` | JWT |
| **Email Webhooks** | `webhook-sendgrid`, `webhook-mailchimp` | HMAC |
| **Billing** | `billing-checkout`, `billing-webhook`, `billing-portal` | JWT / Stripe HMAC |
| **Auth** | `auth-send-email` | Supabase Auth hook |
| **Workflows** | `execute-workflow` | Service role |

### Function Design Principles

1. **Single responsibility**: Each function handles one operation
2. **Auth first**: Verify JWT/HMAC before any business logic
3. **Rate limiting**: Per-user/per-workspace limits on expensive operations
4. **Error handling**: Structured error responses with error codes
5. **Logging**: All operations logged to audit_logs for sensitive actions
6. **Idempotency**: Webhook handlers must be idempotent (use event IDs)

---

## 4. Database Architecture

### Multi-Tenancy Model

Every data table includes a `workspace_id` column. All RLS policies filter by workspace membership:

```sql
-- Pattern for all workspace-scoped tables
CREATE POLICY "workspace_isolation" ON table_name
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()
  ));
```

### Key Entity Relationships

```
workspaces
  ├── workspace_members → profiles (users)
  ├── leads
  │   ├── lead_notes
  │   ├── lead_tags (junction: lead_tag_assignments)
  │   ├── email_messages → email_links, email_events
  │   └── scheduled_emails
  ├── email_sequences
  │   └── sequence_steps
  ├── sender_accounts → sender_account_secrets
  ├── workflows
  │   ├── workflow_nodes
  │   └── workflow_executions
  ├── subscriptions
  └── audit_logs
```

### Indexing Strategy

- Composite indexes on `(workspace_id, ...)` for all workspace-scoped queries
- Partial indexes for active/pending records (e.g., `WHERE status = 'pending'`)
- Expression indexes for case-insensitive email lookups
- Materialized views for analytics aggregations (refresh periodically)

---

## 5. Auth & Permissions Architecture

### Auth Flow

```
Signup → Supabase Auth creates user in auth.users
  → Database trigger creates profile in profiles
  → Database trigger creates default workspace
  → Database trigger creates workspace_member (owner role)
  → Frontend redirects to onboarding
  → Onboarding completes → business profile saved
  → Plan selection → Stripe checkout
  → Webhook confirms → subscription active
  → User lands on dashboard
```

### Permission Model

```
Super Admin (platform level)
  └── Can access admin panel, manage all users, system config

Workspace Owner (workspace level)
  └── Full control: billing, team, settings, all data

Workspace Admin (workspace level)
  └── Team management, integrations, campaigns, leads

Workspace Member (workspace level)
  └── Own leads, content creation, basic reporting
```

### Permission Checks

1. **RLS policies**: Database-level enforcement (always active)
2. **Edge Function checks**: Role verification before sensitive operations
3. **Frontend guards**: UI-level route protection (cosmetic, not security)

---

## 6. Email Sending Architecture

```
User creates campaign
  → Emails scheduled in scheduled_emails table
  → Cron function (process-scheduled-emails) runs every minute
  → For each due email:
    1. Select sender account (round-robin)
    2. Check rate limits (daily per inbox, monthly per workspace)
    3. Resolve personalization tags
    4. Inject tracking pixel + rewrite links
    5. Send via provider (SendGrid API / Gmail OAuth / SMTP)
    6. Record in email_messages
    7. Update usage counters
  → Provider webhooks report delivery/bounce events
  → email-track function handles open/click events
```

### Tracking Architecture

| Event | Mechanism | Storage |
|-------|-----------|---------|
| **Opens** | 1x1 transparent PNG served by `email-track` function | email_events (type: 'open') |
| **Clicks** | URL rewriting to `email-track` redirect endpoint | email_events (type: 'click') + email_links |
| **Bounces** | Provider webhook (SendGrid/Mailchimp) | email_events (type: 'bounce') |
| **Deliveries** | Provider webhook | email_events (type: 'delivered') |
| **Unsubscribes** | Provider webhook | email_events (type: 'unsubscribe') |

### Bot Detection

- User-Agent pattern matching against 20+ known bot patterns
- Apple Privacy Protection detection (iOS 15+ proxy)
- 60-second deduplication window per message+IP+UA combination
- Events flagged with `is_bot` and `is_apple_privacy` columns

---

## 7. AI Service Architecture

### Principle: AI is Server-Side Only

```
Frontend → Edge Function (JWT auth) → Rate limit check → Credit check
  → Gemini API call → Response validation → Credit deduction
  → Return to frontend
```

### AI Operations

| Operation | Edge Function | Model | Input | Output |
|-----------|--------------|-------|-------|--------|
| Generate email | `ai-generate-email` | gemini-2.0-flash | Lead + business context + tone | Subject + HTML body |
| Generate sequence | `ai-generate-sequence` | gemini-2.0-flash | Lead + goal + cadence | Array of email steps |
| Research lead | `ai-research-lead` | gemini-2.0-flash | Lead data + knowledge base | Research brief + talking points |
| Dashboard insight | `ai-dashboard-insight` | gemini-2.0-flash | Pipeline stats | Insight cards |

### Context Building

Every AI call includes a structured system prompt built from:
1. **Business profile** — Company, value prop, products, target audience
2. **Lead context** — Name, company, title, industry, score, engagement history
3. **Tone settings** — Formality, creativity, verbosity (1-10 scales)
4. **Guardrails** — No competitors mentioned, no false claims, professional tone

---

## 8. Workflow Engine Architecture

### Node Types

| Type | Description | MVP? |
|------|-------------|------|
| **Trigger** | Event that starts the workflow | Yes |
| **Action** | Operation to perform | Yes |
| **Condition** | Branch based on data | Yes |
| **Wait** | Delay before next step | Yes |

### Trigger Types (MVP)

| Trigger | Event |
|---------|-------|
| `lead_created` | New lead added to workspace |
| `score_changed` | Lead score crosses threshold |
| `status_changed` | Lead pipeline status updated |
| `tag_added` | Tag assigned to lead |
| `email_event` | Open/click/reply detected |

### Action Types (MVP)

| Action | Effect |
|--------|--------|
| `send_email` | Send email using template + AI personalization |
| `update_status` | Change lead pipeline status |
| `add_tag` | Assign tag to lead |
| `assign_member` | Route lead to team member |
| `create_notification` | Alert user in-app |
| `fire_webhook` | POST to external URL |

### Execution Model

```
Event occurs (e.g., lead score changes)
  → Check workflows with matching trigger
  → For each matching workflow:
    1. Create workflow_execution record
    2. Evaluate trigger conditions
    3. Walk through nodes:
       - Condition node: evaluate → branch
       - Action node: execute → log result
       - Wait node: schedule resume
    4. Update execution status (success/failed)
    5. Update workflow stats
```

---

## 9. Event Tracking & Audit Design

### Audit Events (Written to audit_logs)

| Category | Events |
|----------|--------|
| **Auth** | login, logout, password_change, email_verified |
| **Leads** | lead_created, lead_updated, lead_deleted, lead_imported |
| **Email** | email_sent, campaign_created, campaign_paused |
| **Team** | member_invited, member_removed, role_changed |
| **Billing** | plan_changed, payment_succeeded, payment_failed |
| **Admin** | user_disabled, config_changed, support_session_started |
| **Automation** | workflow_created, workflow_executed, workflow_failed |

### Activity Feed Events (Written to activity_feed)

Visible to workspace members:
- Lead status changes
- Emails sent/received
- Campaign started/completed
- Team member actions
- Workflow execution results

---

## 10. Deployment Architecture

### Production Stack

```
GitHub (source) → GitHub Actions (CI/CD)
  → Build: Vite production build
  → Deploy: Zero-downtime symlink swap on VPS
  → Serve: Nginx with HTTP/2 + SSL (Let's Encrypt)

Supabase (managed):
  → PostgreSQL database
  → Edge Functions (Deno)
  → Auth service
  → Realtime WebSocket
  → Storage (S3-compatible)
```

### Environment Variables

#### Frontend (.env)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
VITE_APP_URL=
```

#### Backend (Supabase Secrets)
```
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SENDGRID_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Critical**: Frontend only has VITE_-prefixed public keys. All secrets are server-side only.

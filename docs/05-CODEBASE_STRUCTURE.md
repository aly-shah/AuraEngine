# Scaliyo — Codebase Structure

**Version**: 1.0

---

## Directory Layout

```
AuraEngine/
├── public/
│   ├── favicon.ico
│   └── robots.txt
├── src/
│   ├── main.tsx                     # App entry point
│   ├── App.tsx                      # Router + providers
│   ├── index.css                    # Tailwind + global styles
│   │
│   ├── config/
│   │   ├── routes.ts                # Route path constants
│   │   ├── plans.ts                 # Plan tier definitions
│   │   ├── nav.ts                   # Sidebar navigation config
│   │   └── constants.ts             # App-wide constants
│   │
│   ├── types/
│   │   ├── index.ts                 # Re-exports
│   │   ├── auth.ts                  # Auth types, roles
│   │   ├── workspace.ts             # Workspace, member types
│   │   ├── lead.ts                  # Lead, tag, note types
│   │   ├── email.ts                 # Email, sequence, tracking types
│   │   ├── automation.ts            # Workflow types
│   │   ├── billing.ts               # Subscription, plan types
│   │   └── common.ts                # Shared utility types
│   │
│   ├── lib/
│   │   ├── supabase.ts              # Supabase client singleton
│   │   ├── query-client.ts          # React Query client config
│   │   ├── api.ts                   # Base API helper (fetch wrapper for Edge Functions)
│   │   ├── utils.ts                 # General utilities (cn, formatDate, etc.)
│   │   ├── leads.ts                 # Lead CRUD operations
│   │   ├── lead-import.ts           # CSV import logic
│   │   ├── email.ts                 # Email sending + tracking queries
│   │   ├── sequences.ts             # Sequence CRUD
│   │   ├── senders.ts               # Sender account operations
│   │   ├── workflows.ts             # Workflow CRUD
│   │   ├── analytics.ts             # Analytics queries
│   │   ├── billing.ts               # Stripe/billing operations
│   │   ├── team.ts                  # Team/invite operations
│   │   ├── notifications.ts         # Notification operations
│   │   ├── audit.ts                 # Audit log queries
│   │   └── personalization.ts       # Email tag resolution
│   │
│   ├── hooks/
│   │   ├── use-auth.ts              # Auth state + actions
│   │   ├── use-workspace.ts         # Current workspace context
│   │   ├── use-leads.ts             # Lead query hooks
│   │   ├── use-sequences.ts         # Sequence query hooks
│   │   ├── use-senders.ts           # Sender account hooks
│   │   ├── use-workflows.ts         # Workflow hooks
│   │   ├── use-analytics.ts         # Analytics data hooks
│   │   ├── use-billing.ts           # Billing/subscription hooks
│   │   ├── use-team.ts              # Team member hooks
│   │   ├── use-notifications.ts     # Notification hooks
│   │   ├── use-toast.ts             # Toast notification hook
│   │   └── use-realtime.ts          # Supabase realtime subscription
│   │
│   ├── stores/
│   │   ├── ui-store.ts              # Sidebar, modals, theme
│   │   └── command-palette-store.ts # Command palette state
│   │
│   ├── components/
│   │   ├── ui/                      # Primitive UI library
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Textarea.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Avatar.tsx
│   │   │   ├── Spinner.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── Tabs.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Pagination.tsx
│   │   │   └── Toast.tsx
│   │   │
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx         # Authenticated app shell
│   │   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   │   ├── TopBar.tsx            # Top bar with search + user menu
│   │   │   ├── MobileNav.tsx         # Mobile bottom navigation
│   │   │   └── MarketingLayout.tsx   # Public page layout
│   │   │
│   │   ├── auth/
│   │   │   ├── AuthGuard.tsx         # Redirect if not authenticated
│   │   │   ├── RoleGuard.tsx         # Check workspace role
│   │   │   └── OnboardingGuard.tsx   # Redirect if onboarding incomplete
│   │   │
│   │   ├── dashboard/               # Dashboard widgets
│   │   │   ├── StatsCards.tsx
│   │   │   ├── PipelineFunnel.tsx
│   │   │   ├── EmailPerformance.tsx
│   │   │   ├── ActivityFeed.tsx
│   │   │   └── RecentLeads.tsx
│   │   │
│   │   ├── leads/                   # Lead-specific components
│   │   │   ├── LeadTable.tsx
│   │   │   ├── LeadForm.tsx
│   │   │   ├── LeadCard.tsx
│   │   │   ├── LeadFilters.tsx
│   │   │   ├── ImportWizard.tsx
│   │   │   ├── TagManager.tsx
│   │   │   ├── NoteEditor.tsx
│   │   │   ├── ScoreBadge.tsx
│   │   │   └── StatusBadge.tsx
│   │   │
│   │   ├── campaigns/               # Email campaign components
│   │   │   ├── SequenceList.tsx
│   │   │   ├── SequenceWizard.tsx
│   │   │   ├── StepEditor.tsx
│   │   │   ├── EmailComposer.tsx
│   │   │   ├── PersonalizationPicker.tsx
│   │   │   └── CampaignStats.tsx
│   │   │
│   │   ├── automation/              # Workflow components
│   │   │   ├── WorkflowList.tsx
│   │   │   ├── WorkflowBuilder.tsx
│   │   │   ├── TriggerConfig.tsx
│   │   │   ├── ActionConfig.tsx
│   │   │   └── ExecutionLog.tsx
│   │   │
│   │   └── settings/                # Settings components
│   │       ├── ProfileForm.tsx
│   │       ├── SenderList.tsx
│   │       ├── SenderForm.tsx
│   │       ├── TeamMembers.tsx
│   │       ├── InviteForm.tsx
│   │       ├── BillingOverview.tsx
│   │       └── PlanSelector.tsx
│   │
│   └── pages/
│       ├── marketing/
│       │   ├── LandingPage.tsx
│       │   └── PricingPage.tsx
│       │
│       ├── auth/
│       │   ├── LoginPage.tsx
│       │   ├── SignupPage.tsx
│       │   ├── ConfirmEmailPage.tsx
│       │   ├── ForgotPasswordPage.tsx
│       │   └── ResetPasswordPage.tsx
│       │
│       ├── app/
│       │   ├── OnboardingPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── LeadsPage.tsx
│       │   ├── LeadProfilePage.tsx
│       │   ├── LeadImportPage.tsx
│       │   ├── CampaignsPage.tsx
│       │   ├── CampaignNewPage.tsx
│       │   ├── CampaignDetailPage.tsx
│       │   ├── AutomationPage.tsx
│       │   ├── AnalyticsPage.tsx
│       │   ├── SettingsPage.tsx
│       │   ├── SendersPage.tsx
│       │   ├── TeamPage.tsx
│       │   └── BillingPage.tsx
│       │
│       └── admin/
│           ├── AdminDashboardPage.tsx
│           ├── AdminUsersPage.tsx
│           └── AdminAuditPage.tsx
│
├── supabase/
│   ├── config.toml
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts
│       │   ├── auth.ts              # JWT verification helpers
│       │   ├── errors.ts            # Standardized error responses
│       │   └── supabase.ts          # Service-role client factory
│       ├── ai-generate-email/
│       │   └── index.ts
│       ├── ai-generate-sequence/
│       │   └── index.ts
│       ├── ai-research-lead/
│       │   └── index.ts
│       ├── send-email/
│       │   └── index.ts
│       ├── email-track/
│       │   └── index.ts
│       ├── process-scheduled-emails/
│       │   └── index.ts
│       ├── connect-gmail/
│       │   └── index.ts
│       ├── connect-sendgrid/
│       │   └── index.ts
│       ├── connect-smtp/
│       │   └── index.ts
│       ├── webhook-sendgrid/
│       │   └── index.ts
│       ├── billing-checkout/
│       │   └── index.ts
│       ├── billing-webhook/
│       │   └── index.ts
│       ├── billing-portal/
│       │   └── index.ts
│       ├── execute-workflow/
│       │   └── index.ts
│       └── auth-send-email/
│           └── index.ts
│
├── .env.example
├── .env.local                       # Local dev (gitignored)
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── eslint.config.js
```

## Environment Variables

### Frontend (.env)
```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Stripe
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...

# App
VITE_APP_URL=https://scaliyo.com
```

### Backend (Supabase Secrets — NOT in frontend)
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...

# AI
GEMINI_API_KEY=AIza...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email Providers
SENDGRID_API_KEY=SG.xxx
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# App
SITE_URL=https://scaliyo.com
```

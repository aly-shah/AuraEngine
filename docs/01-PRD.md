# Scaliyo — Product Requirements Document (PRD)

**Version**: 1.0
**Last Updated**: 2026-03-16
**Status**: Active

---

## 1. Product Summary

Scaliyo is an AI-powered B2B Growth Intelligence Platform that unifies lead generation, multi-channel outreach automation, pipeline management, and analytics into a single workspace. It replaces the need for separate lead gen, outreach, and lightweight CRM tools — providing an AI-first experience where intelligent automation handles the repetitive work so sales teams can focus on closing.

**One-liner**: The AI-first sales engagement platform that finds, engages, and converts B2B prospects from one workspace.

---

## 2. Target Users

| Segment | Description | Team Size |
|---------|-------------|-----------|
| **B2B SDRs/BDRs** | Sales development reps doing outbound prospecting | 1-20 |
| **Founders** | Technical or non-technical founders doing their own sales | 1-5 |
| **Agencies** | Lead gen and outreach agencies managing multiple clients | 2-30 |
| **RevOps** | Revenue operations teams optimizing outbound pipeline | 3-50 |
| **Small Sales Teams** | Lean B2B teams needing an all-in-one outbound stack | 2-20 |

**Primary persona**: A B2B SDR who needs to find prospects, write personalized outreach, track engagement, and follow up — without juggling 5 different tools.

---

## 3. Core Problems Solved

| # | Problem | How Scaliyo Solves It |
|---|---------|----------------------|
| 1 | Sales teams use 3-5 disconnected tools for outbound | One platform: lead gen + outreach + CRM + analytics |
| 2 | Writing personalized emails at scale is time-consuming | AI generates contextually personalized emails per prospect |
| 3 | Follow-ups are inconsistent and manual | Automated email sequences with configurable cadence |
| 4 | Reps don't know which leads to prioritize | AI-powered lead scoring across 6 engagement factors |
| 5 | No visibility into prospect engagement | Real-time email tracking (opens, clicks, bounces) |
| 6 | CRM data entry is tedious and incomplete | Automated status updates, activity logging, and CRM sync |
| 7 | Managers lack pipeline visibility | Dashboards, funnel analytics, and scheduled reports |

---

## 4. Core Modules

### MVP Modules (Build Now)

| Module | Description | Priority |
|--------|-------------|----------|
| **Auth & Onboarding** | Email/password signup, verification, onboarding wizard | P0 |
| **Workspace & Teams** | Multi-tenant workspace with team members and roles | P0 |
| **Lead Database** | Contact/prospect CRUD with custom fields | P0 |
| **Lead Import** | CSV upload with column mapping and deduplication | P0 |
| **Pipeline Management** | Stage-based pipeline (New → Contacted → Qualified → Converted → Lost) | P0 |
| **Lead Scoring** | Weighted scoring across engagement factors | P0 |
| **AI Lead Research** | AI-generated prospect briefs with talking points | P0 |
| **AI Email Generation** | Per-lead personalized email creation via Gemini | P0 |
| **Email Sequences** | Multi-step drip campaigns with delays | P0 |
| **Email Tracking** | Open/click/bounce tracking with bot detection | P0 |
| **Sender Accounts** | Multi-provider email setup (Gmail, SendGrid, SMTP) | P0 |
| **Workflow Automation** | Trigger → condition → action workflows | P1 |
| **Dashboard Analytics** | KPI cards, funnel visualization, email stats | P0 |
| **Activity Feed** | Real-time action log | P1 |
| **Role-Based Access** | Owner/Admin/Member permissions | P0 |
| **Billing (Stripe)** | Subscription plans, checkout, invoices | P0 |
| **Admin Dashboard** | User management, system health, audit logs | P1 |

### V2 Modules (Build Later)

| Module | Description |
|--------|-------------|
| **Apollo Integration** | Search and import from Apollo's contact database |
| **Social Publishing** | Schedule posts to LinkedIn, Facebook, Instagram |
| **Advanced Reporting** | Custom reports, scheduled delivery, multi-format export |
| **AI Command Center** | Multi-persona AI chat assistant |
| **DNA / Prompt Registry** | Version-controlled prompt template management |
| **Support Console** | Admin support sessions with audit trail |
| **White-Labeling** | Custom branding for agency deployments |
| **Automation Templates** | Pre-built workflow templates by use case |

### Roadmap Only (Placeholder)

| Module | Notes |
|--------|-------|
| **AI Voice Calling** | Requires telephony provider integration |
| **Power Dialer** | Requires calling infrastructure |
| **SMS Outreach** | Requires Twilio or similar |
| **WhatsApp** | Requires WhatsApp Business API |
| **IVR / Voice Routing** | Requires telephony stack |
| **Calendar Sync** | Google Calendar / Outlook API |
| **Native Mobile App** | React Native or Flutter |
| **Bidirectional CRM Sync** | Pull from HubSpot/Salesforce |

---

## 5. User Roles

| Role | Scope | Permissions |
|------|-------|-------------|
| **Super Admin** | Platform-wide | All admin features, system config, support console |
| **Workspace Owner** | Workspace | Full workspace control, billing, team management |
| **Workspace Admin** | Workspace | Team management, integrations, campaigns |
| **Workspace Member** | Workspace | Leads, content, basic reporting, personal dashboard |

---

## 6. Key User Journeys

### Journey 1: First-Time Setup
```
Signup → Email verification → Onboarding wizard (role, company, goals)
→ Plan selection → Stripe checkout → Dashboard
```

### Journey 2: Lead Import → First Campaign
```
Import CSV → Map columns → Review/dedup → Leads appear in database
→ Select leads → AI generates email sequence → Review/edit
→ Choose sender account → Schedule → Emails sent → Track engagement
```

### Journey 3: Daily Sales Rep Flow
```
Login → Dashboard (daily briefing, hot leads, pending tasks)
→ Review engaged leads (who opened/clicked) → Follow up
→ Check pipeline → Update lead statuses → Add notes
```

### Journey 4: Automation Trigger
```
Lead score crosses 75 → Workflow triggers →
  Auto-assign to closer + Send Slack notification + Update status
```

### Journey 5: Manager Reporting
```
Open Analytics → Select report type → View KPIs
→ Set up alert (notify when hot lead detected)
→ Schedule weekly report to email
```

---

## 7. MVP Scope Boundaries

### In Scope (MVP)
- Email-based auth with verification
- Single workspace per user (multi-workspace is V2)
- Lead CRUD with CSV import
- 5-stage pipeline
- AI email generation (server-side via Edge Functions)
- Multi-step email sequences with scheduling
- Email tracking (opens, clicks, bounces)
- Gmail OAuth, SendGrid, SMTP sender accounts
- Basic workflow automation (3-5 trigger types, 5-7 action types)
- Dashboard with KPI cards, funnel chart, email stats
- Stripe subscriptions with 3-4 plan tiers
- Role-based access (Owner, Admin, Member)
- Audit logging

### Out of Scope (MVP)
- Apollo integration (V2)
- Social media publishing (V2)
- AI chat assistant (V2)
- Voice/calling features (Roadmap)
- SMS/WhatsApp (Roadmap)
- Calendar integration (Roadmap)
- White-label (V2)
- Mobile app (Roadmap)
- Bidirectional CRM sync (Roadmap)

---

## 8. Technical Constraints

| Constraint | Detail |
|-----------|--------|
| **AI API keys** | Must NEVER be exposed in frontend; all AI calls via Edge Functions |
| **Multi-tenancy** | All data must be workspace-scoped; RLS on every table |
| **Email deliverability** | Rate limiting per inbox; warmup tracking; bot detection |
| **Supabase limits** | Edge Function cold starts; Realtime channel limits |
| **Stripe webhook reliability** | Idempotent webhook handlers; retry handling |
| **Browser compatibility** | Modern browsers (Chrome, Firefox, Safari, Edge — last 2 versions) |

---

## 9. Security Considerations

| Area | Requirement |
|------|------------|
| **Authentication** | Supabase Auth with JWT; email verification required |
| **Authorization** | RLS on all tables; role checks in Edge Functions |
| **Data isolation** | Workspace-scoped queries; no cross-tenant data leakage |
| **Secrets management** | AI keys, SMTP passwords in Supabase secrets; never in frontend |
| **Audit trail** | All destructive/sensitive actions logged to audit_logs |
| **Webhook security** | HMAC-SHA256 verification on all inbound webhooks |
| **Credential storage** | Email provider credentials in separate table; service_role access only |
| **CORS** | Whitelist production domain only |
| **Rate limiting** | Per-user limits on AI operations, email sending, API calls |

---

## 10. Monetization Model

### Plan Tiers

| Plan | Price (Monthly) | Annual Discount | Key Limits |
|------|----------------|-----------------|-----------|
| **Free** | $0 | — | 50 leads, 50 emails/mo, 100 AI credits, 1 seat |
| **Starter** | $29 | 15% | 1,000 leads, 1,000 emails/mo, 2,000 AI credits, 2 seats |
| **Growth** | $79 | 15% | 10,000 leads, 15,000 emails/mo, 10,000 AI credits, 5 seats |
| **Scale** | $199 | 15% | 50,000 leads, 40,000 emails/mo, 40,000 AI credits, 15 seats |

### Revenue Streams
1. **Subscription revenue** — Monthly/annual SaaS plans
2. **Credit top-ups** — One-time AI credit purchases
3. **Extra seats** — Additional team member seats
4. **Enterprise custom** — Custom pricing for large deployments (future)

### AI Credit Costs
| Operation | Credits |
|-----------|---------|
| Email generation | 2 |
| Email sequence (per lead) | 3 |
| Lead research brief | 2 |
| Blog article | 5 |
| Dashboard insight | 1 |
| Content suggestion | 1 |

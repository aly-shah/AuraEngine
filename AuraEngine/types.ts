
// ── UI Mode ──
export type UIMode = 'simplified' | 'advanced';

export enum UserRole {
  ADMIN = 'ADMIN',
  CLIENT = 'CLIENT',
  GUEST = 'GUEST'
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_name: string;
  status: 'active' | 'past_due' | 'canceled';
  current_period_end: string;
  created_at?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'disabled';
  plan: string;
  credits_total: number;
  credits_used: number;
  created_at: string;
  subscription?: Subscription;
  businessProfile?: BusinessProfile;
  is_super_admin?: boolean;
  ui_preferences?: Record<string, unknown>;
}

export interface BusinessService {
  id: string;
  name: string;
  description?: string;
}

export interface BusinessPricingTier {
  id: string;
  name: string;
  price?: string;
  description?: string;
  features?: string[];
}

export interface BusinessProfile {
  companyName?: string;
  industry?: string;
  companyWebsite?: string;
  productsServices?: string;
  targetAudience?: string;
  valueProp?: string;
  pricingModel?: string;
  salesApproach?: string;
  businessDescription?: string;
  phone?: string;
  businessEmail?: string;
  address?: string;
  socialLinks?: {
    linkedin?: string;
    twitter?: string;
    instagram?: string;
    facebook?: string;
  };

  // Structured data
  services?: BusinessService[];
  pricingTiers?: BusinessPricingTier[];

  // Deep analysis fields
  companyStory?: string;
  foundedYear?: string;
  teamSize?: string;
  teamHighlights?: string;
  testimonialsThemes?: string;
  uniqueSellingPoints?: string[];
  competitiveAdvantage?: string;
  contentTone?: string;
  keyClients?: string;

  // Logo
  logoUrl?: string;
  logoAssetId?: string;
}

export interface BusinessAnalysisField {
  value: string;
  confidence: number; // 0-100
}

export interface BusinessAnalysisResult {
  companyName: BusinessAnalysisField;
  industry: BusinessAnalysisField;
  productsServices: BusinessAnalysisField;
  targetAudience: BusinessAnalysisField;
  valueProp: BusinessAnalysisField;
  pricingModel: BusinessAnalysisField;
  salesApproach: BusinessAnalysisField;
  phone?: BusinessAnalysisField;
  businessEmail?: BusinessAnalysisField;
  address?: BusinessAnalysisField;
  socialLinks?: {
    linkedin?: string;
    twitter?: string;
    instagram?: string;
    facebook?: string;
  };
  followUpQuestions: string[];

  // Deep analysis fields
  services?: { value: BusinessService[]; confidence: number };
  pricingTiers?: { value: BusinessPricingTier[]; confidence: number };
  companyStory?: BusinessAnalysisField;
  foundedYear?: BusinessAnalysisField;
  teamSize?: BusinessAnalysisField;
  teamHighlights?: BusinessAnalysisField;
  testimonialsThemes?: BusinessAnalysisField;
  uniqueSellingPoints?: { value: string[]; confidence: number };
  competitiveAdvantage?: BusinessAnalysisField;
  contentTone?: BusinessAnalysisField;
  keyClients?: BusinessAnalysisField;
}

export interface KnowledgeBase {
  website?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  youtube?: string;
  extraNotes?: string;
  // Structured intelligence fields
  title?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
  companyOverview?: string;
  talkingPoints?: string[];
  outreachAngle?: string;
  riskFactors?: string[];
  aiResearchBrief?: string;
  aiResearchedAt?: string;
  mentionedOnWebsite?: string;
}

export interface Lead {
  id: string;
  client_id: string;
  // ─── Canonical fields (always use these) ───
  first_name: string;
  last_name: string;
  primary_email: string;
  primary_phone: string;
  company: string;
  score: number;
  status: 'New' | 'Contacted' | 'Qualified' | 'Converted' | 'Lost';
  last_activity: string;
  insights: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
  knowledgeBase?: KnowledgeBase;
  emails?: string[];
  phones?: string[];
  linkedin_url?: string;
  location?: string;
  title?: string;
  industry?: string;
  company_size?: string;
  import_batch_id?: string;
  imported_at?: string;
  custom_fields?: Record<string, string>;
  // ─── Legacy (deprecated — read-only, removed next release) ───
  /** @deprecated Use primary_email */ email?: string;
  /** @deprecated Use first_name + last_name */ name?: string;
  /** @deprecated Use last_activity */ lastActivity?: string;
  /** @deprecated Use primary_phone */ phone?: string;
}

export interface Plan {
  id: string;
  name: string;
  price: string;
  credits: number;
  contacts: number;
  seats: number;
  emails: number;
  storage: number;
  description: string;
  features: string[];
  // New DB-driven fields (added by 20260303200000_plans_admin_tooling)
  key?: string | null;
  price_monthly_cents?: number;
  currency?: string;
  stripe_price_id?: string | null;
  is_active?: boolean;
  limits?: Record<string, unknown>;
  sort_order?: number;
  updated_at?: string;
}

export enum ContentType {
  EMAIL = 'Cold Email',
  LINKEDIN = 'LinkedIn Message',
  SMS = 'SMS Text',
  PROPOSAL = 'Follow-up Proposal'
}

export interface DashboardQuickStats {
  leadsToday: number;
  hotLeads: number;
  contentCreated: number;
  avgAiScore: number;
  predictedConversions: number;
  recommendations: number;
  leadsYesterday?: number;
  hotLeadsYesterday?: number;
}

export interface AIInsight {
  id: string;
  category: 'score' | 'timing' | 'company' | 'conversion' | 'engagement';
  title: string;
  description: string;
  confidence: number;
  action?: string;
}

export interface ActivityFeedItem {
  id: string;
  action: string;
  user_email?: string;
  user_name?: string;
  details?: string;
  created_at: string;
}

export interface FunnelStage {
  label: string;
  count: number;
  color: string;
  percentage: number;
}

export interface LeadSegment {
  id: string;
  name: string;
  type: 'smart' | 'manual';
  count: number;
  icon: string;
  color: string;
  filter?: (lead: Lead) => boolean;
  leadIds?: string[];
}

export interface ManualList {
  id: string;
  name: string;
  leadIds: string[];
  createdAt: string;
}

// Content Generation Module v2
export enum ContentCategory {
  EMAIL_SEQUENCE = 'Email Sequences',
  LANDING_PAGE = 'Landing Pages',
  SOCIAL_MEDIA = 'Social Media Posts',
  BLOG_ARTICLE = 'Blog Articles',
  REPORT = 'Reports & Whitepapers',
  PROPOSAL = 'Proposals & Pitches',
  AD_COPY = 'Ad Copy'
}

export enum ToneType {
  PROFESSIONAL = 'Professional',
  CONVERSATIONAL = 'Conversational',
  TECHNICAL = 'Technical',
  CASUAL = 'Casual',
  PERSUASIVE = 'Persuasive',
  EMPATHETIC = 'Empathetic'
}

export interface PersonalizationTag {
  key: string;
  label: string;
  placeholder: string;
}

export interface EmailStep {
  id: string;
  stepNumber: number;
  subject: string;
  body: string;
  delay: string; // e.g. "Day 1", "Day 3"
  tone: ToneType;
}

export interface EmailSequenceConfig {
  audienceLeadIds: string[];
  segmentFilter?: string;
  goal: 'book_meeting' | 'product_demo' | 'nurture' | 're_engage' | 'upsell';
  sequenceLength: number;
  cadence: 'daily' | 'every_2_days' | 'every_3_days' | 'weekly';
  tone: ToneType;
}

export interface GeneratedContent {
  id: string;
  category: ContentCategory;
  title: string;
  content: string;
  tone: ToneType;
  leadId?: string;
  createdAt: string;
  emailSteps?: EmailStep[];
}

// Module 4: System Settings
export interface NotificationPreferences {
  emailAlerts: boolean;
  leadScoreAlerts: boolean;
  weeklyDigest: boolean;
  contentReady: boolean;
  teamMentions: boolean;
  systemUpdates: boolean;
}

export interface DashboardPreferences {
  defaultView: 'grid' | 'list';
  itemsPerPage: number;
  showQuickStats: boolean;
  showAiInsights: boolean;
  showActivityFeed: boolean;
  theme: 'light' | 'dark' | 'system';
  autoContactedOnSend: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed?: string;
  status: 'active' | 'revoked';
}

export type TeamRole = 'Administrator' | 'Manager' | 'User';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: 'active' | 'disabled';
  joinedAt: string;
  lastActive?: string;
}

export interface RolePermission {
  role: TeamRole;
  permissions: string[];
  description: string;
  color: string;
}

export interface IntegrationConfig {
  id: string;
  name: string;
  category: 'crm' | 'email' | 'analytics' | 'calendar' | 'communication' | 'payment';
  icon: string;
  status: 'connected' | 'disconnected' | 'error';
  apiKey?: string;
  webhookUrl?: string;
  lastSync?: string;
  config?: Record<string, string>;
}

export interface UsageMetrics {
  contactsUsed: number;
  contactsLimit: number;
  storageUsedMb: number;
  storageLimitMb: number;
  emailCreditsUsed: number;
  emailCreditsLimit: number;
}

// Module 3: Analytics & Reporting
export type ReportType = 'performance' | 'lead_source' | 'roi_cost' | 'ai_effectiveness' | 'email_campaign' | 'team_productivity';
export type ExportFormat = 'pdf' | 'excel' | 'csv' | 'pptx';
export type AlertType = 'hot_lead' | 'stagnation' | 'campaign_drop' | 'high_value' | 'ai_accuracy_drop' | 'system_health';
export type AlertNotifyMethod = 'in_app' | 'email' | 'slack' | 'sms';

export interface AnalyticsMetric {
  id: string;
  label: string;
  value: number;
  previousValue?: number;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  trendPercent?: number;
  color: string;
  icon: string;
}

export interface ReportConfig {
  id: string;
  name: string;
  type: ReportType;
  description: string;
  dateRange: { start: string; end: string };
  format: ExportFormat;
  generatedAt?: string;
  status: 'draft' | 'generating' | 'ready';
}

export interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  enabled: boolean;
  condition: string;
  threshold?: number;
  notifyMethods: AlertNotifyMethod[];
  lastTriggered?: string;
  triggerCount: number;
}

// Module 5: Workflow Automation
export type TriggerType = 'score_change' | 'status_change' | 'lead_created' | 'time_elapsed' | 'tag_added' | 'content_generated';
export type ActionType = 'send_email' | 'update_status' | 'add_tag' | 'assign_user' | 'generate_content' | 'create_alert' | 'move_to_segment' | 'notify_slack' | 'sync_crm';

export interface AutomationTrigger {
  type: TriggerType;
  label: string;
  config: Record<string, string | number>;
}

export interface AutomationAction {
  type: ActionType;
  label: string;
  config: Record<string, string | number>;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  runCount: number;
}

export interface CampaignStep {
  id: string;
  day: number;
  type: 'email' | 'wait' | 'condition' | 'action';
  title: string;
  description: string;
  config?: Record<string, string | number>;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  steps: CampaignStep[];
  enrolledLeads: number;
  completedLeads: number;
  createdAt: string;
  startedAt?: string;
}

// Module: Email Tracking
export type EmailProvider = 'sendgrid' | 'mailchimp' | 'gmail' | 'smtp' | 'manual';
export type EmailMessageStatus = 'sent' | 'delivered' | 'bounced' | 'failed';
export type EmailEventType = 'open' | 'click' | 'delivered' | 'bounced' | 'unsubscribe' | 'spam_report';

export interface EmailMessage {
  id: string;
  lead_id: string;
  owner_id: string;
  provider: EmailProvider;
  provider_message_id?: string;
  subject?: string;
  to_email: string;
  from_email?: string;
  status: EmailMessageStatus;
  track_opens: boolean;
  track_clicks: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailLink {
  id: string;
  message_id: string;
  destination_url: string;
  link_label?: string;
  link_index: number;
  click_count: number;
  created_at: string;
}

export interface EmailEvent {
  id: string;
  message_id: string;
  link_id?: string;
  event_type: EmailEventType;
  ip_address?: string;
  user_agent?: string;
  is_bot: boolean;
  is_apple_privacy: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Team Collaboration (Strategy Hub)
export interface Team {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  name?: string;
  invited_by: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  expires_at: string;
  team_name?: string; // joined
}

export interface EmailTemplate {
  id: string;
  owner_id: string | null;
  name: string;
  category: 'welcome' | 'follow_up' | 'case_study' | 'demo_invite' | 'nurture' | 'custom';
  subject_template: string;
  body_template: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailEngagement {
  totalSent: number;
  totalOpens: number;
  totalClicks: number;
  uniqueOpens: number;
  uniqueClicks: number;
  totalBounced: number;
  lastOpenedAt?: string;
  lastClickedAt?: string;
  topClickedLink?: { label: string; url: string; clicks: number };
  recentEvents: EmailEvent[];
}

// ── Image Generation Module ──

export type ImageModuleType = 'newsletter' | 'pricing' | 'products' | 'services';
export type ImageAspectRatio = '1:1' | '4:5' | '16:9';
export type LogoPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-watermark';
export type LogoSize = 'small' | 'medium' | 'large';
export type BackgroundStyle = 'solid' | 'gradient' | 'minimal-texture';
export type FontVibe = 'modern' | 'elegant' | 'bold' | 'minimal';

export interface ImageGenBrandColors {
  primary: string;
  secondary: string;
  accent: string;
  bgStyle: BackgroundStyle;
}

export interface ImageGenBrandSettings {
  colors: ImageGenBrandColors;
  logoAssetId?: string;
  logoPlacement?: LogoPlacement;
  logoSize?: LogoSize;
  logoOpacity?: number;
  brandName?: string;
  fontVibe?: FontVibe;
}

export interface ImageGenBrandAsset {
  id: string;
  user_id: string;
  type: 'logo';
  file_url: string;
  file_name?: string;
  created_at: string;
}

export interface ImageGenGeneratedImage {
  id: string;
  user_id: string;
  module_type: ImageModuleType;
  module_id?: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  provider: string;
  base_image_url: string;
  final_image_url?: string;
  brand_settings: ImageGenBrandSettings;
  created_at: string;
}

// ── Module-specific field types for image generation ──

export interface NewsletterModuleFields {
  headline: string;
  subheadline: string;
  ctaText: string;
  targetAudience: string;
}

export interface PricingTierField {
  id: string;
  name: string;
  price: string;
  features: string[];
  featured: boolean;
}

export interface PricingModuleFields {
  tiers: PricingTierField[];
  pricingModelSummary: string;
}

export interface ProductItemField {
  id: string;
  name: string;
  description: string;
}

export interface ProductsModuleFields {
  items: ProductItemField[];
  sellingPoints: string[];
}

export interface ServiceItemField {
  id: string;
  name: string;
  description: string;
}

export interface ServicesModuleFields {
  items: ServiceItemField[];
  companyStory: string;
  differentiators: string;
}

export type ModuleFieldValues =
  | { type: 'newsletter'; fields: NewsletterModuleFields }
  | { type: 'pricing'; fields: PricingModuleFields }
  | { type: 'products'; fields: ProductsModuleFields }
  | { type: 'services'; fields: ServicesModuleFields };

export interface ImageGenRequest {
  moduleType: ImageModuleType;
  moduleId?: string;
  prompt: string;
  presetId?: string;
  aspectRatio: ImageAspectRatio;
  n: number;
  brand: ImageGenBrandSettings;
  businessProfile?: BusinessProfile;
  plans?: Plan[];
  moduleFields?: ModuleFieldValues;
}

export interface ImageGenResponse {
  generationId: string;
  images: { id: string; baseImageUrl: string; finalImageUrl?: string }[];
}

// ── Integration Hub ──

export interface Integration {
  id: string;
  provider: string;
  category: string;
  status: 'connected' | 'disconnected' | 'error';
  credentials: Record<string, string>;
  metadata: Record<string, unknown>;
  updated_at: string;
}

// ── Sender Accounts ─────────────────────────────────────────────────────────

export type SenderProvider = 'gmail' | 'smtp' | 'sendgrid' | 'mailchimp';
export type SenderStatus = 'connected' | 'needs_reauth' | 'disabled';

export interface SenderAccount {
  id: string;
  workspace_id: string;
  provider: SenderProvider;
  display_name: string;
  from_email: string;
  from_name: string;
  status: SenderStatus;
  is_default: boolean;
  use_for_outreach: boolean;
  metadata: Record<string, unknown>;
  daily_sent_today: number;
  daily_sent_date: string;
  warmup_enabled: boolean;
  warmup_daily_sent: number;
  last_health_check_at: string | null;
  health_score: number | null;
  // Phase 3.1 health columns
  bounce_rate_7d: number;
  complaint_rate_7d: number;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface EmailDlqEntry {
  id: string;
  workspace_id: string;
  sender_account_id: string | null;
  message_id: string | null;
  to_email: string;
  kind: 'hard_bounce' | 'spam_complaint' | 'rate_limited' | 'provider_error' | 'unsubscribed' | 'other';
  reason: string | null;
  retry_count: number;
  first_failed_at: string;
  last_failed_at: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceUsageCounters {
  workspace_id: string;
  date_key: string;
  month_key: string;
  emails_sent: number;
  linkedin_actions: number;
  ai_credits_used: number;
  warmup_emails_sent: number;
}

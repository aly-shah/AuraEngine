import type { TriggerType, ActionType } from '../../types';
import type {
  WizardStepDescriptor,
  WizardStep,
  Workflow,
  NodeTypeMeta,
  NodeType,
  ExecutionLogEntry,
  HeaderPanelButton,
} from './types';

// ─── Wizard Steps ───
export const WIZARD_STEPS: WizardStepDescriptor[] = [
  { step: 1, label: 'Start', description: 'Name & Trigger' },
  { step: 2, label: 'Build', description: 'Visual Builder' },
  { step: 3, label: 'Configure', description: 'Step Settings' },
  { step: 4, label: 'Activate', description: 'Send & Launch' },
];

// ─── Email Templates ───
export const EMAIL_TEMPLATES = [
  { id: 'welcome', label: 'Welcome Email', desc: 'First-touch introduction' },
  { id: 'follow_up', label: 'Follow-up', desc: 'Check-in after initial contact' },
  { id: 'case_study', label: 'Case Study', desc: 'Share a relevant success story' },
  { id: 'demo_invite', label: 'Demo Invitation', desc: 'Invite to a product demo' },
  { id: 'nurture', label: 'Nurture Content', desc: 'Educational value-add email' },
  { id: 'custom', label: 'Custom Template', desc: 'Start from scratch' },
  { id: '__custom__', label: 'Write Custom Content', desc: 'Enter subject & body inline' },
];

// ─── Node Type Metadata (data only — icons rendered via helper) ───
export const NODE_TYPE_META: Record<NodeType, NodeTypeMeta> = {
  trigger: { label: 'TRIGGER', color: 'indigo', bgClass: 'bg-indigo-600 text-white' },
  action: { label: 'ACTION', color: 'emerald', bgClass: 'bg-emerald-600 text-white' },
  condition: { label: 'CONDITION', color: 'amber', bgClass: 'bg-amber-500 text-white' },
  wait: { label: 'WAIT', color: 'violet', bgClass: 'bg-violet-600 text-white' },
};

// ─── Trigger Options (data only — icons rendered inline) ───
export const TRIGGER_OPTIONS: { type: TriggerType; label: string; desc: string; iconName: string }[] = [
  { type: 'lead_created', label: 'Lead Created', desc: 'When a new lead enters the pipeline', iconName: 'plus' },
  { type: 'score_change', label: 'Lead Score Changes', desc: 'When a lead score crosses a threshold', iconName: 'trendUp' },
  { type: 'status_change', label: 'Lead Activity Occurs', desc: 'When a lead status or activity changes', iconName: 'activity' },
  { type: 'time_elapsed', label: 'Scheduled Time', desc: 'Run at a scheduled time or after delay', iconName: 'calendar' },
  { type: 'tag_added', label: 'Custom Trigger', desc: 'Tag added, custom event, or webhook', iconName: 'bolt' },
];

// ─── Action Options ───
export const ACTION_OPTIONS: { type: ActionType; label: string }[] = [
  { type: 'send_email', label: 'Send Email' },
  { type: 'update_status', label: 'Update Status' },
  { type: 'add_tag', label: 'Add Tag' },
  { type: 'assign_user', label: 'Assign to User' },
  { type: 'generate_content', label: 'Generate Content' },
  { type: 'create_alert', label: 'Create Alert' },
  { type: 'move_to_segment', label: 'Move to Segment' },
  { type: 'notify_slack', label: 'Notify Slack' },
  { type: 'sync_crm', label: 'Sync to CRM' },
];

// ─── Model, Frequency & Operator Options ───
export const MODEL_OPTIONS = ['gemini-3-flash', 'gemini-3-pro', 'gpt-4o', 'claude-sonnet'];
export const FREQUENCY_OPTIONS = ['real_time', 'hourly', 'daily', 'weekly'];
export const OPERATOR_OPTIONS = [
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'eq', label: 'Equals' },
];

// ─── Execution Status Styles ───
export const EXECUTION_STATUS_STYLES: Record<ExecutionLogEntry['status'], { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Success' },
  failed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Failed' },
  skipped: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Skipped' },
  running: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Running' },
};

// ─── Default Workflow ───
export const DEFAULT_WORKFLOW: Workflow = {
  id: 'wf-default',
  name: 'New Lead Nurturing Sequence',
  description: 'Automatically nurture new leads through a personalized email sequence with AI scoring.',
  status: 'active',
  nodes: [
    { id: 'n1', type: 'trigger', title: 'New lead added', description: 'Triggers when a lead enters the pipeline', config: { triggerType: 'lead_created' } },
    { id: 'n2', type: 'action', title: 'AI scores lead', description: 'Automatically scores the lead using AI model', config: { actionType: 'send_email', model: 'gemini-3-flash', companyData: true, webBehavior: true, socialSignals: false, emailEngagement: true, frequency: 'real_time', threshold: 80, template: 'welcome', aiPersonalization: true, timing: 'immediate', fallbackEnabled: false } },
    { id: 'n3', type: 'condition', title: 'Score > 50?', description: 'Check if lead score exceeds threshold', config: { field: 'score', operator: 'gt', value: 50 } },
    { id: 'n4', type: 'action', title: 'Send welcome email', description: 'Personalized welcome with value proposition', config: { actionType: 'send_email', emailType: 'welcome', template: 'welcome', aiPersonalization: true, timing: 'immediate', fallbackEnabled: true, fallbackAction: 'create_task' } },
    { id: 'n5', type: 'action', title: 'Add to nurture campaign', description: 'Enroll in drip nurture sequence', config: { actionType: 'send_email', campaign: 'nurture_sequence', template: 'nurture', aiPersonalization: false, timing: 'immediate', fallbackEnabled: false } },
    { id: 'n6', type: 'wait', title: 'Wait 2 days', description: 'Allow time for email engagement', config: { days: 2 } },
    { id: 'n7', type: 'action', title: 'Check engagement', description: 'Evaluate email opens and clicks', config: { actionType: 'send_email', checkType: 'email_engagement', template: 'follow_up', aiPersonalization: true, timing: 'optimal', fallbackEnabled: false } },
    { id: 'n8', type: 'condition', title: 'Score > 75?', description: 'Check if lead is sales-ready', config: { field: 'score', operator: 'gt', value: 75 } },
    { id: 'n9', type: 'action', title: 'Notify sales team', description: 'Alert sales rep for immediate follow-up', config: { actionType: 'create_alert', notifyType: 'sales_alert', template: 'demo_invite', aiPersonalization: true, timing: 'immediate', fallbackEnabled: true, fallbackAction: 'create_alert' } },
  ],
  createdAt: new Date().toISOString(),
  stats: { leadsProcessed: 1242, conversionRate: 8.4, timeSavedHrs: 42, roi: 320 },
};

// ─── Header Panel Buttons Config ───
export const HEADER_PANEL_BUTTONS: HeaderPanelButton[] = [
  { panel: 'executionLog', label: 'Execution Log', iconName: 'activity', activeColor: 'text-indigo-700', activeBg: 'bg-indigo-50', activeBorder: 'border-indigo-200' },
  { panel: 'healthPanel', label: 'Health', iconName: 'shield', activeColor: 'text-emerald-700', activeBg: 'bg-emerald-50', activeBorder: 'border-emerald-200' },
  { panel: 'nodeAnalytics', label: 'Analytics', iconName: 'pieChart', activeColor: 'text-violet-700', activeBg: 'bg-violet-50', activeBorder: 'border-violet-200' },
  { panel: 'roiCalculator', label: 'ROI', iconName: 'trendUp', activeColor: 'text-amber-700', activeBg: 'bg-amber-50', activeBorder: 'border-amber-200' },
  { panel: 'triggerAnalytics', label: 'Triggers', iconName: 'bolt', activeColor: 'text-rose-700', activeBg: 'bg-rose-50', activeBorder: 'border-rose-200' },
  { panel: 'templateEffectiveness', label: 'Templates', iconName: 'mail', activeColor: 'text-sky-700', activeBg: 'bg-sky-50', activeBorder: 'border-sky-200' },
  { panel: 'campaignsPanel', label: 'Campaigns', iconName: 'send', activeColor: 'text-violet-700', activeBg: 'bg-violet-50', activeBorder: 'border-violet-200' },
];

// ─── Workflow Status Styles ───
export const WORKFLOW_STATUS_STYLES = {
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  paused: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  draft: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
} as const;

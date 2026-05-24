import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { User } from '../../types';
import { supabase } from '../../lib/supabase';
import {
  fetchIntegrations as fetchIntegrationsFromDb,
  upsertIntegration,
  disconnectIntegration as disconnectIntegrationDb,
  validateIntegration,
} from '../../lib/integrations';
import {
  PlugIcon, PlusIcon, CheckIcon, XIcon, RefreshIcon, CopyIcon, KeyIcon,
  BoltIcon, GlobeIcon, LinkIcon, AlertTriangleIcon, EyeIcon, EditIcon,
  DownloadIcon, BellIcon, ShieldIcon, ActivityIcon, DatabaseIcon,
  ClockIcon, MailIcon, MessageIcon, ChartIcon, FilterIcon, PlayIcon,
  CogIcon, LockIcon, ZapIcon, KeyboardIcon, BrainIcon, TrendUpIcon,
  TrendDownIcon, LayersIcon, TargetIcon, StarIcon, ArrowRightIcon,
  SparklesIcon
} from '../../components/Icons';
import { PageHeader } from '../../components/layout/PageHeader';
import { AdvancedOnly } from '../../components/ui-mode';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';

interface LayoutContext {
  user: User;
  refreshProfile: () => Promise<void>;
}

type IntegrationCategory = 'all' | 'crm' | 'marketing' | 'comms' | 'analytics' | 'email' | 'payment';
type IntegrationStatus = 'connected' | 'partial' | 'disconnected';
type SyncDirection = 'bidirectional' | 'outbound' | 'inbound';

interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  lastSync: string;
  syncDirection: SyncDirection;
  objects: string[];
  error?: string;
  icon: string;
  color: string;
  dataVolume: number; // percentage
}

interface ApiKeyData {
  id: string;
  name: string;
  keyPreview: string;
  fullKey: string;
  lastUsed: string;
  permissions: 'read' | 'readwrite';
  active: boolean;
}

interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  integration: string;
  direction: string;
  records: number;
  status: 'success' | 'failed' | 'partial';
  duration: number;
}

interface IntegrationHealthMetric {
  name: string;
  uptime: number;
  errorRate: number;
  avgLatency: number;
  lastIncident: string;
  status: 'healthy' | 'degraded' | 'down';
}

const MOCK_SYNC_HISTORY: SyncHistoryEntry[] = [
  { id: 'sh1', timestamp: new Date(Date.now() - 120000).toISOString(), integration: 'Salesforce', direction: 'Inbound', records: 12, status: 'success', duration: 1.8 },
  { id: 'sh2', timestamp: new Date(Date.now() - 300000).toISOString(), integration: 'HubSpot', direction: 'Outbound', records: 45, status: 'success', duration: 3.2 },
  { id: 'sh3', timestamp: new Date(Date.now() - 600000).toISOString(), integration: 'Slack', direction: 'Outbound', records: 1, status: 'partial', duration: 0.5 },
  { id: 'sh4', timestamp: new Date(Date.now() - 900000).toISOString(), integration: 'Google Analytics', direction: 'Inbound', records: 1842, status: 'success', duration: 8.4 },
  { id: 'sh5', timestamp: new Date(Date.now() - 1500000).toISOString(), integration: 'Mailchimp', direction: 'Outbound', records: 42, status: 'success', duration: 2.1 },
  { id: 'sh6', timestamp: new Date(Date.now() - 1800000).toISOString(), integration: 'Salesforce', direction: 'Outbound', records: 8, status: 'failed', duration: 5.0 },
  { id: 'sh7', timestamp: new Date(Date.now() - 2400000).toISOString(), integration: 'HubSpot', direction: 'Outbound', records: 23, status: 'success', duration: 1.9 },
  { id: 'sh8', timestamp: new Date(Date.now() - 3600000).toISOString(), integration: 'Slack', direction: 'Outbound', records: 1, status: 'success', duration: 0.3 },
  { id: 'sh9', timestamp: new Date(Date.now() - 5400000).toISOString(), integration: 'Google Analytics', direction: 'Inbound', records: 2104, status: 'success', duration: 9.1 },
  { id: 'sh10', timestamp: new Date(Date.now() - 7200000).toISOString(), integration: 'Salesforce', direction: 'Inbound', records: 6, status: 'success', duration: 1.2 },
];

const SYNC_STATUS_STYLES: Record<SyncHistoryEntry['status'], { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Success' },
  failed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Failed' },
  partial: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partial' },
};

const SECURITY_CHECKS = [
  { label: 'API Keys Encrypted', status: 'pass' as const, detail: 'AES-256 at rest' },
  { label: 'OAuth 2.0 Tokens', status: 'pass' as const, detail: 'Auto-refresh enabled' },
  { label: 'Data in Transit', status: 'pass' as const, detail: 'TLS 1.3 enforced' },
  { label: 'IP Allowlisting', status: 'warn' as const, detail: 'Not configured' },
  { label: 'Webhook Signatures', status: 'pass' as const, detail: 'HMAC-SHA256 verified' },
  { label: 'Audit Logging', status: 'pass' as const, detail: '90-day retention' },
  { label: 'Data Residency', status: 'pass' as const, detail: 'US-East-1 region' },
  { label: 'PII Masking', status: 'warn' as const, detail: 'Email fields exposed' },
];

const DEFAULT_INTEGRATIONS: Integration[] = [
  {
    id: 'salesforce', name: 'Salesforce', category: 'crm', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'bidirectional',
    objects: ['Leads', 'Contacts', 'Accounts'], icon: '☁️', color: '#00A1E0', dataVolume: 42,
  },
  {
    id: 'hubspot', name: 'HubSpot', category: 'marketing', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Campaigns', 'Contacts'], icon: '🔶', color: '#FF7A59', dataVolume: 28,
  },
  {
    id: 'slack', name: 'Slack', category: 'comms', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['#sales-alerts', '#leads'], icon: '💬', color: '#4A154B',
    dataVolume: 15,
  },
  {
    id: 'ga', name: 'Google Analytics', category: 'analytics', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'inbound',
    objects: ['Website traffic', 'Conversions'], icon: '📊', color: '#E37400', dataVolume: 10,
  },
  {
    id: 'mailchimp', name: 'Mailchimp', category: 'email', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Campaigns', 'Lists'], icon: '🐵', color: '#FFE01B', dataVolume: 5,
  },
  {
    id: 'sendgrid', name: 'SendGrid', category: 'email', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Transactional Email', 'Webhooks'], icon: '📧', color: '#1A82E2', dataVolume: 0,
  },
  {
    id: 'gmail', name: 'Gmail SMTP', category: 'email', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Email Sending'], icon: '✉️', color: '#EA4335', dataVolume: 0,
  },
  {
    id: 'smtp', name: 'Custom SMTP', category: 'email', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Email Sending'], icon: '📮', color: '#6B7280', dataVolume: 0,
  },
  {
    id: 'stripe', name: 'Stripe', category: 'payment', status: 'disconnected',
    lastSync: 'Never', syncDirection: 'outbound',
    objects: ['Invoices', 'Payments'], icon: '💳', color: '#635BFF', dataVolume: 0,
  },
];

const DEFAULT_API_KEYS: ApiKeyData[] = [
  { id: 'prod', name: 'Production Key', keyPreview: 'af_live_...c2f9', fullKey: 'af_live_xxxx_xxxx_xxxx_xxxx_c2f9', lastUsed: '2 minutes ago', permissions: 'readwrite', active: true },
  { id: 'dev', name: 'Development Key', keyPreview: 'af_test_...8a3b', fullKey: 'af_test_xxxx_xxxx_xxxx_xxxx_8a3b', lastUsed: '1 hour ago', permissions: 'read', active: true },
];

const SYNC_STATS = {
  totalRecords: 12842,
  successRate: 99.8,
  avgSyncTime: 2.4,
  failedSyncs: 24,
};

const API_USAGE = {
  requestsToday: 8424,
  avgLatency: 142,
  errorRate: 0.8,
  costToday: 4.28,
  rateLimits: { perMinute: 60, perHour: 1000, perDay: 10000 },
  currentUsagePct: 42,
};

const IntegrationHub: React.FC = () => {
  const { user } = useOutletContext<LayoutContext>();
  const [categoryFilter, setCategoryFilter] = useState<IntegrationCategory>('all');
  const [integrations, setIntegrations] = useState<Integration[]>(DEFAULT_INTEGRATIONS);
  const [apiKeys, setApiKeys] = useState<ApiKeyData[]>(DEFAULT_API_KEYS);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean } | null>(null);
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [showKeyFull, setShowKeyFull] = useState<string | null>(null);

  // ─── Email Provider Setup Modal State ───
  const [emailSetupId, setEmailSetupId] = useState<string | null>(null);
  const [emailSetupApiKey, setEmailSetupApiKey] = useState('');
  const [emailSetupSmtpHost, setEmailSetupSmtpHost] = useState('');
  const [emailSetupSmtpPort, setEmailSetupSmtpPort] = useState('587');
  const [emailSetupSmtpUser, setEmailSetupSmtpUser] = useState('');
  const [emailSetupSmtpPass, setEmailSetupSmtpPass] = useState('');
  const [emailSetupFromEmail, setEmailSetupFromEmail] = useState('');
  const [emailSetupFromName, setEmailSetupFromName] = useState('');
  const [emailSetupTesting, setEmailSetupTesting] = useState(false);
  const [emailSetupResult, setEmailSetupResult] = useState<'success' | 'error' | 'sent' | null>(null);
  const [emailSetupTestError, setEmailSetupTestError] = useState('');
  const [emailSetupSaving, setEmailSetupSaving] = useState(false);

  // ─── Generic (Non-Email) Integration Setup Modal State ───
  const [genericSetupId, setGenericSetupId] = useState<string | null>(null);
  const [genericSetupApiKey, setGenericSetupApiKey] = useState('');
  const [genericSetupWebhookUrl, setGenericSetupWebhookUrl] = useState('');
  const [genericSetupInstanceUrl, setGenericSetupInstanceUrl] = useState('');
  const [genericSetupAccessToken, setGenericSetupAccessToken] = useState('');
  const [genericSetupMeasurementId, setGenericSetupMeasurementId] = useState('');
  const [genericSetupApiSecret, setGenericSetupApiSecret] = useState('');
  const [genericSetupSaving, setGenericSetupSaving] = useState(false);
  const [genericSetupTesting, setGenericSetupTesting] = useState(false);
  const [genericSetupResult, setGenericSetupResult] = useState<'success' | 'error' | null>(null);
  const [genericSetupError, setGenericSetupError] = useState('');

  // ─── Enhanced Wireframe State ───
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHealthDashboard, setShowHealthDashboard] = useState(false);
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const [showPipelineAnalytics, setShowPipelineAnalytics] = useState(false);
  const [showErrorDiagnostics, setShowErrorDiagnostics] = useState(false);
  const [showCostOptimization, setShowCostOptimization] = useState(false);
  const [configureId, setConfigureId] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<{ syncDirection: SyncDirection; objects: string[]; syncInterval: string }>({ syncDirection: 'bidirectional', objects: [], syncInterval: '5' });

  const EMAIL_PROVIDERS = useMemo(() => new Set(['sendgrid', 'gmail', 'smtp', 'mailchimp']), []);

  // ─── Load email provider configs from DB + non-email configs from DB ───
  useEffect(() => {
    (async () => {
      try {
        // Load non-email integrations from `integrations` table
        const dbIntegrations = await fetchIntegrationsFromDb();

        // Load email provider configs from DB
        const { data } = await supabase.from('email_provider_configs').select('provider, is_active, from_email, updated_at');

        setIntegrations(prev => prev.map(i => {
          // Email providers: check DB
          if (EMAIL_PROVIDERS.has(i.id)) {
            if (data && data.length > 0) {
              const match = data.find((d: any) => d.provider === i.id && d.is_active);
              if (match) {
                const ago = Math.round((Date.now() - new Date(match.updated_at).getTime()) / 60000);
                const lastSync = ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
                return { ...i, status: 'connected' as IntegrationStatus, lastSync };
              }
            }
            return { ...i, status: 'disconnected' as IntegrationStatus };
          }

          // Non-email providers: check `integrations` table
          const dbMatch = dbIntegrations.find(d => d.provider === i.id && d.status === 'connected');
          if (dbMatch) {
            const ago = Math.round((Date.now() - new Date(dbMatch.updated_at).getTime()) / 60000);
            const lastSync = ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
            return { ...i, status: 'connected' as IntegrationStatus, lastSync, error: undefined };
          }
          return i;
        }));
      } catch (err) {
        console.error('Failed to load integration configs:', err);
      }
    })();
  }, [EMAIL_PROVIDERS]);

  // ─── Filtered integrations ───
  const filteredIntegrations = useMemo(() => {
    if (categoryFilter === 'all') return integrations;
    return integrations.filter(i => i.category === categoryFilter);
  }, [integrations, categoryFilter]);

  // ─── Data volume chart ───
  const volumeChartData = useMemo(() =>
    integrations.map(i => ({
      name: i.name,
      volume: i.dataVolume,
      color: i.color,
    })),
  [integrations]);

  // ─── KPI Stats ───
  const kpiStats = useMemo(() => {
    const connectedCount = integrations.filter(i => i.status === 'connected').length;
    const totalVolume = integrations.reduce((s, i) => s + i.dataVolume, 0);

    return [
      { label: 'Connected', value: `${connectedCount}/${integrations.length}`, icon: <PlugIcon className="w-5 h-5" />, color: 'indigo', trend: `${integrations.filter(i => i.status === 'partial').length} partial`, up: connectedCount > 0 },
      { label: 'Records Synced', value: SYNC_STATS.totalRecords.toLocaleString(), icon: <RefreshIcon className="w-5 h-5" />, color: 'emerald', trend: `${SYNC_STATS.successRate}% success rate`, up: true },
      { label: 'API Requests', value: API_USAGE.requestsToday.toLocaleString(), icon: <GlobeIcon className="w-5 h-5" />, color: 'blue', trend: `${API_USAGE.avgLatency}ms avg latency`, up: true },
      { label: 'Data Volume', value: `${totalVolume}%`, icon: <DatabaseIcon className="w-5 h-5" />, color: 'violet', trend: `${integrations.length} sources active`, up: true },
      { label: 'API Cost', value: `$${API_USAGE.costToday.toFixed(2)}`, icon: <TargetIcon className="w-5 h-5" />, color: 'fuchsia', trend: `${API_USAGE.currentUsagePct}% of rate limit`, up: API_USAGE.currentUsagePct < 80 },
    ];
  }, [integrations]);

  // ─── Integration Health ───
  const integrationHealth = useMemo((): IntegrationHealthMetric[] => {
    return integrations.map(integ => ({
      name: integ.name,
      uptime: integ.status === 'connected' ? 99.0 + Math.random() * 0.99 : integ.status === 'partial' ? 85 + Math.random() * 10 : 0,
      errorRate: integ.status === 'connected' ? Math.random() * 2 : integ.status === 'partial' ? 5 + Math.random() * 10 : 100,
      avgLatency: 50 + Math.floor(Math.random() * 200),
      lastIncident: integ.status === 'connected' ? '14 days ago' : integ.status === 'partial' ? '2 hours ago' : 'Now',
      status: integ.status === 'connected' ? 'healthy' : integ.status === 'partial' ? 'degraded' : 'down',
    }));
  }, [integrations]);

  // ─── Data Pipeline Analytics ───
  const pipelineAnalytics = useMemo(() => {
    const throughput = integrations.map(integ => ({
      name: integ.name,
      recordsPerHour: Math.round(integ.dataVolume * 28 + Math.random() * 50),
      avgLatency: Math.round(80 + Math.random() * 180),
      peakLoad: Math.round(60 + Math.random() * 38),
      queueDepth: Math.floor(Math.random() * 15),
      status: integ.status,
    }));

    const hourlyFlow = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
      inbound: Math.round(Math.sin((h - 9) * 0.4) * 120 + 150 + (Math.random() - 0.5) * 40),
      outbound: Math.round(Math.sin((h - 10) * 0.35) * 80 + 100 + (Math.random() - 0.5) * 30),
    }));
    const peakHour = hourlyFlow.reduce((best, h) => (h.inbound + h.outbound) > (best.inbound + best.outbound) ? h : best, hourlyFlow[0]);

    const totalThroughput = throughput.reduce((s, t) => s + t.recordsPerHour, 0);
    const avgLatency = throughput.length > 0 ? Math.round(throughput.reduce((s, t) => s + t.avgLatency, 0) / throughput.length) : 0;
    const bottleneck = throughput.reduce((worst, t) => t.avgLatency > worst.avgLatency ? t : worst, throughput[0]);

    return { throughput, hourlyFlow, peakHour, totalThroughput, avgLatency, bottleneck };
  }, [integrations]);

  // ─── Error Diagnostics ───
  const errorDiagnostics = useMemo(() => {
    const errorCategories = [
      { type: 'Authentication', count: 3, severity: 'low' as const, trend: -12, lastSeen: '2h ago', resolution: 'Auto-refreshed OAuth tokens' },
      { type: 'Rate Limiting', count: 8, severity: 'medium' as const, trend: 5, lastSeen: '15m ago', resolution: 'Implement exponential backoff' },
      { type: 'Schema Mismatch', count: 2, severity: 'high' as const, trend: -50, lastSeen: '1d ago', resolution: 'Update field mappings' },
      { type: 'Timeout', count: 5, severity: 'medium' as const, trend: -8, lastSeen: '45m ago', resolution: 'Increase timeout threshold' },
      { type: 'Network Error', count: 1, severity: 'low' as const, trend: -75, lastSeen: '3d ago', resolution: 'Retry with circuit breaker' },
      { type: 'Data Validation', count: 4, severity: 'medium' as const, trend: 15, lastSeen: '30m ago', resolution: 'Add input sanitization' },
    ];

    const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return {
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        errors: Math.floor(Math.random() * 12) + 2,
        resolved: Math.floor(Math.random() * 10) + 1,
      };
    });

    const totalErrors = errorCategories.reduce((s, e) => s + e.count, 0);
    const criticalCount = errorCategories.filter(e => e.severity === 'high').length;
    const retrySuccessRate = 94.2;
    const mttr = 4.8; // minutes mean time to resolve

    return { errorCategories, weeklyTrend, totalErrors, criticalCount, retrySuccessRate, mttr };
  }, []);

  // ─── Cost Optimization ───
  const costOptimization = useMemo(() => {
    const perIntegration = integrations.map(integ => ({
      name: integ.name,
      monthlyCost: Math.round(integ.dataVolume * 2.8 + Math.random() * 20),
      callsPerDay: Math.round(integ.dataVolume * 180 + Math.random() * 500),
      costPerRecord: (0.001 + Math.random() * 0.008).toFixed(4),
      optimizable: Math.round(Math.random() * 25 + 5),
    }));

    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
      return {
        month: d.toLocaleDateString('en-US', { month: 'short' }),
        actual: Math.round(85 + i * 8 + (Math.random() - 0.5) * 15),
        optimized: Math.round(65 + i * 5 + (Math.random() - 0.5) * 10),
      };
    });

    const totalMonthlyCost = perIntegration.reduce((s, p) => s + p.monthlyCost, 0);
    const potentialSavings = perIntegration.reduce((s, p) => s + Math.round(p.monthlyCost * p.optimizable / 100), 0);
    const savingsPct = totalMonthlyCost > 0 ? Math.round((potentialSavings / totalMonthlyCost) * 100) : 0;

    const recommendations = [
      { action: 'Batch Salesforce syncs to reduce API calls', savings: '$12/mo', impact: 'high' as const },
      { action: 'Cache Google Analytics responses for 15min', savings: '$8/mo', impact: 'medium' as const },
      { action: 'Reduce Slack notification frequency', savings: '$3/mo', impact: 'low' as const },
      { action: 'Use webhook instead of polling for HubSpot', savings: '$15/mo', impact: 'high' as const },
    ];

    return { perIntegration, monthlyTrend, totalMonthlyCost, potentialSavings, savingsPct, recommendations };
  }, [integrations]);

  // ─── Handlers ───
  const handleCopyKey = useCallback((key: ApiKeyData) => {
    navigator.clipboard.writeText(key.fullKey);
    setCopiedKey(key.id);
    setTimeout(() => setCopiedKey(null), 2000);
  }, []);

  const handleRegenerateKey = useCallback((keyId: string) => {
    const chars = 'abcdef0123456789';
    const newSuffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setApiKeys(prev => prev.map(k => k.id === keyId ? {
      ...k,
      keyPreview: `${k.keyPreview.split('...')[0]}...${newSuffix}`,
      fullKey: `${k.fullKey.slice(0, -4)}${newSuffix}`,
      lastUsed: 'Just now',
    } : k));
  }, []);

  // ─── Email Provider Setup Modal Handlers (defined early to avoid forward-ref issues) ───
  const isSmtpProvider = (id: string) => id === 'smtp' || id === 'gmail';

  const openEmailSetup = useCallback(async (id: string) => {
    setEmailSetupApiKey('');
    setEmailSetupSmtpHost(id === 'gmail' ? 'smtp.gmail.com' : '');
    setEmailSetupSmtpPort(id === 'gmail' ? '587' : '587');
    setEmailSetupSmtpUser('');
    setEmailSetupSmtpPass('');
    setEmailSetupFromEmail('');
    setEmailSetupFromName('');
    setEmailSetupResult(null);
    setEmailSetupTesting(false);
    setEmailSetupSaving(false);
    setEmailSetupTestError('');

    // Pre-fill from existing config if any
    try {
      const { data } = await supabase
        .from('email_provider_configs')
        .select('*')
        .eq('provider', id)
        .limit(1)
        .single();
      if (data) {
        if (data.api_key) setEmailSetupApiKey(data.api_key);
        if (data.smtp_host) setEmailSetupSmtpHost(data.smtp_host);
        if (data.smtp_port) setEmailSetupSmtpPort(String(data.smtp_port));
        if (data.smtp_user) setEmailSetupSmtpUser(data.smtp_user);
        if (data.smtp_pass) setEmailSetupSmtpPass(data.smtp_pass);
        if (data.from_email) setEmailSetupFromEmail(data.from_email);
        if (data.from_name) setEmailSetupFromName(data.from_name);
      }
    } catch {}

    setEmailSetupId(id);
  }, []);

  // ─── Generic Integration Setup Modal Handlers (defined early) ───
  const openGenericSetup = useCallback(async (id: string) => {
    setGenericSetupApiKey('');
    setGenericSetupWebhookUrl('');
    setGenericSetupInstanceUrl('');
    setGenericSetupAccessToken('');
    setGenericSetupMeasurementId('');
    setGenericSetupApiSecret('');
    setGenericSetupResult(null);
    setGenericSetupError('');
    setGenericSetupSaving(false);
    setGenericSetupTesting(false);

    // Pre-fill from existing DB config if any
    try {
      const dbIntegrations = await fetchIntegrationsFromDb();
      const existing = dbIntegrations.find(d => d.provider === id);
      if (existing && existing.credentials) {
        const creds = existing.credentials;
        if (creds.apiKey) setGenericSetupApiKey(creds.apiKey);
        if (creds.webhookUrl) setGenericSetupWebhookUrl(creds.webhookUrl);
        if (creds.instanceUrl) setGenericSetupInstanceUrl(creds.instanceUrl);
        if (creds.accessToken) setGenericSetupAccessToken(creds.accessToken);
        if (creds.measurementId) setGenericSetupMeasurementId(creds.measurementId);
        if (creds.apiSecret) setGenericSetupApiSecret(creds.apiSecret);
        if (creds.secret_key) setGenericSetupApiKey(creds.secret_key);
      }
    } catch {}

    setGenericSetupId(id);
  }, []);

  const handleTestIntegration = useCallback(async (id: string) => {
    setTestingId(id);
    setTestResult(null);

    if (EMAIL_PROVIDERS.has(id)) {
      // Actually send a test email via the send-email edge function
      try {
        const { data: configRows } = await supabase
          .from('email_provider_configs')
          .select('from_email, is_active')
          .eq('provider', id)
          .eq('is_active', true)
          .limit(1);

        if (!configRows || configRows.length === 0) {
          setTestResult({ id, success: false });
          setTestingId(null);
          return;
        }

        const fromEmail = configRows[0].from_email;
        if (!fromEmail) {
          setTestResult({ id, success: false });
          setTestingId(null);
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setTestResult({ id, success: false });
          setTestingId(null);
          return;
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            to_email: fromEmail,
            subject: `Scaliyo Test — ${id.toUpperCase()} connection verified`,
            html_body: `<div style="font-family:sans-serif;padding:20px;"><h2>Connection Test Successful</h2><p>Your <strong>${id.toUpperCase()}</strong> integration is working correctly.</p><p style="color:#888;font-size:12px;">Sent by Scaliyo at ${new Date().toLocaleString()}</p></div>`,
            provider: id,
            track_opens: false,
            track_clicks: false,
          }),
        });

        const result = await res.json();
        setTestResult({ id, success: !!result.success });
      } catch {
        setTestResult({ id, success: false });
      }
      setTestingId(null);
    } else {
      // Real check: see if integration exists and is connected in DB
      try {
        const dbIntegrations = await fetchIntegrationsFromDb();
        const match = dbIntegrations.find(d => d.provider === id && d.status === 'connected');
        if (match) {
          const result = await validateIntegration(id, match.credentials);
          setTestResult({ id, success: result.success });
        } else {
          setTestResult({ id, success: false });
        }
      } catch {
        setTestResult({ id, success: false });
      }
      setTestingId(null);
    }
  }, [EMAIL_PROVIDERS]);

  const handleDisconnect = useCallback(async (id: string) => {
    if (EMAIL_PROVIDERS.has(id)) {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from('email_provider_configs').update({ is_active: false }).eq('owner_id', authUser.id).eq('provider', id);
      }
    } else {
      // Disconnect non-email integration in DB
      try {
        await disconnectIntegrationDb(id);
      } catch (err) {
        console.error('Failed to disconnect integration:', err);
      }
    }
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, status: 'disconnected' as IntegrationStatus, lastSync: 'Never' } : i));
  }, [EMAIL_PROVIDERS]);

  const handleReconnect = useCallback(async (id: string) => {
    if (EMAIL_PROVIDERS.has(id)) {
      openEmailSetup(id);
    } else {
      openGenericSetup(id);
    }
  }, [EMAIL_PROVIDERS, openEmailSetup, openGenericSetup]);

  const handleConfigure = useCallback((id: string) => {
    const integ = integrations.find(i => i.id === id);
    if (integ) {
      setConfigForm({ syncDirection: integ.syncDirection, objects: [...integ.objects], syncInterval: '5' });
      setConfigureId(id);
    }
  }, [integrations]);

  const handleSaveConfig = useCallback(() => {
    if (!configureId) return;
    setIntegrations(prev => prev.map(i => i.id === configureId ? { ...i, syncDirection: configForm.syncDirection, objects: configForm.objects, lastSync: 'Just now' } : i));
    setConfigureId(null);
  }, [configureId, configForm]);

  const handleExportConfig = useCallback(() => {
    const config = {
      integrations: integrations.map(i => ({
        name: i.name, category: i.category, status: i.status,
        syncDirection: i.syncDirection, objects: i.objects,
      })),
      exportedAt: new Date().toISOString(),
      exportedBy: user.name,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `integration_config_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [integrations, user.name]);

  const handleEmailSetupTest = useCallback(async () => {
    if (!emailSetupId) return;
    setEmailSetupTesting(true);
    setEmailSetupResult(null);
    setEmailSetupTestError('');

    // Quick field validation
    if (isSmtpProvider(emailSetupId)) {
      if (!emailSetupSmtpHost || !emailSetupSmtpUser || !emailSetupSmtpPass) {
        setEmailSetupResult('error');
        setEmailSetupTestError('Please fill in SMTP host, username, and password.');
        setEmailSetupTesting(false);
        return;
      }
    } else {
      if (!emailSetupApiKey || emailSetupApiKey.length < 8) {
        setEmailSetupResult('error');
        setEmailSetupTestError('Please enter a valid API key (at least 8 characters).');
        setEmailSetupTesting(false);
        return;
      }
    }

    if (!emailSetupFromEmail) {
      setEmailSetupResult('error');
      setEmailSetupTestError('Please fill in the "From Email" field — the test email will be sent there.');
      setEmailSetupTesting(false);
      return;
    }

    try {
      // 1. Save credentials first so the edge function can load them
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setEmailSetupResult('error');
        setEmailSetupTestError('Not authenticated. Please log in again.');
        setEmailSetupTesting(false);
        return;
      }

      const row: Record<string, unknown> = {
        owner_id: authUser.id,
        provider: emailSetupId,
        is_active: true,
        from_email: emailSetupFromEmail || null,
        from_name: emailSetupFromName || null,
        updated_at: new Date().toISOString(),
      };

      if (isSmtpProvider(emailSetupId)) {
        row.smtp_host = emailSetupSmtpHost;
        row.smtp_port = parseInt(emailSetupSmtpPort) || 587;
        row.smtp_user = emailSetupSmtpUser;
        row.smtp_pass = emailSetupSmtpPass;
        row.api_key = null;
      } else {
        row.api_key = emailSetupApiKey;
        row.smtp_host = null;
        row.smtp_port = null;
        row.smtp_user = null;
        row.smtp_pass = null;
      }

      await supabase
        .from('email_provider_configs')
        .upsert(row, { onConflict: 'owner_id,provider' });

      // 2. Send a real test email via the send-email edge function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailSetupResult('error');
        setEmailSetupTestError('Session expired. Please log in again.');
        setEmailSetupTesting(false);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          to_email: emailSetupFromEmail,
          subject: `Scaliyo Test — ${emailSetupId.toUpperCase()} connection verified`,
          html_body: `<div style="font-family:sans-serif;padding:20px;"><h2>Connection Test Successful</h2><p>This email confirms your <strong>${emailSetupId.toUpperCase()}</strong> integration is working correctly.</p><p style="color:#888;font-size:12px;">Sent by Scaliyo at ${new Date().toLocaleString()}</p></div>`,
          provider: emailSetupId,
          track_opens: false,
          track_clicks: false,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmailSetupResult('sent');
      } else {
        setEmailSetupResult('error');
        setEmailSetupTestError(data.error || 'Unknown error from email provider.');
      }
    } catch (err) {
      setEmailSetupResult('error');
      setEmailSetupTestError(`Network error: ${(err as Error).message}`);
    } finally {
      setEmailSetupTesting(false);
    }
  }, [emailSetupId, emailSetupApiKey, emailSetupSmtpHost, emailSetupSmtpPort, emailSetupSmtpUser, emailSetupSmtpPass, emailSetupFromEmail, emailSetupFromName]);

  const handleEmailSetupActivate = useCallback(async () => {
    if (!emailSetupId) return;
    setEmailSetupSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authUser = session?.user;
      if (!authUser || !session) { setEmailSetupSaving(false); return; }

      // 1. Save to legacy email_provider_configs (keeps existing flows working)
      const row: Record<string, unknown> = {
        owner_id: authUser.id,
        provider: emailSetupId,
        is_active: true,
        from_email: emailSetupFromEmail || null,
        from_name: emailSetupFromName || null,
        updated_at: new Date().toISOString(),
      };

      if (isSmtpProvider(emailSetupId)) {
        row.smtp_host = emailSetupSmtpHost;
        row.smtp_port = parseInt(emailSetupSmtpPort) || 587;
        row.smtp_user = emailSetupSmtpUser;
        row.smtp_pass = emailSetupSmtpPass;
        row.api_key = null;
      } else {
        row.api_key = emailSetupApiKey;
        row.smtp_host = null;
        row.smtp_port = null;
        row.smtp_user = null;
        row.smtp_pass = null;
      }

      await supabase
        .from('email_provider_configs')
        .upsert(row, { onConflict: 'owner_id,provider' });

      // 2. Create sender_accounts + sender_account_secrets via edge function
      //    so the account appears on the Sender Accounts page.
      let edgeFn: string;
      let body: Record<string, unknown>;

      if (isSmtpProvider(emailSetupId)) {
        edgeFn = 'connect-smtp';
        body = {
          workspaceId: authUser.id,
          host: emailSetupSmtpHost,
          port: parseInt(emailSetupSmtpPort) || 587,
          user: emailSetupSmtpUser,
          pass: emailSetupSmtpPass,
          fromEmail: emailSetupFromEmail,
          fromName: emailSetupFromName,
          skipValidation: true, // Already validated via test email
        };
      } else if (emailSetupId === 'sendgrid') {
        edgeFn = 'connect-sendgrid';
        body = {
          workspaceId: authUser.id,
          apiKey: emailSetupApiKey,
          fromEmail: emailSetupFromEmail,
          fromName: emailSetupFromName,
        };
      } else {
        edgeFn = 'connect-mailchimp-oauth';
        body = {
          workspaceId: authUser.id,
          apiKey: emailSetupApiKey,
        };
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke(edgeFn, {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (fnError) {
        const detail = fnData?.error || fnError.message;
        console.error(`Edge function ${edgeFn} error:`, detail);
        setEmailSetupResult('error');
        setEmailSetupTestError(`Failed to create sender account: ${detail}`);
        setEmailSetupSaving(false);
        return;
      }

      setIntegrations(prev => prev.map(i =>
        i.id === emailSetupId ? { ...i, status: 'connected' as IntegrationStatus, lastSync: 'Just now', error: undefined } : i
      ));
      setEmailSetupId(null);
    } catch (err) {
      console.error('Failed to save email provider config:', err);
    } finally {
      setEmailSetupSaving(false);
    }
  }, [emailSetupId, emailSetupApiKey, emailSetupSmtpHost, emailSetupSmtpPort, emailSetupSmtpUser, emailSetupSmtpPass, emailSetupFromEmail, emailSetupFromName]);

  const getGenericCredentials = useCallback((): Record<string, string> => {
    if (!genericSetupId) return {};
    switch (genericSetupId) {
      case 'slack':
        return { webhookUrl: genericSetupWebhookUrl };
      case 'hubspot':
        return { apiKey: genericSetupApiKey };
      case 'salesforce':
        return { instanceUrl: genericSetupInstanceUrl, accessToken: genericSetupAccessToken };
      case 'ga':
        return { measurementId: genericSetupMeasurementId, apiSecret: genericSetupApiSecret };
      case 'stripe':
        return { secret_key: genericSetupApiKey };
      default:
        return { apiKey: genericSetupApiKey };
    }
  }, [genericSetupId, genericSetupApiKey, genericSetupWebhookUrl, genericSetupInstanceUrl, genericSetupAccessToken, genericSetupMeasurementId, genericSetupApiSecret]);

  const getGenericCategory = useCallback((id: string): string => {
    const integ = integrations.find(i => i.id === id);
    if (!integ) return 'crm';
    switch (integ.category) {
      case 'crm': return 'crm';
      case 'marketing': return 'marketing';
      case 'comms': return 'comms';
      case 'analytics': return 'analytics';
      case 'payment': return 'payment';
      default: return integ.category;
    }
  }, [integrations]);

  const handleGenericSetupTest = useCallback(async () => {
    if (!genericSetupId) return;
    const creds = getGenericCredentials();
    const hasRequiredFields = Object.values(creds).some(v => v.trim());
    if (!hasRequiredFields) {
      setGenericSetupResult('error');
      setGenericSetupError('Please fill in the required fields.');
      return;
    }
    setGenericSetupTesting(true);
    setGenericSetupResult(null);
    setGenericSetupError('');

    try {
      const result = await validateIntegration(genericSetupId, creds);
      if (result.success) {
        setGenericSetupResult('success');
      } else {
        setGenericSetupResult('error');
        setGenericSetupError(result.error || 'Validation failed');
      }
    } catch (err) {
      setGenericSetupResult('error');
      setGenericSetupError(`Test failed: ${(err as Error).message}`);
    } finally {
      setGenericSetupTesting(false);
    }
  }, [genericSetupId, getGenericCredentials]);

  const handleGenericSetupSave = useCallback(async () => {
    if (!genericSetupId) return;
    const creds = getGenericCredentials();
    const hasRequiredFields = Object.values(creds).some(v => v.trim());
    if (!hasRequiredFields) return;

    setGenericSetupSaving(true);
    try {
      const category = getGenericCategory(genericSetupId);
      await upsertIntegration(genericSetupId, category, creds);

      setIntegrations(prev => prev.map(i =>
        i.id === genericSetupId
          ? { ...i, status: 'connected' as IntegrationStatus, lastSync: 'Just now', error: undefined }
          : i
      ));
      setGenericSetupId(null);
    } catch (err) {
      console.error('Failed to save integration:', err);
      setGenericSetupError(`Save failed: ${(err as Error).message}`);
    } finally {
      setGenericSetupSaving(false);
    }
  }, [genericSetupId, getGenericCredentials, getGenericCategory]);

  const statusColor = (s: IntegrationStatus) =>
    s === 'connected' ? 'emerald' : s === 'partial' ? 'amber' : 'slate';

  const statusDot = (s: IntegrationStatus) =>
    s === 'connected' ? 'bg-emerald-500' : s === 'partial' ? 'bg-amber-500' : 'bg-slate-300';

  const statusLabel = (s: IntegrationStatus) =>
    s === 'connected' ? 'Connected' : s === 'partial' ? 'Partial' : 'Disconnected';

  const syncLabel = (d: SyncDirection) =>
    d === 'bidirectional' ? 'Bi-directional' : d === 'outbound' ? 'Scaliyo → External' : 'External → Scaliyo';

  const categories: { key: IntegrationCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'email', label: 'Email' },
    { key: 'crm', label: 'CRM' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'comms', label: 'Comms' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'payment', label: 'Payment' },
  ];

  // ─── Keyboard Shortcuts ───
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (isInput) return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowShortcuts(s => !s); return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setShowHealthDashboard(s => !s); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); setShowSyncHistory(s => !s); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setShowSecurityPanel(s => !s); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowAddIntegration(s => !s); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setShowSyncLogs(s => !s); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); handleExportConfig(); return; }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setShowPipelineAnalytics(s => !s); return; }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setShowErrorDiagnostics(s => !s); return; }
      if (e.key === 'o' || e.key === 'O') { e.preventDefault(); setShowCostOptimization(s => !s); return; }
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setShowHealthDashboard(false);
        setShowSyncHistory(false);
        setShowSecurityPanel(false);
        setShowAddIntegration(false);
        setShowPipelineAnalytics(false);
        setShowErrorDiagnostics(false);
        setShowCostOptimization(false);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExportConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* HEADER                                                       */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <PageHeader
        title="Integrations"
        description={`Connected systems & APIs · ${integrations.filter(i => i.status === 'connected').length} active`}
        actions={
          <button
            onClick={() => setShowAddIntegration(!showAddIntegration)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
          >
            <PlusIcon className="w-4 h-4" />
            <span>Add New</span>
          </button>
        }
        advancedActions={
          <>
            <button
              onClick={() => setShowHealthDashboard(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showHealthDashboard ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <ActivityIcon className="w-3.5 h-3.5" />
              <span>Health</span>
            </button>
            <button
              onClick={() => setShowSyncHistory(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showSyncHistory ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <ClockIcon className="w-3.5 h-3.5" />
              <span>Sync History</span>
            </button>
            <button
              onClick={() => setShowSecurityPanel(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showSecurityPanel ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <ShieldIcon className="w-3.5 h-3.5" />
              <span>Security</span>
            </button>
            <button
              onClick={() => setShowPipelineAnalytics(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showPipelineAnalytics ? 'bg-cyan-50 text-cyan-700 border-cyan-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <BoltIcon className="w-3.5 h-3.5" />
              <span>Pipeline</span>
            </button>
            <button
              onClick={() => setShowErrorDiagnostics(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showErrorDiagnostics ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <AlertTriangleIcon className="w-3.5 h-3.5" />
              <span>Errors</span>
            </button>
            <button
              onClick={() => setShowCostOptimization(s => !s)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${showCostOptimization ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} shadow-sm`}
            >
              <TargetIcon className="w-3.5 h-3.5" />
              <span>Costs</span>
            </button>
            <button onClick={() => setShowShortcuts(true)} className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all">
              <KeyboardIcon className="w-3.5 h-3.5" />
              <span>?</span>
            </button>
          </>
        }
      />

      {/* Add Integration Quick Panel */}
      {showAddIntegration && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Available Integrations</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'Zapier', desc: 'Connect 5000+ apps', icon: '⚡' },
              { name: 'Stripe', desc: 'Payment processing', icon: '💳' },
              { name: 'Twilio', desc: 'SMS & voice', icon: '📱' },
              { name: 'SendGrid', desc: 'Email delivery', icon: '📧' },
              { name: 'Intercom', desc: 'Live chat', icon: '💬' },
              { name: 'Segment', desc: 'Data pipeline', icon: '📡' },
              { name: 'Mixpanel', desc: 'Product analytics', icon: '📈' },
              { name: 'Airtable', desc: 'Database & views', icon: '📋' },
            ].map(a => (
              <button
                key={a.name}
                onClick={() => { if (a.name === 'Stripe') { setShowAddIntegration(false); openGenericSetup('stripe'); } }}
                className="flex items-center space-x-3 p-3 rounded-xl border-2 border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all text-left"
              >
                <span className="text-xl">{a.icon}</span>
                <div>
                  <p className="text-sm font-bold text-slate-800">{a.name}</p>
                  <p className="text-[10px] text-slate-400">{a.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* KPI STATS BANNER                                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiStats.map((stat, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-xl bg-${stat.color}-50 text-${stat.color}-600 flex items-center justify-center group-hover:scale-110 transition-transform`}>
                {stat.icon}
              </div>
              {stat.up !== null && (
                stat.up ? <TrendUpIcon className="w-3.5 h-3.5 text-emerald-500" /> : <TrendDownIcon className="w-3.5 h-3.5 text-rose-500" />
              )}
            </div>
            <p className="text-xl font-black text-slate-900">{stat.value}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{stat.label}</p>
            <p className="text-[10px] text-slate-400 mt-1 truncate">{stat.trend}</p>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MAIN 3-COLUMN LAYOUT                                         */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col xl:flex-row gap-5">

        {/* ─── LEFT: Active Integrations (35%) ─── */}
        <div className="xl:w-[35%] space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-800 font-heading flex items-center space-x-2">
                  <PlugIcon className="w-4 h-4 text-violet-600" />
                  <span>Active Integrations</span>
                </h3>
                <span className="text-[10px] font-bold text-slate-400">{filteredIntegrations.length} shown</span>
              </div>

              {/* Category Filter */}
              <div className="flex items-center space-x-1.5">
                {categories.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setCategoryFilter(c.key)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                      categoryFilter === c.key
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Integration Cards */}
            <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
              {filteredIntegrations.map(integ => (
                <div key={integ.id} className="p-5 hover:bg-slate-50/30 transition-colors">
                  <div className="flex items-start space-x-3">
                    <span className="text-xl mt-0.5">{integ.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1.5">
                        <h4 className="font-bold text-sm text-slate-800">{integ.name}</h4>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-${statusColor(integ.status)}-50 text-${statusColor(integ.status)}-700`}>
                          {integ.category}
                        </span>
                      </div>

                      <div className="space-y-1 mb-3">
                        <div className="flex items-center space-x-2">
                          <span className={`w-2 h-2 rounded-full ${statusDot(integ.status)} ${integ.status === 'connected' ? 'animate-pulse' : ''}`}></span>
                          <span className="text-xs text-slate-500">Status: <span className="font-semibold">{statusLabel(integ.status)}</span></span>
                        </div>
                        <p className="text-xs text-slate-400 flex items-center space-x-1">
                          <ClockIcon className="w-3 h-3" />
                          <span>Last sync: {integ.lastSync}</span>
                        </p>
                        <p className="text-xs text-slate-400 flex items-center space-x-1">
                          <LinkIcon className="w-3 h-3" />
                          <span>Sync: {syncLabel(integ.syncDirection)}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          Objects: <span className="font-semibold text-slate-600">{integ.objects.join(', ')}</span>
                        </p>
                        {integ.error && (
                          <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-amber-50 rounded-lg mt-1">
                            <AlertTriangleIcon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span className="text-[11px] text-amber-700 font-semibold">{integ.error}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center space-x-1.5">
                        {integ.status === 'connected' && (
                          <>
                            {EMAIL_PROVIDERS.has(integ.id) ? (
                              <button
                                onClick={() => openEmailSetup(integ.id)}
                                className="px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-all"
                              >
                                Setup
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConfigure(integ.id)}
                                className="px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-all"
                              >
                                Configure
                              </button>
                            )}
                            <button
                              onClick={() => handleTestIntegration(integ.id)}
                              disabled={testingId === integ.id}
                              className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-all disabled:opacity-50"
                            >
                              {testingId === integ.id ? 'Testing...' : 'Test'}
                            </button>
                            <button
                              onClick={() => handleDisconnect(integ.id)}
                              className="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold hover:bg-rose-100 transition-all"
                            >
                              Disconnect
                            </button>
                          </>
                        )}
                        {integ.status === 'partial' && (
                          <>
                            <button
                              onClick={() => handleReconnect(integ.id)}
                              className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-all"
                            >
                              Fix Issue
                            </button>
                            <button
                              onClick={() => handleReconnect(integ.id)}
                              className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-all"
                            >
                              Reconnect
                            </button>
                          </>
                        )}
                        {integ.status === 'disconnected' && (
                          EMAIL_PROVIDERS.has(integ.id) ? (
                            <button
                              onClick={() => openEmailSetup(integ.id)}
                              className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-all"
                            >
                              Connect
                            </button>
                          ) : (
                            <button
                              onClick={() => openGenericSetup(integ.id)}
                              className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-all"
                            >
                              Connect
                            </button>
                          )
                        )}
                      </div>

                      {/* Test result toast */}
                      {testResult?.id === integ.id && (
                        <div className={`mt-2 flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${
                          testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}>
                          {testResult.success ? <CheckIcon className="w-3.5 h-3.5" /> : <XIcon className="w-3.5 h-3.5" />}
                          <span>{testResult.success ? 'Connection test passed' : 'Connection test failed'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ─── CENTER: Integration Analytics (35%) ─── */}
        <div className="xl:w-[35%] space-y-5">

          {/* Data Flow Overview */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-bold text-slate-800 font-heading flex items-center space-x-2 mb-4">
              <ActivityIcon className="w-4 h-4 text-indigo-600" />
              <span>Data Flow Overview</span>
            </h3>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="flex flex-col items-center space-y-2">
                {/* Row 1: Scaliyo Core */}
                <div className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-md">
                  Scaliyo Core
                </div>
                <div className="flex items-center space-x-1 text-slate-300">
                  <span>↓</span><span>↓</span><span>↓</span><span>↓</span>
                </div>
                {/* Row 2: Connectors */}
                <div className="flex items-center space-x-2">
                  {integrations.filter(i => i.status !== 'disconnected').map(i => (
                    <div key={i.id} className="flex flex-col items-center space-y-1">
                      <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border-2 ${
                        i.status === 'connected' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {i.name}
                      </div>
                      <span className="text-slate-300 text-xs">↓</span>
                      <span className="text-[9px] text-slate-400 font-semibold">{i.objects[0]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sync Statistics */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-bold text-slate-800 font-heading flex items-center space-x-2 mb-4">
              <RefreshIcon className="w-4 h-4 text-emerald-600" />
              <span>Sync Statistics</span>
              <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">Last 24h</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: 'Total Records Synced', value: SYNC_STATS.totalRecords.toLocaleString(), color: 'indigo' },
                { label: 'Sync Success Rate', value: `${SYNC_STATS.successRate}%`, color: 'emerald' },
                { label: 'Avg Sync Time', value: `${SYNC_STATS.avgSyncTime}s`, color: 'violet' },
                { label: 'Failed Syncs', value: `${SYNC_STATS.failedSyncs} (0.2%)`, color: 'rose' },
              ].map(s => (
                <div key={s.label} className="p-3 rounded-xl bg-slate-50">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
                  <p className={`text-lg font-black text-${s.color}-600 mt-0.5`}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Data Volume Chart */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="font-bold text-slate-800 text-sm font-heading mb-3">Data Volume by Integration</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={volumeChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" domain={[0, 50]} unit="%" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" width={100} />
                <Tooltip
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                  formatter={(value: number) => [`${value}%`, 'Volume']}
                />
                <Bar dataKey="volume" radius={[0, 6, 6, 0]} barSize={20}>
                  {volumeChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sync Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowSyncLogs(!showSyncLogs)}
              className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
            >
              <EyeIcon className="w-3.5 h-3.5" />
              <span>{showSyncLogs ? 'Hide' : 'View'} Sync Logs</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
              <ChartIcon className="w-3.5 h-3.5" />
              <span>Performance Report</span>
            </button>
          </div>

          {/* Sync Logs */}
          {showSyncLogs && (
            <div className="bg-slate-900 rounded-2xl p-4 max-h-48 overflow-y-auto">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">Recent Sync Logs</p>
              <div className="font-mono text-[11px] text-slate-400 space-y-0.5">
                {[
                  { time: '14:32:05', msg: 'Salesforce → Scaliyo: 12 contacts synced', ok: true },
                  { time: '14:31:48', msg: 'Scaliyo → HubSpot: Campaign update sent', ok: true },
                  { time: '14:30:22', msg: 'Slack notification sent to #sales-alerts', ok: true },
                  { time: '14:28:15', msg: 'Slack: Channel #leads-archive not found', ok: false },
                  { time: '14:25:40', msg: 'Google Analytics: Traffic data imported', ok: true },
                  { time: '14:22:10', msg: 'Salesforce → Scaliyo: 8 leads synced', ok: true },
                  { time: '14:18:33', msg: 'Scaliyo → Mailchimp: List updated (42 contacts)', ok: true },
                ].map((log, i) => (
                  <p key={i}>
                    <span className="text-slate-600">[{log.time}]</span>{' '}
                    <span className={log.ok ? 'text-emerald-400' : 'text-rose-400'}>
                      {log.ok ? '✓' : '✗'}
                    </span>{' '}
                    <span className="text-slate-300">{log.msg}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: API Management (30%) ─── */}
        <div className="xl:w-[30%] space-y-5">

          {/* API Keys */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 font-heading flex items-center space-x-2">
                <KeyIcon className="w-4 h-4 text-amber-600" />
                <span>API Keys</span>
              </h3>
            </div>
            <div className="divide-y divide-slate-50">
              {apiKeys.map(key => (
                <div key={key.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{key.name}</p>
                      <p className="text-[10px] text-slate-400">Last used: {key.lastUsed}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                      key.permissions === 'readwrite' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-600'
                    }`}>
                      {key.permissions === 'readwrite' ? 'Read/Write' : 'Read Only'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 mb-3">
                    <div className="flex-1 px-3 py-2 bg-slate-50 rounded-lg font-mono text-xs text-slate-600 truncate">
                      {showKeyFull === key.id ? key.fullKey : key.keyPreview}
                    </div>
                    <button
                      onClick={() => setShowKeyFull(showKeyFull === key.id ? null : key.id)}
                      className="p-1.5 bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <EyeIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleCopyKey(key)}
                      className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        copiedKey === key.id
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {copiedKey === key.id ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
                      <span>{copiedKey === key.id ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={() => handleRegenerateKey(key.id)}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-all"
                    >
                      <RefreshIcon className="w-3 h-3" />
                      <span>Regenerate</span>
                    </button>
                    <button className="flex items-center space-x-1 px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-100 transition-all">
                      <LockIcon className="w-3 h-3" />
                      <span>Permissions</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* API Usage */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">API Usage</h3>
            <div className="space-y-2.5">
              {[
                { label: 'Requests Today', value: API_USAGE.requestsToday.toLocaleString(), color: 'indigo' },
                { label: 'Average Latency', value: `${API_USAGE.avgLatency}ms`, color: 'violet' },
                { label: 'Error Rate', value: `${API_USAGE.errorRate}%`, color: 'rose' },
                { label: 'Cost Today', value: `$${API_USAGE.costToday.toFixed(2)}`, color: 'amber' },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50">
                  <span className="text-xs font-semibold text-slate-600">{m.label}</span>
                  <span className={`text-xs font-black text-${m.color}-600`}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rate Limits */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Rate Limits</h3>
            <div className="space-y-2.5 mb-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Per Minute</span>
                <span className="font-bold text-slate-700">{API_USAGE.rateLimits.perMinute} requests</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Per Hour</span>
                <span className="font-bold text-slate-700">{API_USAGE.rateLimits.perHour.toLocaleString()} requests</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Per Day</span>
                <span className="font-bold text-slate-700">{API_USAGE.rateLimits.perDay.toLocaleString()} requests</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Current Usage</span>
                <span className="text-xs font-black text-indigo-600">{API_USAGE.currentUsagePct}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                  style={{ width: `${API_USAGE.currentUsagePct}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* API Actions */}
          <div className="flex items-center space-x-2">
            <button className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
              <GlobeIcon className="w-3.5 h-3.5" />
              <span>API Docs</span>
            </button>
            <button className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
              <BellIcon className="w-3.5 h-3.5" />
              <span>Set Alerts</span>
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* INTEGRATION HEALTH DASHBOARD SIDEBAR                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <AdvancedOnly>
      {showHealthDashboard && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowHealthDashboard(false)} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Integration Health</h3>
                <p className="text-xs text-slate-400 mt-0.5">Real-time uptime and performance monitoring</p>
              </div>
              <button onClick={() => setShowHealthDashboard(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {/* Overall Health */}
              <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-100">
                <p className="text-xs font-black text-emerald-700 uppercase tracking-wider mb-2">System Health</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-2xl font-black text-emerald-900">
                      {integrationHealth.filter(h => h.status === 'healthy').length}/{integrationHealth.length}
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold">Healthy</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-700">
                      {integrationHealth.length > 0 ? (integrationHealth.reduce((s, h) => s + h.uptime, 0) / integrationHealth.length).toFixed(1) : 0}%
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold">Avg Uptime</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-700">
                      {integrationHealth.length > 0 ? Math.round(integrationHealth.reduce((s, h) => s + h.avgLatency, 0) / integrationHealth.length) : 0}ms
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold">Avg Latency</p>
                  </div>
                </div>
              </div>

              {/* Per-Integration Health Cards */}
              {integrationHealth.map((health, i) => {
                const statusStyles = {
                  healthy: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Healthy' },
                  degraded: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Degraded' },
                  down: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Down' },
                }[health.status];
                return (
                  <div key={i} className="p-4 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-bold text-slate-800">{health.name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${statusStyles.bg} ${statusStyles.text}`}>
                        {statusStyles.label}
                      </span>
                    </div>

                    {/* Uptime Bar */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="font-bold text-slate-500">Uptime</span>
                        <span className={`font-black ${health.uptime >= 99 ? 'text-emerald-600' : health.uptime >= 90 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {health.uptime.toFixed(2)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div
                          className={`h-full rounded-full ${health.uptime >= 99 ? 'bg-emerald-500' : health.uptime >= 90 ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${Math.min(health.uptime, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className={`text-xs font-bold ${health.errorRate < 2 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {health.errorRate.toFixed(1)}%
                        </p>
                        <p className="text-[9px] text-slate-400">Error Rate</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-700">{health.avgLatency}ms</p>
                        <p className="text-[9px] text-slate-400">Avg Latency</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-700">{health.lastIncident}</p>
                        <p className="text-[9px] text-slate-400">Last Incident</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* SYNC HISTORY SIDEBAR                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showSyncHistory && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowSyncHistory(false)} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Sync History</h3>
                <p className="text-xs text-slate-400 mt-0.5">Recent data synchronization events</p>
              </div>
              <button onClick={() => setShowSyncHistory(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  { label: 'Total', value: MOCK_SYNC_HISTORY.length, color: 'slate' },
                  { label: 'Success', value: MOCK_SYNC_HISTORY.filter(e => e.status === 'success').length, color: 'emerald' },
                  { label: 'Failed', value: MOCK_SYNC_HISTORY.filter(e => e.status === 'failed').length, color: 'rose' },
                  { label: 'Records', value: MOCK_SYNC_HISTORY.reduce((s, e) => s + e.records, 0).toLocaleString(), color: 'indigo' },
                ].map((s, i) => (
                  <div key={i} className={`p-2.5 bg-${s.color}-50 rounded-xl text-center`}>
                    <p className={`text-lg font-black text-${s.color}-700`}>{s.value}</p>
                    <p className={`text-[9px] font-bold text-${s.color}-500 uppercase`}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Sync Entries */}
              {MOCK_SYNC_HISTORY.map(entry => {
                const style = SYNC_STATUS_STYLES[entry.status];
                const ago = Math.round((Date.now() - new Date(entry.timestamp).getTime()) / 60000);
                const agoText = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
                return (
                  <div key={entry.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 hover:bg-white transition-all">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">{agoText}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{entry.duration}s</span>
                    </div>
                    <p className="text-sm font-bold text-slate-800">{entry.integration}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-slate-500">
                        <span className={`font-semibold ${entry.direction === 'Inbound' ? 'text-blue-600' : 'text-violet-600'}`}>
                          {entry.direction}
                        </span>
                        {' '}&middot; {entry.records.toLocaleString()} records
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* SECURITY & COMPLIANCE PANEL                                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showSecurityPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowSecurityPanel(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Security & Compliance</h3>
                <p className="text-xs text-slate-400 mt-0.5">Data security audit and compliance status</p>
              </div>
              <button onClick={() => setShowSecurityPanel(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Security Score */}
              <div className="flex flex-col items-center p-5 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl border border-indigo-100">
                <div className="relative w-28 h-28">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                    <circle
                      cx="60" cy="60" r="52" fill="none"
                      stroke="#6366f1"
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(SECURITY_CHECKS.filter(c => c.status === 'pass').length / SECURITY_CHECKS.length) * 327} 327`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-black text-indigo-700">
                      {Math.round((SECURITY_CHECKS.filter(c => c.status === 'pass').length / SECURITY_CHECKS.length) * 100)}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">/ 100</span>
                  </div>
                </div>
                <p className="mt-2 text-sm font-black text-indigo-700">Security Score</p>
                <p className="text-[10px] text-indigo-500">
                  {SECURITY_CHECKS.filter(c => c.status === 'pass').length}/{SECURITY_CHECKS.length} checks passed
                </p>
              </div>

              {/* Security Checks */}
              <div className="space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Security Checklist</p>
                {SECURITY_CHECKS.map((check, i) => (
                  <div key={i} className="flex items-center space-x-3 p-3 bg-white rounded-xl border border-slate-100">
                    {check.status === 'pass' ? (
                      <CheckIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangleIcon className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="text-xs font-bold text-slate-700">{check.label}</p>
                      <p className="text-[10px] text-slate-400">{check.detail}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                      check.status === 'pass' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {check.status === 'pass' ? 'Pass' : 'Action Needed'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Compliance Badges */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Compliance Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: 'SOC 2 Type II', status: 'Compliant' },
                    { name: 'GDPR', status: 'Compliant' },
                    { name: 'CCPA', status: 'Compliant' },
                    { name: 'HIPAA', status: 'N/A' },
                  ].map((badge, i) => (
                    <div key={i} className="flex items-center space-x-2 p-2.5 bg-white rounded-lg border border-slate-100">
                      <ShieldIcon className={`w-3.5 h-3.5 ${badge.status === 'Compliant' ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <div>
                        <p className="text-[10px] font-bold text-slate-700">{badge.name}</p>
                        <p className={`text-[9px] font-bold ${badge.status === 'Compliant' ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {badge.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              {SECURITY_CHECKS.some(c => c.status === 'warn') && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                  <div className="flex items-center space-x-2 mb-2">
                    <SparklesIcon className="w-4 h-4 text-amber-600" />
                    <p className="text-xs font-black text-amber-700 uppercase tracking-wider">Recommendations</p>
                  </div>
                  <div className="space-y-1.5">
                    {SECURITY_CHECKS.filter(c => c.status === 'warn').map((c, i) => (
                      <div key={i} className="flex items-start space-x-2">
                        <ArrowRightIcon className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-700">
                          {c.label}: {c.detail}. Configure this for enhanced security.
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DATA PIPELINE ANALYTICS SIDEBAR                                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showPipelineAnalytics && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowPipelineAnalytics(false)} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Data Pipeline Analytics</h3>
                <p className="text-xs text-slate-400 mt-0.5">Throughput, latency &amp; flow metrics</p>
              </div>
              <button onClick={() => setShowPipelineAnalytics(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Pipeline Gauge */}
              <div className="flex justify-center">
                <div className="relative">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#06b6d4" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(pipelineAnalytics.totalThroughput / (pipelineAnalytics.totalThroughput + 500)) * 251} 251`} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-cyan-700">{pipelineAnalytics.totalThroughput}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">rec/hr</span>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-cyan-50 rounded-xl text-center">
                  <p className="text-lg font-black text-cyan-700">{pipelineAnalytics.totalThroughput}</p>
                  <p className="text-[9px] font-bold text-cyan-500 uppercase">Total rec/hr</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl text-center">
                  <p className="text-lg font-black text-slate-700">{pipelineAnalytics.avgLatency}ms</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Avg Latency</p>
                </div>
                <div className="p-3 bg-rose-50 rounded-xl text-center">
                  <p className="text-lg font-black text-rose-700">{pipelineAnalytics.bottleneck.name}</p>
                  <p className="text-[9px] font-bold text-rose-400 uppercase">Bottleneck</p>
                </div>
              </div>

              {/* Per-Integration Throughput */}
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Throughput by Integration</p>
                <div className="space-y-2">
                  {pipelineAnalytics.throughput.map((t, i) => (
                    <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-slate-800">{t.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                          t.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : t.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}>{t.status}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-xs font-bold text-cyan-600">{t.recordsPerHour}</p>
                          <p className="text-[9px] text-slate-400">rec/hr</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-600">{t.avgLatency}ms</p>
                          <p className="text-[9px] text-slate-400">Latency</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-violet-600">{t.peakLoad}%</p>
                          <p className="text-[9px] text-slate-400">Peak Load</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-amber-600">{t.queueDepth}</p>
                          <p className="text-[9px] text-slate-400">Queue</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hourly Flow Chart */}
              <div className="bg-slate-900 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider">24h Data Flow</p>
                  <span className="text-[10px] text-cyan-400 font-bold">Peak: {pipelineAnalytics.peakHour.label}</span>
                </div>
                <div className="flex items-end space-x-1 h-28">
                  {pipelineAnalytics.hourlyFlow.map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center space-y-0.5">
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-cyan-600 to-cyan-400 transition-all"
                        style={{ height: `${(h.inbound / 300) * 100}%`, minHeight: '2px' }}
                      />
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-violet-600 to-violet-400 transition-all"
                        style={{ height: `${(h.outbound / 300) * 80}%`, minHeight: '2px' }}
                      />
                      {i % 6 === 0 && (
                        <span className="text-[8px] text-slate-500 mt-0.5">{h.label}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center space-x-4 mt-2">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span className="text-[9px] text-slate-500">Inbound</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-violet-400" />
                    <span className="text-[9px] text-slate-500">Outbound</span>
                  </div>
                </div>
              </div>

              {/* AI Insight */}
              <div className="bg-gradient-to-r from-cyan-600 to-teal-600 rounded-2xl p-4 text-white">
                <div className="flex items-center space-x-2 mb-2">
                  <SparklesIcon className="w-4 h-4" />
                  <p className="text-xs font-black uppercase tracking-wider">Pipeline Insight</p>
                </div>
                <p className="text-sm leading-relaxed opacity-90">
                  {pipelineAnalytics.bottleneck.name} is your slowest connector at {pipelineAnalytics.bottleneck.avgLatency}ms.
                  Consider batching requests during off-peak hours ({pipelineAnalytics.peakHour.label} is peak)
                  to reduce latency by ~30%.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ERROR DIAGNOSTICS SIDEBAR                                     */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showErrorDiagnostics && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowErrorDiagnostics(false)} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Error Diagnostics</h3>
                <p className="text-xs text-slate-400 mt-0.5">Error patterns, root causes &amp; resolution</p>
              </div>
              <button onClick={() => setShowErrorDiagnostics(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Error Gauge */}
              <div className="flex justify-center">
                <div className="relative">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#f43f5e" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(errorDiagnostics.retrySuccessRate / 100) * 251} 251`} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-rose-700">{errorDiagnostics.retrySuccessRate}%</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Retry Rate</span>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 bg-rose-50 rounded-xl text-center">
                  <p className="text-lg font-black text-rose-700">{errorDiagnostics.totalErrors}</p>
                  <p className="text-[9px] font-bold text-rose-400 uppercase">Total</p>
                </div>
                <div className="p-2.5 bg-amber-50 rounded-xl text-center">
                  <p className="text-lg font-black text-amber-700">{errorDiagnostics.criticalCount}</p>
                  <p className="text-[9px] font-bold text-amber-400 uppercase">Critical</p>
                </div>
                <div className="p-2.5 bg-emerald-50 rounded-xl text-center">
                  <p className="text-lg font-black text-emerald-700">{errorDiagnostics.retrySuccessRate}%</p>
                  <p className="text-[9px] font-bold text-emerald-400 uppercase">Retry</p>
                </div>
                <div className="p-2.5 bg-indigo-50 rounded-xl text-center">
                  <p className="text-lg font-black text-indigo-700">{errorDiagnostics.mttr}m</p>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase">MTTR</p>
                </div>
              </div>

              {/* Error Categories */}
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Error Breakdown</p>
                <div className="space-y-2">
                  {errorDiagnostics.errorCategories.map((err, i) => {
                    const sevStyles = {
                      low: { bg: 'bg-blue-50', text: 'text-blue-700' },
                      medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
                      high: { bg: 'bg-rose-50', text: 'text-rose-700' },
                    }[err.severity];
                    return (
                      <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-bold text-slate-800">{err.type}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${sevStyles.bg} ${sevStyles.text}`}>
                              {err.severity}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="text-xs font-black text-slate-700">{err.count}</span>
                            {err.trend < 0 ? (
                              <TrendDownIcon className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <TrendUpIcon className="w-3 h-3 text-rose-500" />
                            )}
                            <span className={`text-[10px] font-bold ${err.trend < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {err.trend > 0 ? '+' : ''}{err.trend}%
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mb-1">Last seen: {err.lastSeen}</p>
                        <p className="text-[10px] text-indigo-600 font-semibold flex items-center space-x-1">
                          <BrainIcon className="w-3 h-3" />
                          <span>{err.resolution}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Weekly Error Trend Chart */}
              <div className="bg-slate-900 rounded-xl p-5">
                <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3">7-Day Error Trend</p>
                <div className="flex items-end space-x-2 h-24">
                  {errorDiagnostics.weeklyTrend.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div className="w-full flex flex-col items-center space-y-0.5">
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-rose-600 to-rose-400"
                          style={{ height: `${(d.errors / 15) * 80}px`, minHeight: '3px' }}
                        />
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400"
                          style={{ height: `${(d.resolved / 15) * 80}px`, minHeight: '3px' }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-500 mt-1">{d.day}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center space-x-4 mt-2">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="text-[9px] text-slate-500">Errors</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-[9px] text-slate-500">Resolved</span>
                  </div>
                </div>
              </div>

              {/* AI Insight */}
              <div className="bg-gradient-to-r from-rose-600 to-pink-600 rounded-2xl p-4 text-white">
                <div className="flex items-center space-x-2 mb-2">
                  <SparklesIcon className="w-4 h-4" />
                  <p className="text-xs font-black uppercase tracking-wider">Error Insight</p>
                </div>
                <p className="text-sm leading-relaxed opacity-90">
                  Rate limiting accounts for {Math.round((errorDiagnostics.errorCategories.find(e => e.type === 'Rate Limiting')?.count || 0) / errorDiagnostics.totalErrors * 100)}%
                  of errors. Implementing exponential backoff with jitter could reduce these by ~85%.
                  Your MTTR of {errorDiagnostics.mttr}m is well below the 15m industry benchmark.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* COST OPTIMIZATION SIDEBAR                                     */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showCostOptimization && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowCostOptimization(false)} />
          <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-slate-900 font-heading">Cost Optimization</h3>
                <p className="text-xs text-slate-400 mt-0.5">API costs, savings &amp; optimization opportunities</p>
              </div>
              <button onClick={() => setShowCostOptimization(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Cost Gauge */}
              <div className="flex justify-center">
                <div className="relative">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(costOptimization.savingsPct / 100) * 251} 251`} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-black text-amber-700">{costOptimization.savingsPct}%</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Savings</span>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-slate-50 rounded-xl text-center">
                  <p className="text-lg font-black text-slate-700">${costOptimization.totalMonthlyCost}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Monthly Cost</p>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl text-center">
                  <p className="text-lg font-black text-emerald-700">${costOptimization.potentialSavings}</p>
                  <p className="text-[9px] font-bold text-emerald-400 uppercase">Can Save</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl text-center">
                  <p className="text-lg font-black text-amber-700">{costOptimization.savingsPct}%</p>
                  <p className="text-[9px] font-bold text-amber-400 uppercase">Reduction</p>
                </div>
              </div>

              {/* Per-Integration Costs */}
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Cost by Integration</p>
                <div className="space-y-2">
                  {costOptimization.perIntegration.map((p, i) => (
                    <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-slate-800">{p.name}</h4>
                        <span className="text-sm font-black text-slate-700">${p.monthlyCost}/mo</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mb-2">
                        <div>
                          <p className="text-xs font-bold text-indigo-600">{p.callsPerDay.toLocaleString()}</p>
                          <p className="text-[9px] text-slate-400">Calls/day</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-600">${p.costPerRecord}</p>
                          <p className="text-[9px] text-slate-400">Per record</p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-emerald-600">{p.optimizable}%</p>
                          <p className="text-[9px] text-slate-400">Optimizable</p>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
                          style={{ width: `${p.optimizable}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Cost Trend */}
              <div className="bg-slate-900 rounded-xl p-5">
                <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-3">6-Month Cost Trend</p>
                <div className="flex items-end space-x-3 h-24">
                  {costOptimization.monthlyTrend.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div className="w-full flex space-x-0.5 items-end" style={{ height: '80px' }}>
                        <div
                          className="flex-1 rounded-t bg-gradient-to-t from-amber-600 to-amber-400"
                          style={{ height: `${(m.actual / 150) * 100}%`, minHeight: '3px' }}
                        />
                        <div
                          className="flex-1 rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400"
                          style={{ height: `${(m.optimized / 150) * 100}%`, minHeight: '3px' }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-500 mt-1">{m.month}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center space-x-4 mt-2">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-[9px] text-slate-500">Actual</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-[9px] text-slate-500">Optimized</span>
                  </div>
                </div>
              </div>

              {/* Optimization Recommendations */}
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Recommendations</p>
                <div className="space-y-2">
                  {costOptimization.recommendations.map((rec, i) => {
                    const impactStyles = {
                      high: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
                      medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
                      low: { bg: 'bg-slate-50', text: 'text-slate-600' },
                    }[rec.impact];
                    return (
                      <div key={i} className="flex items-center space-x-3 p-3 bg-white rounded-xl border border-slate-200">
                        <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 ${impactStyles.bg} ${impactStyles.text}`}>
                          {rec.impact}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-700 truncate">{rec.action}</p>
                        </div>
                        <span className="text-xs font-black text-emerald-600 shrink-0">{rec.savings}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI Insight */}
              <div className="bg-gradient-to-r from-amber-600 to-orange-600 rounded-2xl p-4 text-white">
                <div className="flex items-center space-x-2 mb-2">
                  <SparklesIcon className="w-4 h-4" />
                  <p className="text-xs font-black uppercase tracking-wider">Cost Insight</p>
                </div>
                <p className="text-sm leading-relaxed opacity-90">
                  You could save ${costOptimization.potentialSavings}/mo ({costOptimization.savingsPct}%) by implementing
                  the top recommendations. Switching HubSpot from polling to webhooks alone
                  would save $15/mo and reduce API calls by 60%.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* CONFIGURE INTEGRATION SIDEBAR                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {configureId && (() => {
        const integ = integrations.find(i => i.id === configureId);
        if (!integ) return null;
        const allObjectOptions: Record<string, string[]> = {
          crm: ['Leads', 'Contacts', 'Accounts', 'Opportunities', 'Tasks', 'Notes'],
          marketing: ['Campaigns', 'Contacts', 'Lists', 'Templates', 'Segments', 'Forms'],
          comms: ['#sales-alerts', '#leads', '#marketing', '#general', '#support'],
          analytics: ['Website traffic', 'Conversions', 'Events', 'Audiences', 'Goals'],
        };
        const objectOptions = allObjectOptions[integ.category] || ['Data objects'];
        return (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setConfigureId(null)} />
            <div className="relative w-full max-w-md bg-white shadow-2xl border-l border-slate-200 overflow-y-auto animate-slide-in-right">
              <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg" style={{ backgroundColor: integ.color + '20' }}>
                    {integ.icon}
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900">Configure {integ.name}</h2>
                    <p className="text-[10px] text-slate-400">Sync settings & data objects</p>
                  </div>
                </div>
                <button onClick={() => setConfigureId(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><XIcon className="w-4 h-4" /></button>
              </div>

              <div className="p-6 space-y-6">
                {/* Status Badge */}
                <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex items-center space-x-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-700">Connected</span>
                  </div>
                  <span className="text-[10px] text-emerald-600">Last sync: {integ.lastSync}</span>
                </div>

                {/* Sync Direction */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">Sync Direction</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['bidirectional', 'inbound', 'outbound'] as SyncDirection[]).map(dir => (
                      <button
                        key={dir}
                        onClick={() => setConfigForm(f => ({ ...f, syncDirection: dir }))}
                        className={`p-3 rounded-xl text-center text-xs font-bold transition-all border ${
                          configForm.syncDirection === dir
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        <div className="text-base mb-1">
                          {dir === 'bidirectional' ? '↔️' : dir === 'inbound' ? '⬇️' : '⬆️'}
                        </div>
                        <span className="capitalize">{dir}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sync Interval */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">Sync Interval</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['1', '5', '15', '30'].map(mins => (
                      <button
                        key={mins}
                        onClick={() => setConfigForm(f => ({ ...f, syncInterval: mins }))}
                        className={`p-2.5 rounded-xl text-xs font-bold transition-all border ${
                          configForm.syncInterval === mins
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {mins} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Data Objects */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                    Synced Objects ({configForm.objects.length} selected)
                  </label>
                  <div className="space-y-2">
                    {objectOptions.map(obj => {
                      const selected = configForm.objects.includes(obj);
                      return (
                        <label key={obj} className="flex items-center space-x-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              setConfigForm(f => ({
                                ...f,
                                objects: selected ? f.objects.filter(o => o !== obj) : [...f.objects, obj],
                              }));
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className={`text-xs font-bold ${selected ? 'text-slate-900' : 'text-slate-500'}`}>{obj}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Data Volume */}
                <div className="p-4 bg-slate-900 rounded-xl">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-wider mb-3">Data Volume</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-lg font-black text-white">{integ.dataVolume}%</p>
                      <p className="text-[10px] text-slate-400">Of total volume</p>
                    </div>
                    <div>
                      <p className="text-lg font-black text-white">{configForm.objects.length}</p>
                      <p className="text-[10px] text-slate-400">Objects syncing</p>
                    </div>
                  </div>
                </div>

                {/* Save / Cancel */}
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleSaveConfig}
                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                  >
                    Save Configuration
                  </button>
                  <button
                    onClick={() => setConfigureId(null)}
                    className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* KEYBOARD SHORTCUTS MODAL                                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center space-x-2">
                <KeyboardIcon className="w-5 h-5 text-indigo-600" />
                <h3 className="font-black text-slate-900 font-heading">Keyboard Shortcuts</h3>
              </div>
              <button onClick={() => setShowShortcuts(false)} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Actions</h4>
                <div className="space-y-2">
                  {[
                    { key: 'N', label: 'Add integration' },
                    { key: 'L', label: 'Sync logs' },
                    { key: 'E', label: 'Export config' },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className="text-sm text-slate-600">{s.label}</span>
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-500">{s.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Panels</h4>
                <div className="space-y-2">
                  {[
                    { key: 'H', label: 'Health dashboard' },
                    { key: 'S', label: 'Sync history' },
                    { key: 'C', label: 'Security' },
                    { key: 'P', label: 'Pipeline analytics' },
                    { key: 'D', label: 'Error diagnostics' },
                    { key: 'O', label: 'Cost optimization' },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className="text-sm text-slate-600">{s.label}</span>
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-500">{s.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">System</h4>
                <div className="space-y-2">
                  {[
                    { key: '?', label: 'Shortcuts' },
                    { key: 'Esc', label: 'Close all panels' },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className="text-sm text-slate-600">{s.label}</span>
                      <kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-500">{s.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </AdvancedOnly>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* EMAIL PROVIDER SETUP MODAL                                    */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {emailSetupId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-xl">
                  {emailSetupId === 'sendgrid' ? '📧' : emailSetupId === 'gmail' ? '✉️' : emailSetupId === 'mailchimp' ? '🐵' : '📮'}
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 font-heading">
                    {emailSetupId === 'sendgrid' ? 'SendGrid' : emailSetupId === 'gmail' ? 'Gmail SMTP' : emailSetupId === 'mailchimp' ? 'Mailchimp' : 'Custom SMTP'} Setup
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Enter your credentials to connect</p>
                </div>
              </div>
              <button
                onClick={() => setEmailSetupId(null)}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <XIcon className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* API Key field (SendGrid / Mailchimp) */}
              {!isSmtpProvider(emailSetupId) && (
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={emailSetupApiKey}
                    onChange={e => setEmailSetupApiKey(e.target.value)}
                    placeholder={emailSetupId === 'sendgrid' ? 'SG.xxxxxxxx...' : 'Your Mailchimp API key'}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    {emailSetupId === 'sendgrid'
                      ? 'Find your API key at Settings > API Keys in the SendGrid dashboard.'
                      : 'Find your API key at Account > Extras > API Keys in Mailchimp.'}
                  </p>
                </div>
              )}

              {/* SMTP fields (Gmail / Custom SMTP) */}
              {isSmtpProvider(emailSetupId) && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        SMTP Host
                      </label>
                      <input
                        type="text"
                        value={emailSetupSmtpHost}
                        onChange={e => setEmailSetupSmtpHost(e.target.value)}
                        placeholder="smtp.gmail.com"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Port
                      </label>
                      <input
                        type="text"
                        value={emailSetupSmtpPort}
                        onChange={e => setEmailSetupSmtpPort(e.target.value)}
                        placeholder="587"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Username / Email
                    </label>
                    <input
                      type="text"
                      value={emailSetupSmtpUser}
                      onChange={e => setEmailSetupSmtpUser(e.target.value)}
                      placeholder={emailSetupId === 'gmail' ? 'you@gmail.com' : 'user@example.com'}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Password {emailSetupId === 'gmail' && <span className="normal-case text-indigo-500">(App Password)</span>}
                    </label>
                    <input
                      type="password"
                      value={emailSetupSmtpPass}
                      onChange={e => setEmailSetupSmtpPass(e.target.value)}
                      placeholder={emailSetupId === 'gmail' ? '16-character app password' : 'SMTP password'}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                    {emailSetupId === 'gmail' && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        Go to Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App Passwords to generate one.
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* From Email / Name (all providers) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    From Email
                  </label>
                  <input
                    type="email"
                    value={emailSetupFromEmail}
                    onChange={e => setEmailSetupFromEmail(e.target.value)}
                    placeholder="noreply@yourcompany.com"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    From Name
                  </label>
                  <input
                    type="text"
                    value={emailSetupFromName}
                    onChange={e => setEmailSetupFromName(e.target.value)}
                    placeholder="Your Company"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>

              {/* Test result */}
              {emailSetupResult && (
                <div className={`flex items-start space-x-2 px-4 py-3 rounded-xl text-xs font-bold ${
                  emailSetupResult === 'sent'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : emailSetupResult === 'error'
                      ? 'bg-rose-50 text-rose-700 border border-rose-100'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                }`}>
                  {emailSetupResult === 'error' ? <XIcon className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckIcon className="w-4 h-4 mt-0.5 shrink-0" />}
                  <span>
                    {emailSetupResult === 'sent'
                      ? `Test email sent to ${emailSetupFromEmail}! Check your inbox.`
                      : emailSetupTestError || 'An error occurred.'}
                  </span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end space-x-2">
              <button
                onClick={() => setEmailSetupId(null)}
                className="px-4 py-2.5 text-slate-500 text-xs font-bold hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEmailSetupTest}
                disabled={emailSetupTesting}
                className="flex items-center space-x-2 px-4 py-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
              >
                {emailSetupTesting ? (
                  <>
                    <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <PlayIcon className="w-3.5 h-3.5" />
                    <span>Test Connection</span>
                  </>
                )}
              </button>
              <button
                onClick={handleEmailSetupActivate}
                disabled={emailSetupSaving || emailSetupResult !== 'sent'}
                title={emailSetupResult !== 'sent' ? 'Send a successful test email first' : ''}
                className="flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
              >
                {emailSetupSaving ? (
                  <>
                    <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-3.5 h-3.5" />
                    <span>Save &amp; Activate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* GENERIC INTEGRATION SETUP MODAL                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {genericSetupId && (() => {
        const integ = integrations.find(i => i.id === genericSetupId);
        if (!integ) return null;
        const instructions: Record<string, string> = {
          salesforce: 'Enter your Salesforce instance URL and access token from Setup > Apps > Connected Apps.',
          hubspot: 'Create a Private App in HubSpot Settings > Integrations > Private Apps and copy the access token.',
          slack: 'Create an Incoming Webhook at api.slack.com/apps > Incoming Webhooks and paste the URL.',
          ga: 'Find your Measurement ID (G-XXXXX) and create an API Secret in GA4 Admin > Data Streams > Measurement Protocol.',
          stripe: 'Enter your Stripe Secret Key from Dashboard > Developers > API Keys. Use sk_test_ for testing or sk_live_ for production.',
        };
        const hasRequiredFields = (() => {
          switch (genericSetupId) {
            case 'slack': return genericSetupWebhookUrl.trim().length > 0;
            case 'hubspot': return genericSetupApiKey.trim().length > 0;
            case 'salesforce': return genericSetupInstanceUrl.trim().length > 0 && genericSetupAccessToken.trim().length > 0;
            case 'ga': return genericSetupMeasurementId.trim().length > 0 && genericSetupApiSecret.trim().length > 0;
            case 'stripe': return genericSetupApiKey.trim().startsWith('sk_');
            default: return genericSetupApiKey.trim().length > 0;
          }
        })();
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: integ.color + '20' }}>
                    {integ.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 font-heading">
                      Connect {integ.name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Enter your credentials to connect</p>
                  </div>
                </div>
                <button
                  onClick={() => setGenericSetupId(null)}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <XIcon className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {/* Provider-specific fields */}
                {genericSetupId === 'slack' && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Webhook URL
                    </label>
                    <input
                      type="url"
                      value={genericSetupWebhookUrl}
                      onChange={e => setGenericSetupWebhookUrl(e.target.value)}
                      placeholder="https://hooks.slack.com/services/T.../B.../xxx"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{instructions.slack}</p>
                  </div>
                )}

                {genericSetupId === 'hubspot' && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Private App Token
                    </label>
                    <input
                      type="password"
                      value={genericSetupApiKey}
                      onChange={e => setGenericSetupApiKey(e.target.value)}
                      placeholder="pat-xx-xxxxxxxx-xxxx-xxxx"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{instructions.hubspot}</p>
                  </div>
                )}

                {genericSetupId === 'salesforce' && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Instance URL
                      </label>
                      <input
                        type="url"
                        value={genericSetupInstanceUrl}
                        onChange={e => setGenericSetupInstanceUrl(e.target.value)}
                        placeholder="https://yourorg.my.salesforce.com"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Access Token
                      </label>
                      <input
                        type="password"
                        value={genericSetupAccessToken}
                        onChange={e => setGenericSetupAccessToken(e.target.value)}
                        placeholder="00D..."
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">{instructions.salesforce}</p>
                  </>
                )}

                {genericSetupId === 'ga' && (
                  <>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        Measurement ID
                      </label>
                      <input
                        type="text"
                        value={genericSetupMeasurementId}
                        onChange={e => setGenericSetupMeasurementId(e.target.value)}
                        placeholder="G-XXXXXXXXXX"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                        API Secret
                      </label>
                      <input
                        type="password"
                        value={genericSetupApiSecret}
                        onChange={e => setGenericSetupApiSecret(e.target.value)}
                        placeholder="Enter your API secret"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">{instructions.ga}</p>
                  </>
                )}

                {genericSetupId === 'stripe' && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Secret Key
                    </label>
                    <input
                      type="password"
                      value={genericSetupApiKey}
                      onChange={e => setGenericSetupApiKey(e.target.value)}
                      placeholder="sk_test_... or sk_live_..."
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{instructions.stripe}</p>
                    <p className="text-[10px] text-slate-400 mt-1 flex items-center space-x-1">
                      <LockIcon className="w-3 h-3" />
                      <span>Your key is stored securely and only used for invoice processing.</span>
                    </p>
                  </div>
                )}

                {/* Fallback: generic API key for unknown providers */}
                {!['slack', 'hubspot', 'salesforce', 'ga', 'stripe'].includes(genericSetupId) && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={genericSetupApiKey}
                      onChange={e => setGenericSetupApiKey(e.target.value)}
                      placeholder={`Enter your ${integ.name} API key`}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      {instructions[genericSetupId] || `Enter your ${integ.name} API key to enable the integration.`}
                    </p>
                  </div>
                )}

                {/* Test result */}
                {genericSetupResult && (
                  <div className={`flex items-start space-x-2 px-4 py-3 rounded-xl text-xs font-bold ${
                    genericSetupResult === 'success'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      : 'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}>
                    {genericSetupResult === 'success' ? <CheckIcon className="w-4 h-4 mt-0.5 shrink-0" /> : <XIcon className="w-4 h-4 mt-0.5 shrink-0" />}
                    <span>
                      {genericSetupResult === 'success'
                        ? 'Connection test passed! Click "Save & Connect" to finish.'
                        : genericSetupError || 'Validation failed. Please check your credentials.'}
                    </span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={handleGenericSetupTest}
                  disabled={genericSetupTesting || genericSetupSaving}
                  className="flex items-center space-x-2 px-4 py-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all disabled:opacity-50"
                >
                  {genericSetupTesting ? (
                    <>
                      <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <PlayIcon className="w-3.5 h-3.5" />
                      <span>Test Connection</span>
                    </>
                  )}
                </button>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setGenericSetupId(null)}
                    className="px-4 py-2.5 text-slate-500 text-xs font-bold hover:text-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenericSetupSave}
                    disabled={genericSetupSaving || !hasRequiredFields}
                    className="flex items-center space-x-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                  >
                    {genericSetupSaving ? (
                      <>
                        <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <CheckIcon className="w-3.5 h-3.5" />
                        <span>Save &amp; Connect</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default IntegrationHub;

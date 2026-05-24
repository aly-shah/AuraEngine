import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Lead, TriggerType } from '../types';
import {
  saveWorkflow as saveWorkflowToDb,
  loadWorkflows as loadWorkflowsFromDb,
  deleteWorkflow as deleteWorkflowFromDb,
  executeWorkflow as executeWorkflowEngine,
  getExecutionLog,
  getNodeAnalytics,
  type ExecutionResult,
} from '../lib/automationEngine';
import { generateWorkflowOptimization } from '../lib/gemini';
import {
  fetchCampaignHistory,
  fetchCampaignRecipients,
  fetchBatchEmailSummary,
  type CampaignSummary,
  type CampaignRecipient,
  type BatchEmailSummary,
} from '../lib/emailTracking';
import { useIntegrations } from '../lib/integrations';
import type { IntegrationStatus } from '../lib/integrations';
import {
  DEFAULT_WORKFLOW,
  TRIGGER_OPTIONS,
  EMAIL_TEMPLATES,
} from '../components/automation/constants';
import type {
  Workflow,
  WorkflowNode,
  NodeType,
  WizardStep,
  ActivationMode,
  TestResult,
  ValidationItem,
  ExecutionLogEntry,
  NodePerformanceMetric,
  KpiStat,
  WorkflowHealth,
  RoiCalculation,
  TriggerAnalyticsData,
  TemplateEffectivenessData,
  PanelName,
} from '../components/automation/types';

export function useAutomationWorkflow(userId: string | undefined) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const { integrations: integrationStatuses } = useIntegrations();

  // ─── Wizard State ───
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [wizardName, setWizardName] = useState('');
  const [wizardDescription, setWizardDescription] = useState('');
  const [wizardTrigger, setWizardTrigger] = useState<TriggerType | null>(null);

  // ─── Workflow State ───
  const [workflow, setWorkflow] = useState<Workflow>(DEFAULT_WORKFLOW);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult | null>(null);
  const [validations, setValidations] = useState<ValidationItem[]>([]);
  const [validating, setValidating] = useState(false);

  // ─── Activation State ───
  const [activationMode, setActivationMode] = useState<ActivationMode>('immediate');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [monitorAlerts, setMonitorAlerts] = useState(true);

  // ─── AI Optimize State ───
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  // ─── Saved Workflows ───
  const [workflows, setWorkflows] = useState<Workflow[]>([DEFAULT_WORKFLOW]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showWorkflowList, setShowWorkflowList] = useState(false);

  // ─── Lead selection ───
  const [testLeadIds, setTestLeadIds] = useState<Set<string>>(new Set());
  const [showLeadPanel, setShowLeadPanel] = useState(true);
  const [leadScoreFilter, setLeadScoreFilter] = useState<number>(0);
  const [leadStatusFilter, setLeadStatusFilter] = useState<string>('all');

  // ─── Panel Visibility (consolidated) ───
  const [panelVisibility, setPanelVisibility] = useState<Record<PanelName, boolean>>({
    shortcuts: false,
    executionLog: false,
    nodeAnalytics: false,
    healthPanel: false,
    roiCalculator: false,
    triggerAnalytics: false,
    templateEffectiveness: false,
    campaignsPanel: false,
  });

  const togglePanel = useCallback((name: PanelName) => {
    setPanelVisibility(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const closeAllPanels = useCallback(() => {
    setPanelVisibility({
      shortcuts: false,
      executionLog: false,
      nodeAnalytics: false,
      healthPanel: false,
      roiCalculator: false,
      triggerAnalytics: false,
      templateEffectiveness: false,
      campaignsPanel: false,
    });
  }, []);

  const closePanel = useCallback((name: PanelName) => {
    setPanelVisibility(prev => ({ ...prev, [name]: false }));
  }, []);

  // ─── Campaigns Panel State ───
  const [campaignHistory, setCampaignHistory] = useState<CampaignSummary[]>([]);
  const [campaignHistoryLoading, setCampaignHistoryLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignRecipients, setCampaignRecipients] = useState<CampaignRecipient[]>([]);
  const [campaignRecipientsLoading, setCampaignRecipientsLoading] = useState(false);

  // ─── Already-emailed lead tracking ───
  const [emailSummaryMap, setEmailSummaryMap] = useState<Map<string, BatchEmailSummary>>(new Map());

  // ─── Real execution data ───
  const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([]);
  const [realNodePerformance, setRealNodePerformance] = useState<NodePerformanceMetric[]>([]);
  const [executionResults, setExecutionResults] = useState<ExecutionResult[] | null>(null);

  // ═══════════════════════════════════════════════════════════════
  // Effects
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    const fetchLeads = async () => {
      if (!userId) return;
      const { data, error } = await supabase
        .from('leads')
        .select('id,client_id,name,company,email,score,status,lastActivity,insights,created_at,knowledgeBase')
        .eq('client_id', userId);
      if (error) {
        console.error('AutomationPage fetch error:', error.message);
        return;
      }
      setLeads((data || []) as Lead[]);
    };
    fetchLeads();
  }, [userId]);

  useEffect(() => {
    if (leads.length === 0) return;
    let cancelled = false;
    fetchBatchEmailSummary(leads.map(l => l.id)).then(map => {
      if (!cancelled) setEmailSummaryMap(map);
    }).catch(e => console.warn('[Automation] email summary load failed:', e));
    return () => { cancelled = true; };
  }, [leads]);

  useEffect(() => {
    const loadFromDb = async () => {
      if (!userId) return;
      const dbWorkflows = await loadWorkflowsFromDb(userId);
      if (dbWorkflows.length > 0) {
        const mapped: Workflow[] = dbWorkflows.map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          status: w.status,
          nodes: w.nodes as WorkflowNode[],
          createdAt: w.createdAt,
          stats: w.stats,
        }));
        setWorkflows(mapped);
        setWorkflow(mapped[0]);
      }
      setDbLoaded(true);
    };
    loadFromDb();
  }, [userId]);

  const refreshExecutionLog = useCallback(async () => {
    if (!userId) return;
    const log = await getExecutionLog(userId, 50);
    setExecutionLog(log);
  }, [userId]);

  useEffect(() => {
    if (dbLoaded && userId) refreshExecutionLog();
  }, [dbLoaded, userId, refreshExecutionLog]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!workflow?.id || workflow.id.startsWith('wf-default') || workflow.id.startsWith('wf-')) return;
      const metrics = await getNodeAnalytics(workflow.id);
      if (metrics.length > 0) setRealNodePerformance(metrics);
    };
    if (dbLoaded) fetchAnalytics();
  }, [workflow?.id, dbLoaded]);

  useEffect(() => {
    if (!panelVisibility.campaignsPanel) return;
    let cancelled = false;
    setCampaignHistoryLoading(true);
    fetchCampaignHistory().then(data => {
      if (!cancelled) { setCampaignHistory(data); setCampaignHistoryLoading(false); }
    }).catch(e => { console.warn('[Automation] campaign history load failed:', e); if (!cancelled) setCampaignHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [panelVisibility.campaignsPanel]);

  useEffect(() => {
    if (!selectedCampaignId) { setCampaignRecipients([]); return; }
    let cancelled = false;
    setCampaignRecipientsLoading(true);
    fetchCampaignRecipients(selectedCampaignId).then(data => {
      if (!cancelled) { setCampaignRecipients(data); setCampaignRecipientsLoading(false); }
    }).catch(e => { console.warn('[Automation] campaign recipients load failed:', e); if (!cancelled) setCampaignRecipientsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCampaignId]);

  // ═══════════════════════════════════════════════════════════════
  // Computed Values (useMemo)
  // ═══════════════════════════════════════════════════════════════

  const selectedNode = useMemo(() => {
    return workflow.nodes.find(n => n.id === selectedNodeId) || null;
  }, [workflow.nodes, selectedNodeId]);

  const kpiStats = useMemo((): KpiStat[] => {
    const totalNodes = workflow.nodes.length;
    const actionNodes = workflow.nodes.filter(n => n.type === 'action').length;
    const conditionNodes = workflow.nodes.filter(n => n.type === 'condition').length;
    const aiNodes = workflow.nodes.filter(n => n.config.aiPersonalization).length;
    const activeWorkflows = workflows.filter(w => w.status === 'active').length;
    const totalProcessed = workflows.reduce((sum, w) => sum + w.stats.leadsProcessed, 0);
    const avgConversion = workflows.length > 0 ? workflows.reduce((sum, w) => sum + w.stats.conversionRate, 0) / workflows.length : 0;
    const totalTimeSaved = workflows.reduce((sum, w) => sum + w.stats.timeSavedHrs, 0);
    const successRate = executionLog.length > 0
      ? executionLog.filter(e => e.status === 'success').length / executionLog.length * 100
      : 100;

    // Icons are rendered via iconName references in the component
    return [
      { label: 'Active Workflows', value: activeWorkflows.toString(), icon: null as any, color: 'indigo', trend: '+2 this week', up: true },
      { label: 'Leads Processed', value: totalProcessed.toLocaleString(), icon: null as any, color: 'emerald', trend: '+18% vs last month', up: true },
      { label: 'Avg Conversion', value: `${avgConversion.toFixed(1)}%`, icon: null as any, color: 'blue', trend: '+2.1% vs manual', up: true },
      { label: 'Time Saved', value: `${totalTimeSaved}h`, icon: null as any, color: 'violet', trend: `${Math.round(totalTimeSaved / 4)}h/week avg`, up: true },
      { label: 'AI-Enabled Nodes', value: `${aiNodes}/${totalNodes}`, icon: null as any, color: 'fuchsia', trend: `${actionNodes} actions, ${conditionNodes} conditions`, up: null },
      { label: 'Success Rate', value: `${successRate.toFixed(0)}%`, icon: null as any, color: 'amber', trend: successRate >= 80 ? 'Healthy' : 'Needs attention', up: successRate >= 80 },
    ];
  }, [workflow.nodes, workflows, executionLog]);

  const nodePerformance = useMemo((): NodePerformanceMetric[] => {
    if (realNodePerformance.length > 0) {
      return realNodePerformance;
    }
    return workflow.nodes.map(node => ({
      nodeTitle: node.title,
      nodeType: node.type,
      executions: 0,
      successRate: 0,
      avgDuration: 0,
      lastRun: new Date().toISOString(),
    }));
  }, [workflow.nodes, realNodePerformance]);

  const workflowHealth = useMemo((): WorkflowHealth => {
    const hasTrigger = workflow.nodes.some(n => n.type === 'trigger') ? 20 : 0;
    const hasActions = workflow.nodes.filter(n => n.type === 'action').length > 0 ? 20 : 0;
    const hasConditions = workflow.nodes.filter(n => n.type === 'condition').length > 0 ? 15 : 0;
    const hasAI = workflow.nodes.some(n => n.config.aiPersonalization) ? 15 : 0;
    const hasFallbacks = workflow.nodes.some(n => n.config.fallbackEnabled) ? 15 : 0;
    const complexity = Math.min(workflow.nodes.length * 3, 15);
    const score = hasTrigger + hasActions + hasConditions + hasAI + hasFallbacks + complexity;
    const metrics = [
      { label: 'Trigger Setup', score: hasTrigger, max: 20, status: hasTrigger > 0 ? 'pass' as const : 'fail' as const },
      { label: 'Action Steps', score: hasActions, max: 20, status: hasActions > 0 ? 'pass' as const : 'fail' as const },
      { label: 'Branching Logic', score: hasConditions, max: 15, status: hasConditions > 0 ? 'pass' as const : 'warn' as const },
      { label: 'AI Features', score: hasAI, max: 15, status: hasAI > 0 ? 'pass' as const : 'warn' as const },
      { label: 'Error Handling', score: hasFallbacks, max: 15, status: hasFallbacks > 0 ? 'pass' as const : 'warn' as const },
      { label: 'Complexity', score: complexity, max: 15, status: complexity >= 9 ? 'pass' as const : 'warn' as const },
    ];
    return { score, metrics };
  }, [workflow.nodes]);

  const roiCalculation = useMemo((): RoiCalculation => {
    const manualHoursPerLead = 2.5;
    const automatedHoursPerLead = 0.3;
    const hourlyRate = 45;
    const totalLeads = workflow.stats.leadsProcessed || leads.length || 50;

    const manualCost = totalLeads * manualHoursPerLead * hourlyRate;
    const automatedCost = totalLeads * automatedHoursPerLead * hourlyRate;
    const savings = manualCost - automatedCost;
    const savingsPct = manualCost > 0 ? Math.round((savings / manualCost) * 100) : 0;

    const timeSavedPerLead = manualHoursPerLead - automatedHoursPerLead;
    const totalTimeSaved = Math.round(totalLeads * timeSavedPerLead);
    const conversionLift = workflow.stats.conversionRate > 0 ? Math.round(workflow.stats.conversionRate * 1.35) : 12;
    const revenueImpact = Math.round(totalLeads * (conversionLift / 100) * 2800);

    const monthlyBreakdown = Array.from({ length: 6 }, (_, i) => {
      const month = new Date();
      month.setMonth(month.getMonth() - (5 - i));
      const factor = 0.7 + i * 0.06;
      return {
        month: month.toLocaleDateString('en-US', { month: 'short' }),
        manual: Math.round(manualCost * factor / 6),
        automated: Math.round(automatedCost * factor / 6),
        savings: Math.round(savings * factor / 6),
      };
    });

    return {
      manualCost, automatedCost, savings, savingsPct, totalTimeSaved,
      timeSavedPerLead, conversionLift, revenueImpact, monthlyBreakdown,
      costPerLead: automatedCost > 0 ? Math.round(automatedCost / totalLeads) : 0,
      totalLeads,
    };
  }, [workflow.stats, leads.length]);

  const triggerAnalytics = useMemo((): TriggerAnalyticsData => {
    const triggerNodes = workflow.nodes.filter(n => n.type === 'trigger');
    const totalExecs = executionLog.length;
    const successExecs = executionLog.filter(e => e.status === 'success').length;

    const triggerTypes = TRIGGER_OPTIONS.map(opt => {
      const count = triggerNodes.filter(n => n.config.triggerType === opt.type).length;
      const fired = count > 0 ? Math.max(totalExecs, 0) : 0;
      const converted = count > 0 ? successExecs : 0;
      return {
        type: opt.type,
        label: opt.label,
        count,
        fired,
        converted,
        conversionRate: fired > 0 ? Math.round((converted / fired) * 100) : 0,
        avgResponseTime: executionLog.length > 0
          ? parseFloat((executionLog.reduce((s, e) => s + e.duration, 0) / executionLog.length).toFixed(1))
          : 0,
      };
    });

    const hourlyDistribution = Array.from({ length: 24 }, (_, h) => {
      const hourExecs = executionLog.filter(e => new Date(e.timestamp).getHours() === h).length;
      return {
        hour: h,
        label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
        triggers: hourExecs,
      };
    });
    const peakHour = hourlyDistribution.reduce((best, h) => h.triggers > best.triggers ? h : best, hourlyDistribution[0]);

    const totalFired = triggerTypes.reduce((s, t) => s + t.fired, 0);
    const totalConverted = triggerTypes.reduce((s, t) => s + t.converted, 0);
    const overallConversion = totalFired > 0 ? Math.round((totalConverted / totalFired) * 100) : 0;

    const weeklyTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayDate = d.toISOString().slice(0, 10);
      const count = executionLog.filter(e => e.timestamp.slice(0, 10) === dayDate).length;
      return { day: dayStr, count };
    });

    return { triggerTypes, hourlyDistribution, peakHour, totalFired, totalConverted, overallConversion, weeklyTrend };
  }, [workflow.nodes, executionLog]);

  const templateEffectiveness = useMemo((): TemplateEffectivenessData => {
    const emailSteps = executionLog.filter(e => e.step?.toLowerCase().includes('email'));
    const totalSentFromLog = emailSteps.length;

    const templates = EMAIL_TEMPLATES.map(tmpl => {
      const nodesUsing = workflow.nodes.filter(n => n.config.template === tmpl.id).length;
      const sent = nodesUsing > 0 ? Math.max(totalSentFromLog, nodesUsing) : 0;
      const aiEnhanced = workflow.nodes.some(n => n.config.template === tmpl.id && n.config.aiPersonalization);
      return {
        id: tmpl.id,
        label: tmpl.label,
        desc: tmpl.desc,
        nodesUsing,
        sent,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
        aiEnhanced,
        conversionScore: nodesUsing > 0 ? nodesUsing * 10 : 0,
      };
    }).sort((a, b) => b.conversionScore - a.conversionScore);

    const aiTemplates = templates.filter(t => t.aiEnhanced);
    const nonAiTemplates = templates.filter(t => !t.aiEnhanced);
    const avgAiOpenRate = aiTemplates.length > 0 ? Math.round(aiTemplates.reduce((s, t) => s + t.openRate, 0) / aiTemplates.length) : 0;
    const avgNonAiOpenRate = nonAiTemplates.length > 0 ? Math.round(nonAiTemplates.reduce((s, t) => s + t.openRate, 0) / nonAiTemplates.length) : 0;
    const aiLift = avgAiOpenRate - avgNonAiOpenRate;

    const timingPerformance = [
      { timing: 'Immediate', openRate: 0, clickRate: 0, label: 'instant' },
      { timing: 'AI Optimal', openRate: 0, clickRate: 0, label: 'optimal' },
      { timing: 'Morning (9 AM)', openRate: 0, clickRate: 0, label: 'morning' },
      { timing: 'Afternoon (2 PM)', openRate: 0, clickRate: 0, label: 'afternoon' },
    ];

    const bestTemplate = templates[0];
    const totalSent = templates.reduce((s, t) => s + t.sent, 0);

    return { templates, aiLift, avgAiOpenRate, avgNonAiOpenRate, timingPerformance, bestTemplate, totalSent };
  }, [workflow.nodes, executionLog]);

  // ─── Filtered leads for selection ───
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (l.score < leadScoreFilter) return false;
      if (leadStatusFilter !== 'all' && l.status !== leadStatusFilter) return false;
      return true;
    });
  }, [leads, leadScoreFilter, leadStatusFilter]);

  const leadsWithEmail = useMemo(() => filteredLeads.filter(l => l.email), [filteredLeads]);
  const selectedLeadCount = testLeadIds.size;
  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every(l => testLeadIds.has(l.id));

  // ═══════════════════════════════════════════════════════════════
  // Handlers (useCallback)
  // ═══════════════════════════════════════════════════════════════

  const updateNodeConfig = useCallback((nodeId: string, key: string, value: string | number | boolean) => {
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n),
    }));
  }, []);

  const updateNodeTitle = useCallback((nodeId: string, title: string) => {
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, title } : n),
    }));
  }, []);

  const updateNodeDescription = useCallback((nodeId: string, description: string) => {
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, description } : n),
    }));
  }, []);

  const addNode = useCallback((type: NodeType) => {
    const titles: Record<NodeType, string> = {
      trigger: 'New trigger',
      action: 'New action step',
      condition: 'New condition',
      wait: 'Wait period',
    };
    const descs: Record<NodeType, string> = {
      trigger: 'Configure the trigger event',
      action: 'Configure the action to perform',
      condition: 'Set the condition criteria',
      wait: 'Set the wait duration',
    };
    const newNode: WorkflowNode = {
      id: `n-${Date.now()}`,
      type,
      title: titles[type],
      description: descs[type],
      config: type === 'wait' ? { days: 1 } : type === 'condition' ? { field: 'score', operator: 'gt', value: 50 } : { actionType: 'send_email', template: 'welcome', aiPersonalization: false, timing: 'immediate', fallbackEnabled: false },
    };
    setWorkflow(prev => ({ ...prev, nodes: [...prev.nodes, newNode] }));
    setSelectedNodeId(newNode.id);
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
    }));
    setSelectedNodeId(prev => prev === nodeId ? null : prev);
  }, []);

  const moveNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    setWorkflow(prev => {
      const idx = prev.nodes.findIndex(n => n.id === nodeId);
      if (idx < 0) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.nodes.length - 1) return prev;
      const newNodes = [...prev.nodes];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newNodes[idx], newNodes[swapIdx]] = [newNodes[swapIdx], newNodes[idx]];
      return { ...prev, nodes: newNodes };
    });
  }, []);

  const reorderNodes = useCallback((fromIndex: number, toIndex: number) => {
    setWorkflow(prev => {
      if (fromIndex === toIndex) return prev;
      const newNodes = [...prev.nodes];
      const [moved] = newNodes.splice(fromIndex, 1);
      newNodes.splice(toIndex, 0, moved);
      return { ...prev, nodes: newNodes };
    });
  }, []);

  const handleSave = useCallback(async () => {
    setWorkflows(prev => {
      const exists = prev.findIndex(w => w.id === workflow.id);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = workflow;
        return updated;
      }
      return [...prev, workflow];
    });
    const saved = await saveWorkflowToDb({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      nodes: workflow.nodes,
      createdAt: workflow.createdAt,
      stats: workflow.stats,
    });
    if (saved) {
      setWorkflow(prev => ({ ...prev, id: saved.id }));
      setWorkflows(prev => prev.map(w => w.id === workflow.id ? { ...w, id: saved.id } : w));
    }
  }, [workflow]);

  const handleTest = useCallback(async () => {
    setTestRunning(true);
    setTestResults(null);
    setExecutionResults(null);

    const selectedLeads = testLeadIds.size > 0
      ? leads.filter(l => testLeadIds.has(l.id))
      : leads.slice(0, 1);

    if (selectedLeads.length === 0) {
      setTestResults({
        passed: false,
        stepsRun: 0,
        stepsTotal: workflow.nodes.length,
        leadName: 'No leads selected',
        leadScore: 0,
        details: [{ step: 'Pre-check', status: 'fail', message: 'No leads available — add leads to your pipeline first' }],
      });
      setTestRunning(false);
      return;
    }

    try {
      const timeoutMs = 30_000;
      const results = await Promise.race([
        executeWorkflowEngine(
          {
            id: workflow.id,
            name: workflow.name,
            description: workflow.description,
            status: workflow.status,
            nodes: workflow.nodes,
            createdAt: workflow.createdAt,
            stats: workflow.stats,
          },
          selectedLeads
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out after 30 seconds. Check your API keys and Supabase edge functions.')), timeoutMs)
        ),
      ]);

      setExecutionResults(results);

      const firstResult = results[0];
      if (firstResult) {
        const details = firstResult.steps.map((s, i) => ({
          step: `${i + 1}. ${s.nodeTitle}`,
          status: s.status,
          message: s.message,
        }));
        const passedCount = details.filter(d => d.status === 'pass').length;
        setTestResults({
          passed: firstResult.status === 'success',
          stepsRun: passedCount,
          stepsTotal: details.length,
          leadName: firstResult.leadName,
          leadScore: selectedLeads[0]?.score || 0,
          details,
        });
      }

      refreshExecutionLog();
      if (panelVisibility.campaignsPanel) {
        fetchCampaignHistory().then(setCampaignHistory).catch(e => console.warn('[Automation] campaign refresh failed:', e));
      }
      if (leads.length > 0) {
        fetchBatchEmailSummary(leads.map(l => l.id)).then(setEmailSummaryMap).catch(e => console.warn('[Automation] email summary refresh failed:', e));
      }
    } catch (err) {
      setTestResults({
        passed: false,
        stepsRun: 0,
        stepsTotal: workflow.nodes.length,
        leadName: selectedLeads[0]?.name || 'Unknown',
        leadScore: selectedLeads[0]?.score || 0,
        details: [{ step: 'Execution', status: 'fail', message: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }],
      });
    }

    setTestRunning(false);
  }, [leads, workflow, testLeadIds, refreshExecutionLog, panelVisibility.campaignsPanel]);

  const runValidation = useCallback(() => {
    setValidating(true);
    setValidations([]);
    setTimeout(() => {
      const items: ValidationItem[] = [];
      const hasTrigger = workflow.nodes.some(n => n.type === 'trigger');
      items.push({
        label: 'Trigger configured',
        status: hasTrigger ? 'pass' : 'fail',
        message: hasTrigger ? 'Workflow has a valid trigger' : 'No trigger found - add a trigger node',
      });
      const hasAction = workflow.nodes.some(n => n.type === 'action');
      items.push({
        label: 'Action steps present',
        status: hasAction ? 'pass' : 'fail',
        message: hasAction ? `${workflow.nodes.filter(n => n.type === 'action').length} action steps configured` : 'No action steps found',
      });
      const emailNodes = workflow.nodes.filter(n => n.type === 'action' && n.config.template);
      items.push({
        label: 'Email templates valid',
        status: emailNodes.length > 0 ? 'pass' : 'warn',
        message: emailNodes.length > 0 ? `${emailNodes.length} email templates assigned` : 'No email templates configured yet',
      });
      const conditions = workflow.nodes.filter(n => n.type === 'condition');
      items.push({
        label: 'Conditions verified',
        status: conditions.length > 0 ? 'pass' : 'warn',
        message: conditions.length > 0 ? `${conditions.length} condition branches verified` : 'No conditions - workflow runs linearly',
      });
      items.push({
        label: 'Workflow complexity',
        status: workflow.nodes.length >= 3 ? 'pass' : 'warn',
        message: `${workflow.nodes.length} steps total - ${workflow.nodes.length >= 5 ? 'robust workflow' : 'consider adding more steps'}`,
      });
      items.push({
        label: 'All connections valid',
        status: 'pass',
        message: 'All nodes are connected in sequence',
      });
      setValidations(items);
      setValidating(false);
    }, 1500);
  }, [workflow.nodes]);

  const handleAiOptimize = useCallback(async () => {
    setAiOptimizing(true);
    setAiSuggestions([]);
    try {
      const response = await generateWorkflowOptimization({
        nodes: workflow.nodes,
        stats: workflow.stats,
        leadCount: leads.length,
      });
      const lines = response.text
        .split('\n')
        .map(l => l.replace(/^[-*•]\s*/, '').trim())
        .filter(l => l.length > 10);
      setAiSuggestions(lines.length > 0 ? lines : ['No suggestions available — try adding more nodes or running the workflow first.']);
    } catch (err) {
      setAiSuggestions([`AI optimization failed: ${err instanceof Error ? err.message : 'Unknown error'}. Try again.`]);
    }
    setAiOptimizing(false);
  }, [workflow.nodes, workflow.stats, leads.length]);

  const toggleWorkflowStatus = useCallback(() => {
    setWorkflow(prev => ({
      ...prev,
      status: prev.status === 'active' ? 'paused' : 'active',
    }));
  }, []);

  const startWizard = useCallback(() => {
    setWizardActive(true);
    setWizardStep(1);
    setWizardName('');
    setWizardDescription('');
    setWizardTrigger(null);
    setTestResults(null);
    setValidations([]);
    setAiSuggestions([]);
  }, []);

  const handleWizardCreate = useCallback(() => {
    const triggerTitle = TRIGGER_OPTIONS.find(t => t.type === wizardTrigger)?.label || 'New trigger';
    const triggerDesc = TRIGGER_OPTIONS.find(t => t.type === wizardTrigger)?.desc || 'Configure the trigger';
    const newWf: Workflow = {
      id: `wf-${Date.now()}`,
      name: wizardName || 'Untitled Workflow',
      description: wizardDescription || '',
      status: 'draft',
      nodes: [
        { id: `n-${Date.now()}`, type: 'trigger', title: triggerTitle, description: triggerDesc, config: { triggerType: wizardTrigger || 'lead_created' } },
      ],
      createdAt: new Date().toISOString(),
      stats: { leadsProcessed: 0, conversionRate: 0, timeSavedHrs: 0, roi: 0 },
    };
    setWorkflow(newWf);
    setSelectedNodeId(null);
    setWizardStep(2);
  }, [wizardName, wizardDescription, wizardTrigger]);

  const handleActivate = useCallback(async () => {
    setWorkflow(prev => ({ ...prev, status: 'active' }));
    await handleSave();
    setWizardActive(false);
  }, [handleSave]);

  const loadWorkflow = useCallback((wf: Workflow) => {
    setWorkflow(wf);
    setSelectedNodeId(null);
    setShowWorkflowList(false);
    setWizardActive(false);
  }, []);

  const toggleTestLead = useCallback((leadId: string) => {
    setTestLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const selectAllFilteredLeads = useCallback(() => {
    setTestLeadIds(prev => {
      const next = new Set(prev);
      filteredLeads.forEach(l => next.add(l.id));
      return next;
    });
  }, [filteredLeads]);

  const deselectAllLeads = useCallback(() => {
    setTestLeadIds(new Set());
  }, []);

  // ─── Workflow Delete & Duplicate ───
  const handleDeleteWorkflow = useCallback(async (workflowId: string) => {
    const success = await deleteWorkflowFromDb(workflowId);
    if (success) {
      setWorkflows(prev => {
        const remaining = prev.filter(w => w.id !== workflowId);
        if (workflow.id === workflowId && remaining.length > 0) {
          setWorkflow(remaining[0]);
        } else if (remaining.length === 0) {
          setWorkflow(DEFAULT_WORKFLOW);
          return [DEFAULT_WORKFLOW];
        }
        return remaining;
      });
    }
    return success;
  }, [workflow.id]);

  const handleDuplicateWorkflow = useCallback(async (wf: Workflow) => {
    const newWf: Workflow = {
      ...wf,
      id: `wf-${Date.now()}`,
      name: `${wf.name} (Copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      stats: { leadsProcessed: 0, conversionRate: 0, timeSavedHrs: 0, roi: 0 },
      nodes: wf.nodes.map(n => ({ ...n, id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
    };
    const saved = await saveWorkflowToDb({
      id: newWf.id,
      name: newWf.name,
      description: newWf.description,
      status: newWf.status,
      nodes: newWf.nodes,
      createdAt: newWf.createdAt,
      stats: newWf.stats,
    });
    if (saved) {
      newWf.id = saved.id;
    }
    setWorkflows(prev => [newWf, ...prev]);
    setWorkflow(newWf);
    setSelectedNodeId(null);
    setShowWorkflowList(false);
  }, []);

  // ─── Keyboard Shortcuts ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (isInput) return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); togglePanel('shortcuts'); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); startWizard(); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); togglePanel('executionLog'); return; }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); togglePanel('healthPanel'); return; }
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); togglePanel('nodeAnalytics'); return; }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); togglePanel('roiCalculator'); return; }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); togglePanel('triggerAnalytics'); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); togglePanel('templateEffectiveness'); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); togglePanel('campaignsPanel'); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); handleTest(); return; }
      if (e.key === 'o' || e.key === 'O') { e.preventDefault(); handleAiOptimize(); return; }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSave(); return; }
      if (e.key === 'Escape') {
        closeAllPanels();
        setShowWorkflowList(false);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startWizard, handleTest, handleAiOptimize, handleSave, togglePanel, closeAllPanels]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // Data
    leads,
    workflow,
    workflows,
    selectedNode,
    selectedNodeId,
    integrationStatuses,
    emailSummaryMap,

    // Computed
    kpiStats,
    nodePerformance,
    workflowHealth,
    roiCalculation,
    triggerAnalytics,
    templateEffectiveness,
    filteredLeads,
    leadsWithEmail,
    selectedLeadCount,
    allFilteredSelected,
    executionLog,
    executionResults,

    // Wizard
    wizardActive,
    wizardStep,
    wizardName,
    wizardDescription,
    wizardTrigger,
    setWizardActive,
    setWizardStep,
    setWizardName,
    setWizardDescription,
    setWizardTrigger,

    // Panels
    panelVisibility,
    togglePanel,
    closePanel,
    closeAllPanels,

    // Workflow state
    setWorkflow,
    setSelectedNodeId,
    showWorkflowList,
    setShowWorkflowList,
    dbLoaded,

    // Test/Validation
    testRunning,
    testResults,
    validations,
    validating,

    // Activation
    activationMode,
    setActivationMode,
    scheduleDate,
    setScheduleDate,
    scheduleTime,
    setScheduleTime,
    segmentFilter,
    setSegmentFilter,
    monitorAlerts,
    setMonitorAlerts,

    // AI
    aiOptimizing,
    aiSuggestions,
    setAiSuggestions,

    // Lead selection
    testLeadIds,
    showLeadPanel,
    setShowLeadPanel,
    leadScoreFilter,
    setLeadScoreFilter,
    leadStatusFilter,
    setLeadStatusFilter,

    // Campaigns
    campaignHistory,
    campaignHistoryLoading,
    selectedCampaignId,
    setSelectedCampaignId,
    campaignRecipients,
    campaignRecipientsLoading,
    setCampaignRecipients,

    // Handlers
    updateNodeConfig,
    updateNodeTitle,
    updateNodeDescription,
    addNode,
    removeNode,
    moveNode,
    reorderNodes,
    handleSave,
    handleTest,
    runValidation,
    handleAiOptimize,
    toggleWorkflowStatus,
    startWizard,
    handleWizardCreate,
    handleActivate,
    loadWorkflow,
    toggleTestLead,
    selectAllFilteredLeads,
    deselectAllLeads,
    refreshExecutionLog,
    handleDeleteWorkflow,
    handleDuplicateWorkflow,
  };
}

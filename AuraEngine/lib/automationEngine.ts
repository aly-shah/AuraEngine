import { supabase } from './supabase';
import { sendTrackedEmail, scheduleEmailBlock } from './emailTracking';
import { personalizeForSend } from './personalization';
import { generatePersonalizedEmail } from './gemini';
import { fetchIntegration } from './integrations';
import { leadDisplayName } from './queries';
import type { Lead, EmailTemplate } from '../types';

// ─── Types ───

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'wait';
  title: string;
  description: string;
  config: Record<string, string | number | boolean>;
}

export interface WorkflowStats {
  leadsProcessed: number;
  conversionRate: number;
  timeSavedHrs: number;
  roi: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  nodes: WorkflowNode[];
  createdAt: string;
  stats: WorkflowStats;
  userId?: string;
  teamId?: string | null;
}

export interface ExecutionStepResult {
  nodeId: string;
  nodeTitle: string;
  nodeType: 'trigger' | 'action' | 'condition' | 'wait';
  status: 'pass' | 'fail' | 'skip';
  message: string;
  durationMs: number;
}

export interface ExecutionResult {
  leadId: string;
  leadName: string;
  status: 'success' | 'failed' | 'skipped';
  steps: ExecutionStepResult[];
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
}

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  workflowName: string;
  leadName: string;
  step: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  duration: number;
}

export interface NodePerformanceMetric {
  nodeTitle: string;
  nodeType: 'trigger' | 'action' | 'condition' | 'wait';
  executions: number;
  successRate: number;
  avgDuration: number;
  lastRun: string;
}

// ─── Workflow CRUD ───

export async function saveWorkflow(workflow: Workflow): Promise<Workflow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const row = {
    id: workflow.id,
    user_id: user.id,
    team_id: workflow.teamId || null,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    nodes: workflow.nodes,
    stats: workflow.stats,
  };

  const { data, error } = await supabase
    .from('workflows')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Failed to save workflow:', error.message);
    return null;
  }

  return dbRowToWorkflow(data);
}

export async function loadWorkflows(userId: string): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Failed to load workflows:', error.message);
    return [];
  }

  return (data || []).map(dbRowToWorkflow);
}

export async function deleteWorkflow(workflowId: string): Promise<boolean> {
  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', workflowId);

  if (error) {
    console.error('Failed to delete workflow:', error.message);
    return false;
  }
  return true;
}

function dbRowToWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status,
    nodes: row.nodes || [],
    createdAt: row.created_at,
    stats: row.stats || { leadsProcessed: 0, conversionRate: 0, timeSavedHrs: 0, roi: 0 },
    userId: row.user_id,
    teamId: row.team_id,
  };
}

// ─── Execution Engine ───

export async function executeWorkflow(
  workflow: Workflow,
  leads: Lead[]
): Promise<ExecutionResult[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const results: ExecutionResult[] = [];

  for (const lead of leads) {
    const startedAt = new Date().toISOString();
    const steps: ExecutionStepResult[] = [];
    let overallStatus: 'success' | 'failed' | 'skipped' = 'success';
    let errorMessage: string | undefined;
    let skipRemaining = false;

    for (const node of workflow.nodes) {
      if (skipRemaining) {
        steps.push({
          nodeId: node.id,
          nodeTitle: node.title,
          nodeType: node.type,
          status: 'skip',
          message: 'Skipped — upstream condition not met',
          durationMs: 0,
        });
        continue;
      }

      const stepStart = Date.now();

      try {
        const result = await executeNode(node, lead, user.id);
        steps.push({
          nodeId: node.id,
          nodeTitle: node.title,
          nodeType: node.type,
          status: result.status,
          message: result.message,
          durationMs: Date.now() - stepStart,
        });

        if (result.status === 'fail') {
          overallStatus = 'failed';
          errorMessage = result.message;
        }
        if (result.status === 'skip' && node.type === 'condition') {
          skipRemaining = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        steps.push({
          nodeId: node.id,
          nodeTitle: node.title,
          nodeType: node.type,
          status: 'fail',
          message: msg,
          durationMs: Date.now() - stepStart,
        });
        overallStatus = 'failed';
        errorMessage = msg;
      }
    }

    const completedAt = new Date().toISOString();

    // Write execution to DB
    await supabase.from('workflow_executions').insert({
      workflow_id: workflow.id,
      user_id: user.id,
      lead_id: lead.id,
      status: overallStatus,
      steps,
      started_at: startedAt,
      completed_at: completedAt,
      error_message: errorMessage || null,
    });

    results.push({
      leadId: lead.id,
      leadName: leadDisplayName(lead),
      status: overallStatus,
      steps,
      startedAt,
      completedAt,
      errorMessage,
    });
  }

  // Update workflow stats
  const prevProcessed = workflow.stats.leadsProcessed || 0;
  const successCount = results.filter(r => r.status === 'success').length;
  const newProcessed = prevProcessed + leads.length;
  const newConversion = newProcessed > 0
    ? ((prevProcessed * (workflow.stats.conversionRate / 100) + successCount) / newProcessed) * 100
    : 0;
  const timeSavedPerLead = 2.2; // estimated hrs saved per automated lead vs manual

  await supabase
    .from('workflows')
    .update({
      stats: {
        leadsProcessed: newProcessed,
        conversionRate: parseFloat(newConversion.toFixed(1)),
        timeSavedHrs: Math.round((workflow.stats.timeSavedHrs || 0) + leads.length * timeSavedPerLead),
        roi: workflow.stats.roi || 0,
      },
    })
    .eq('id', workflow.id);

  // Insert audit log
  await supabase.from('audit_logs').insert({
    user_id: user.id,
    action: 'AUTOMATION_EXECUTED',
    details: `Workflow "${workflow.name}" executed on ${leads.length} lead(s) — ${successCount} succeeded, ${leads.length - successCount} failed`,
  });

  return results;
}

async function executeNode(
  node: WorkflowNode,
  lead: Lead,
  userId: string
): Promise<{ status: 'pass' | 'fail' | 'skip'; message: string }> {
  switch (node.type) {
    case 'trigger':
      return executeTrigger(node, lead);

    case 'action':
      return executeAction(node, lead, userId);

    case 'condition':
      return evaluateCondition(node, lead);

    case 'wait':
      return {
        status: 'pass',
        message: `Wait ${node.config.days || 1} day(s) — noted for execution (continuing immediately in manual run)`,
      };

    default:
      return { status: 'skip', message: `Unknown node type: ${node.type}` };
  }
}

function executeTrigger(
  node: WorkflowNode,
  lead: Lead
): { status: 'pass' | 'fail' | 'skip'; message: string } {
  const triggerType = node.config.triggerType as string;

  switch (triggerType) {
    case 'lead_created':
      return { status: 'pass', message: `Trigger matched — lead "${leadDisplayName(lead)}" exists in pipeline` };

    case 'score_change': {
      const threshold = Number(node.config.threshold) || 50;
      if (lead.score >= threshold) {
        return { status: 'pass', message: `Lead score ${lead.score} meets threshold ${threshold}` };
      }
      return { status: 'skip', message: `Lead score ${lead.score} below threshold ${threshold}` };
    }

    case 'status_change':
      return { status: 'pass', message: `Trigger matched — lead status is "${lead.status}"` };

    case 'time_elapsed':
      return { status: 'pass', message: 'Scheduled trigger — proceeding' };

    case 'tag_added':
      return { status: 'pass', message: 'Custom trigger — proceeding' };

    default:
      return { status: 'pass', message: `Trigger "${triggerType}" matched` };
  }
}

async function executeAction(
  node: WorkflowNode,
  lead: Lead,
  userId: string
): Promise<{ status: 'pass' | 'fail' | 'skip'; message: string }> {
  const actionType = (node.config.actionType as string) || inferActionType(node);

  switch (actionType) {
    case 'send_email': {
      if (!lead.primary_email) {
        return { status: 'fail', message: 'No email address for this lead' };
      }

      const templateCategory = (node.config.template as string) || 'welcome';
      const aiEnabled = !!node.config.aiPersonalization;
      const timing = (node.config.timing as string) || 'immediate';
      const fallbackEnabled = !!node.config.fallbackEnabled;
      const fallbackAction = (node.config.fallbackAction as string) || 'skip';

      // Step 1: Resolve template content
      let subject: string;
      let htmlBody: string;

      if (templateCategory === '__custom__') {
        subject = (node.config.customSubject as string) || `${node.title} — ${lead.company}`;
        htmlBody = (node.config.customBody as string) || `<p>Hi ${lead.first_name || leadDisplayName(lead)},</p><p>This is a message from ${node.title}.</p>`;
      } else {
        // Fetch from email_templates, preferring user template over default
        const { data: templates } = await supabase
          .from('email_templates')
          .select('*')
          .eq('category', templateCategory)
          .or(`owner_id.eq.${userId},owner_id.is.null`)
          .order('owner_id', { ascending: false, nullsFirst: false })
          .limit(1);

        const template = templates?.[0] as EmailTemplate | undefined;
        if (template) {
          subject = template.subject_template;
          htmlBody = template.body_template;
        } else {
          subject = `${node.title} — ${lead.company}`;
          htmlBody = `<p>Hi ${lead.first_name || leadDisplayName(lead)},</p><p>This is an automated email from "${node.title}".</p>`;
        }
      }

      // Step 2: Personalize with {{tags}}
      subject = personalizeForSend(subject, lead);
      htmlBody = personalizeForSend(htmlBody, lead);

      // Step 3: AI enhancement (if enabled)
      if (aiEnabled) {
        try {
          const aiResult = await generatePersonalizedEmail({
            subjectTemplate: subject,
            bodyTemplate: htmlBody,
            lead,
          });
          subject = aiResult.subject;
          htmlBody = aiResult.htmlBody;
        } catch (err) {
          console.warn('AI personalization failed, continuing with tag-resolved version:', err);
        }
      }

      // Step 4: Send or schedule based on timing
      try {
        if (timing === 'immediate') {
          const result = await sendTrackedEmail({
            leadId: lead.id,
            toEmail: lead.primary_email,
            subject,
            htmlBody,
            trackOpens: true,
            trackClicks: true,
          });

          if (result.success) {
            return { status: 'pass', message: `Email sent to ${lead.primary_email} (template: ${templateCategory}${aiEnabled ? ', AI-enhanced' : ''})` };
          }
          throw new Error(result.error || 'Send failed');
        } else {
          // Schedule for later
          const scheduledAt = calculateScheduledTime(timing);
          const schedResult = await scheduleEmailBlock({
            leads: [{ id: lead.id, email: lead.primary_email, name: leadDisplayName(lead), company: lead.company, insights: lead.insights, score: lead.score, status: lead.status, lastActivity: lead.last_activity, knowledgeBase: lead.knowledgeBase }],
            subject,
            htmlBody,
            scheduledAt,
            blockIndex: 0,
            sequenceId: `wf-${node.id}-${Date.now()}`,
          });

          if (schedResult.scheduled > 0) {
            return { status: 'pass', message: `Email scheduled for ${scheduledAt.toLocaleString()} to ${lead.primary_email} (template: ${templateCategory}, timing: ${timing}${aiEnabled ? ', AI-enhanced' : ''})` };
          }
          throw new Error(schedResult.errors.join('; ') || 'Schedule failed');
        }
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown send error';

        // Step 5: Fallback on failure
        if (fallbackEnabled) {
          return executeFallback(fallbackAction, node, lead, userId, errMsg, { subject, htmlBody });
        }
        return { status: 'fail', message: `Email failed: ${errMsg}` };
      }
    }

    case 'update_status': {
      const newStatus = (node.config.newStatus as string) || 'Contacted';
      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus })
        .eq('id', lead.id);
      if (error) {
        return { status: 'fail', message: `Status update failed: ${error.message}` };
      }
      return { status: 'pass', message: `Lead status updated to "${newStatus}"` };
    }

    case 'add_tag': {
      const tag = (node.config.tag as string) || 'Automated';
      const kb: Record<string, any> = lead.knowledgeBase ? { ...lead.knowledgeBase } : {};
      const existingNotes = kb.extraNotes || '';
      const tagMarker = `[tag:${tag}]`;
      if (!existingNotes.includes(tagMarker)) {
        kb.extraNotes = existingNotes ? `${existingNotes} ${tagMarker}` : tagMarker;
      }

      const { error } = await supabase
        .from('leads')
        .update({ knowledgeBase: kb })
        .eq('id', lead.id);
      if (error) {
        return { status: 'fail', message: `Tag add failed: ${error.message}` };
      }
      return { status: 'pass', message: `Tag "${tag}" added to lead` };
    }

    case 'create_alert': {
      const { error } = await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'AUTOMATION_ALERT',
        details: `Alert from workflow node "${node.title}" for lead ${leadDisplayName(lead)} (${lead.company})`,
      });
      if (error) {
        return { status: 'fail', message: `Alert creation failed: ${error.message}` };
      }
      return { status: 'pass', message: `Alert created for "${leadDisplayName(lead)}"` };
    }

    case 'assign_user': {
      const assignee = (node.config.assignee as string) || '';
      const kb = lead.knowledgeBase || {};
      const updatedKb = { ...kb, assignedTo: assignee };

      const { error } = await supabase
        .from('leads')
        .update({ knowledgeBase: updatedKb })
        .eq('id', lead.id);
      if (error) {
        return { status: 'fail', message: `Assignment failed: ${error.message}` };
      }
      return { status: 'pass', message: `Lead assigned to "${assignee}"` };
    }

    case 'notify_slack': {
      const slack = await fetchIntegration('slack');
      if (!slack || slack.status !== 'connected') {
        return { status: 'fail', message: 'Slack is not connected. Connect it in Integration Hub first.' };
      }
      const webhookUrl = slack.credentials.webhookUrl;
      if (!webhookUrl) {
        return { status: 'fail', message: 'Slack webhook URL not configured' };
      }
      try {
        const messageTemplate = (node.config.messageTemplate as string) || '';
        const text = messageTemplate
          ? personalizeForSend(messageTemplate, lead)
          : `*New lead activity* — ${leadDisplayName(lead)} (${lead.company})\nScore: ${lead.score} | Status: ${lead.status}\nEmail: ${lead.primary_email}`;

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          return { status: 'pass', message: `Slack notification sent for "${leadDisplayName(lead)}"` };
        }
        return { status: 'fail', message: `Slack returned ${res.status}` };
      } catch (err) {
        return { status: 'fail', message: `Slack notification failed: ${(err as Error).message}` };
      }
    }

    case 'sync_crm': {
      const crmProvider = (node.config.crmProvider as string) || 'hubspot';
      const integration = await fetchIntegration(crmProvider === 'salesforce' ? 'salesforce' : 'hubspot');
      if (!integration || integration.status !== 'connected') {
        return { status: 'fail', message: `${crmProvider} is not connected. Connect it in Integration Hub first.` };
      }

      try {
        if (crmProvider === 'hubspot') {
          const apiKey = integration.credentials.apiKey;
          if (!apiKey) return { status: 'fail', message: 'HubSpot API key not configured' };

          const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: {
                email: lead.primary_email,
                firstname: lead.first_name || '',
                lastname: lead.last_name || '',
                company: lead.company,
                hs_lead_status: lead.status === 'Qualified' ? 'QUALIFIED' : 'NEW',
              },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            return { status: 'pass', message: `Synced "${leadDisplayName(lead)}" to HubSpot (ID: ${data.id})` };
          }
          const errBody = await res.json().catch(() => ({}));
          return { status: 'fail', message: `HubSpot sync failed: ${(errBody as any).message || res.status}` };
        } else {
          // Salesforce
          const { instanceUrl, accessToken } = integration.credentials;
          if (!instanceUrl || !accessToken) return { status: 'fail', message: 'Salesforce credentials incomplete' };

          const baseUrl = instanceUrl.replace(/\/$/, '');
          const res = await fetch(`${baseUrl}/services/data/v59.0/sobjects/Lead`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              Email: lead.primary_email,
              FirstName: lead.first_name || '',
              LastName: lead.last_name || leadDisplayName(lead),
              Company: lead.company || 'Unknown',
              Status: lead.status === 'Qualified' ? 'Qualified' : 'Open - Not Contacted',
            }),
          });

          if (res.ok) {
            const data = await res.json();
            return { status: 'pass', message: `Synced "${leadDisplayName(lead)}" to Salesforce (ID: ${data.id})` };
          }
          const errBody = await res.json().catch(() => ({}));
          const errMsg = Array.isArray(errBody) ? errBody.map((e: any) => e.message).join('; ') : (errBody as any).message || String(res.status);
          return { status: 'fail', message: `Salesforce sync failed: ${errMsg}` };
        }
      } catch (err) {
        return { status: 'fail', message: `CRM sync failed: ${(err as Error).message}` };
      }
    }


    default:
      return { status: 'pass', message: `Action "${node.title}" executed (type: ${actionType})` };
  }
}

function inferActionType(node: WorkflowNode): string {
  const title = node.title.toLowerCase();
  if (title.includes('email') || title.includes('send')) return 'send_email';
  if (title.includes('status') || title.includes('update')) return 'update_status';
  if (title.includes('tag')) return 'add_tag';
  if (title.includes('slack')) return 'notify_slack';
  if (title.includes('crm') || title.includes('hubspot') || title.includes('salesforce')) return 'sync_crm';
  if (title.includes('alert') || title.includes('notify')) return 'create_alert';
  if (title.includes('assign')) return 'assign_user';
  return 'generic';
}

function evaluateCondition(
  node: WorkflowNode,
  lead: Lead
): { status: 'pass' | 'skip'; message: string } {
  const field = node.config.field as string;
  const operator = node.config.operator as string;
  const value = node.config.value;

  let leadValue: any;
  switch (field) {
    case 'score':
      leadValue = lead.score;
      break;
    case 'status':
      leadValue = lead.status;
      break;
    case 'company':
      leadValue = lead.company;
      break;
    default:
      leadValue = (lead as any)[field];
  }

  let passed = false;
  const numValue = Number(value);
  const numLeadValue = Number(leadValue);

  switch (operator) {
    case 'gt':
      passed = numLeadValue > numValue;
      break;
    case 'lt':
      passed = numLeadValue < numValue;
      break;
    case 'eq':
      passed = String(leadValue) === String(value);
      break;
    default:
      passed = true;
  }

  if (passed) {
    return { status: 'pass', message: `Condition met: ${field} (${leadValue}) ${operator} ${value}` };
  }
  return { status: 'skip', message: `Condition not met: ${field} (${leadValue}) ${operator} ${value} — skipping downstream nodes` };
}

// ─── Execution Log Queries ───

export async function getExecutionLog(
  userId: string,
  limit = 50
): Promise<ExecutionLogEntry[]> {
  const { data, error } = await supabase
    .from('workflow_executions')
    .select(`
      id, status, steps, started_at, completed_at, lead_id,
      workflows!inner(name)
    `)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch execution log:', error.message);
    return [];
  }

  // Collect lead IDs
  const leadIds = [...new Set((data || []).map((d: any) => d.lead_id).filter(Boolean))];
  let leadMap = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, first_name, last_name')
      .in('id', leadIds);
    if (leads) {
      leadMap = new Map(leads.map((l: any) => [l.id, [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Unknown']));
    }
  }

  const entries: ExecutionLogEntry[] = [];
  for (const row of data || []) {
    const wfName = (row as any).workflows?.name || 'Unknown Workflow';
    const leadName = leadMap.get(row.lead_id) || 'Unknown Lead';
    const stepsArr: ExecutionStepResult[] = (row.steps as ExecutionStepResult[]) || [];

    // Create one entry per step
    for (const step of stepsArr) {
      entries.push({
        id: `${row.id}-${step.nodeId}`,
        timestamp: row.started_at,
        workflowName: wfName,
        leadName,
        step: step.nodeTitle,
        status: step.status === 'pass' ? 'success' : step.status === 'fail' ? 'failed' : 'skipped',
        duration: step.durationMs / 1000,
      });
    }
  }

  return entries.slice(0, limit);
}

export async function getNodeAnalytics(
  workflowId: string
): Promise<NodePerformanceMetric[]> {
  const { data, error } = await supabase
    .from('workflow_executions')
    .select('steps, started_at')
    .eq('workflow_id', workflowId)
    .order('started_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];

  const nodeMap = new Map<string, {
    nodeTitle: string;
    nodeType: 'trigger' | 'action' | 'condition' | 'wait';
    executions: number;
    successes: number;
    totalDuration: number;
    lastRun: string;
  }>();

  for (const row of data) {
    const steps: ExecutionStepResult[] = (row.steps as ExecutionStepResult[]) || [];
    for (const step of steps) {
      const existing = nodeMap.get(step.nodeId) || {
        nodeTitle: step.nodeTitle,
        nodeType: step.nodeType,
        executions: 0,
        successes: 0,
        totalDuration: 0,
        lastRun: row.started_at,
      };
      existing.executions++;
      if (step.status === 'pass') existing.successes++;
      existing.totalDuration += step.durationMs;
      if (row.started_at > existing.lastRun) existing.lastRun = row.started_at;
      nodeMap.set(step.nodeId, existing);
    }
  }

  return Array.from(nodeMap.values()).map(n => ({
    nodeTitle: n.nodeTitle,
    nodeType: n.nodeType,
    executions: n.executions,
    successRate: n.executions > 0 ? Math.round((n.successes / n.executions) * 100) : 0,
    avgDuration: n.executions > 0 ? parseFloat((n.totalDuration / n.executions / 1000).toFixed(1)) : 0,
    lastRun: n.lastRun,
  }));
}

// ─── Timing & Fallback Helpers ───

export function calculateScheduledTime(timing: string): Date {
  const now = new Date();
  const result = new Date(now);

  switch (timing) {
    case 'morning': {
      // Next 9:00 AM
      result.setHours(9, 0, 0, 0);
      if (result <= now) result.setDate(result.getDate() + 1);
      break;
    }
    case 'afternoon': {
      // Next 2:00 PM
      result.setHours(14, 0, 0, 0);
      if (result <= now) result.setDate(result.getDate() + 1);
      break;
    }
    case 'optimal': {
      // Next business day 10:30 AM
      result.setHours(10, 30, 0, 0);
      if (result <= now) result.setDate(result.getDate() + 1);
      // Skip weekends
      const day = result.getDay();
      if (day === 0) result.setDate(result.getDate() + 1); // Sunday → Monday
      if (day === 6) result.setDate(result.getDate() + 2); // Saturday → Monday
      break;
    }
    default:
      // immediate — shouldn't reach here, but return now
      break;
  }

  return result;
}

async function executeFallback(
  action: string,
  node: WorkflowNode,
  lead: Lead,
  userId: string,
  errorMsg: string,
  emailContent?: { subject: string; htmlBody: string }
): Promise<{ status: 'pass' | 'fail'; message: string }> {
  switch (action) {
    case 'create_alert': {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'AUTOMATION_ALERT',
        details: `Fallback alert: Email to ${leadDisplayName(lead)} (${lead.primary_email}) failed at node "${node.title}". Error: ${errorMsg}`,
      });
      return { status: 'pass', message: `Email failed but fallback alert created. Error: ${errorMsg}` };
    }

    case 'create_task': {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        action: 'AUTOMATION_TASK_CREATED',
        details: `Fallback task: Manually send email to ${leadDisplayName(lead)} (${lead.primary_email}). Original node: "${node.title}". Error: ${errorMsg}`,
      });
      return { status: 'pass', message: `Email failed but follow-up task created. Error: ${errorMsg}` };
    }

    case 'retry': {
      // Schedule retry in 1 hour
      const retryAt = new Date(Date.now() + 60 * 60 * 1000);
      if (emailContent) {
        const { error } = await supabase.from('scheduled_emails').insert({
          owner_id: userId,
          lead_id: lead.id,
          to_email: lead.primary_email,
          subject: emailContent.subject,
          html_body: emailContent.htmlBody,
          scheduled_at: retryAt.toISOString(),
          block_index: 0,
          sequence_id: `retry-${node.id}-${Date.now()}`,
          status: 'pending',
        });
        if (error) {
          return { status: 'fail', message: `Email failed and retry scheduling also failed: ${error.message}` };
        }
      }
      return { status: 'pass', message: `Email failed but retry scheduled for ${retryAt.toLocaleString()}. Error: ${errorMsg}` };
    }

    case 'skip':
    default:
      return { status: 'pass', message: `Email failed, skipping per fallback config. Error: ${errorMsg}` };
  }
}

export async function getWorkflowStats(userId: string): Promise<{
  totalWorkflows: number;
  activeWorkflows: number;
  totalExecutions: number;
  totalLeadsProcessed: number;
  successRate: number;
}> {
  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, status, stats')
    .eq('user_id', userId);

  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('status')
    .eq('user_id', userId);

  const wfs = workflows || [];
  const execs = executions || [];
  const successExecs = execs.filter((e: any) => e.status === 'success').length;

  return {
    totalWorkflows: wfs.length,
    activeWorkflows: wfs.filter((w: any) => w.status === 'active').length,
    totalExecutions: execs.length,
    totalLeadsProcessed: wfs.reduce((sum: number, w: any) => sum + ((w.stats as any)?.leadsProcessed || 0), 0),
    successRate: execs.length > 0 ? Math.round((successExecs / execs.length) * 100) : 0,
  };
}

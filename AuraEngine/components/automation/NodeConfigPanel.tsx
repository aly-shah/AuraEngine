import React from 'react';
import {
  BoltIcon, ZapIcon, GitBranchIcon, ClockIcon, CogIcon, BrainIcon,
  ShieldIcon, SparklesIcon, AlertTriangleIcon,
} from '../Icons';
import { NODE_TYPE_META, TRIGGER_OPTIONS, ACTION_OPTIONS, EMAIL_TEMPLATES, MODEL_OPTIONS, OPERATOR_OPTIONS } from './constants';
import type { WorkflowNode, NodeType } from './types';
import type { IntegrationStatus } from '../../lib/integrations';

const getNodeIcon = (type: NodeType) => {
  switch (type) {
    case 'trigger': return <BoltIcon className="w-4 h-4" />;
    case 'action': return <ZapIcon className="w-4 h-4" />;
    case 'condition': return <GitBranchIcon className="w-4 h-4" />;
    case 'wait': return <ClockIcon className="w-4 h-4" />;
  }
};

interface NodeConfigPanelProps {
  selectedNode: WorkflowNode | null;
  onUpdateConfig: (nodeId: string, key: string, value: string | number | boolean) => void;
  onUpdateTitle: (nodeId: string, title: string) => void;
  onUpdateDescription: (nodeId: string, description: string) => void;
  onMoveNode: (nodeId: string, direction: 'up' | 'down') => void;
  integrationStatuses: IntegrationStatus[];
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
  selectedNode,
  onUpdateConfig,
  onUpdateTitle,
  onUpdateDescription,
  onMoveNode,
  integrationStatuses,
}) => {
  if (!selectedNode) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
          <CogIcon className="w-7 h-7 text-slate-300" />
        </div>
        <h3 className="font-bold text-slate-700 text-sm">Step Configuration</h3>
        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
          Select a step in the workflow canvas to configure templates, AI personalization, timing, and fallback actions.
        </p>
      </div>
    );
  }

  const meta = NODE_TYPE_META[selectedNode.type];

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bgClass}`}>
              {getNodeIcon(selectedNode.type)}
            </div>
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
              {meta.label} Config
            </span>
          </div>
          <div className="flex items-center space-x-1">
            <button onClick={() => onMoveNode(selectedNode.id, 'up')} className="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Move up">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
            </button>
            <button onClick={() => onMoveNode(selectedNode.id, 'down')} className="p-1 text-slate-400 hover:text-slate-600 transition-colors" title="Move down">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-600 mb-1">Step Name</label>
          <input type="text" value={selectedNode.title} onChange={e => onUpdateTitle(selectedNode.id, e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-600 mb-1">Description</label>
          <textarea value={selectedNode.description} onChange={e => onUpdateDescription(selectedNode.id, e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none" />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-black text-slate-500 uppercase tracking-wider">Settings</p>

          {/* Trigger Config */}
          {selectedNode.type === 'trigger' && (
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Trigger Event</label>
              <select value={selectedNode.config.triggerType as string || 'lead_created'} onChange={e => onUpdateConfig(selectedNode.id, 'triggerType', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                {TRIGGER_OPTIONS.map(t => (<option key={t.type} value={t.type}>{t.label}</option>))}
              </select>
            </div>
          )}

          {/* Action Config */}
          {selectedNode.type === 'action' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Action Type</label>
                <select value={selectedNode.config.actionType as string || 'send_email'} onChange={e => onUpdateConfig(selectedNode.id, 'actionType', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  {ACTION_OPTIONS.map(a => (<option key={a.type} value={a.type}>{a.label}</option>))}
                </select>
              </div>

              {/* Send Email Config */}
              {(selectedNode.config.actionType as string || 'send_email') === 'send_email' && (
                <SendEmailConfig node={selectedNode} onUpdateConfig={onUpdateConfig} />
              )}

              {/* Simple field configs */}
              {(selectedNode.config.actionType as string) === 'update_status' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">New Status</label>
                  <select value={selectedNode.config.newStatus as string || 'Contacted'} onChange={e => onUpdateConfig(selectedNode.id, 'newStatus', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                    <option value="Contacted">Contacted</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Converted">Converted</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
              )}

              {(selectedNode.config.actionType as string) === 'add_tag' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Tag Name</label>
                  <input type="text" value={(selectedNode.config.tag as string) || ''} onChange={e => onUpdateConfig(selectedNode.id, 'tag', e.target.value)} placeholder="e.g. Hot Lead, VIP, Nurture" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              )}

              {(selectedNode.config.actionType as string) === 'assign_user' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Assign To</label>
                  <input type="text" value={(selectedNode.config.assignee as string) || ''} onChange={e => onUpdateConfig(selectedNode.id, 'assignee', e.target.value)} placeholder="e.g. sales@company.com" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              )}

              {/* Slack Config */}
              {(selectedNode.config.actionType as string) === 'notify_slack' && (
                <SlackConfig node={selectedNode} onUpdateConfig={onUpdateConfig} integrationStatuses={integrationStatuses} />
              )}

              {/* CRM Config */}
              {(selectedNode.config.actionType as string) === 'sync_crm' && (
                <CrmConfig node={selectedNode} onUpdateConfig={onUpdateConfig} integrationStatuses={integrationStatuses} />
              )}

            </>
          )}

          {/* Condition Config */}
          {selectedNode.type === 'condition' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Field</label>
                <select value={selectedNode.config.field as string || 'score'} onChange={e => onUpdateConfig(selectedNode.id, 'field', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="score">Lead Score</option>
                  <option value="status">Lead Status</option>
                  <option value="email_opened">Email Opened</option>
                  <option value="email_clicked">Email Clicked</option>
                  <option value="visited_pricing">Visited Pricing Page</option>
                  <option value="engagement">Engagement Level</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Operator</label>
                  <select value={selectedNode.config.operator as string || 'gt'} onChange={e => onUpdateConfig(selectedNode.id, 'operator', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                    {OPERATOR_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Value</label>
                  <input type="number" value={selectedNode.config.value as number || 50} onChange={e => onUpdateConfig(selectedNode.id, 'value', parseInt(e.target.value) || 0)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              </div>
              <label className="flex items-center space-x-2 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" checked={!!selectedNode.config.onlyIfNoEmail} onChange={e => onUpdateConfig(selectedNode.id, 'onlyIfNoEmail', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span>Only if lead hasn't received email</span>
              </label>
            </>
          )}

          {/* Wait Config */}
          {selectedNode.type === 'wait' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Wait Duration (days)</label>
                <input type="number" min={1} value={selectedNode.config.days as number || 1} onChange={e => onUpdateConfig(selectedNode.id, 'days', parseInt(e.target.value) || 1)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div className="p-3 bg-violet-50 rounded-xl border border-violet-200">
                <div className="flex items-center space-x-2 mb-1">
                  <ClockIcon className="w-3.5 h-3.5 text-violet-600" />
                  <p className="text-[10px] font-black text-violet-700 uppercase tracking-wider">How Wait Works</p>
                </div>
                <p className="text-[10px] text-violet-600 leading-relaxed">
                  In manual runs, wait nodes are acknowledged but execution continues immediately. In scheduled/automated runs, the wait duration is respected.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pro Tip */}
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-200 p-5">
        <div className="flex items-center space-x-2 mb-2">
          <SparklesIcon className="w-4 h-4 text-violet-600" />
          <p className="text-xs font-black text-violet-700 uppercase tracking-wider">Pro Tip</p>
        </div>
        <p className="text-xs text-violet-600 leading-relaxed">
          Use AI to optimize your workflow. Click the <strong>AI Optimize</strong> button above the canvas to get intelligent suggestions for improving performance.
        </p>
      </div>
    </>
  );
};

// ─── Sub-components ───

const SendEmailConfig: React.FC<{ node: WorkflowNode; onUpdateConfig: (id: string, key: string, value: string | number | boolean) => void }> = ({ node, onUpdateConfig }) => (
  <>
    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1">Email Template</label>
      <select value={node.config.template as string || 'welcome'} onChange={e => onUpdateConfig(node.id, 'template', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
        {EMAIL_TEMPLATES.map(t => (<option key={t.id} value={t.id}>{t.label}</option>))}
      </select>
      <p className="text-[10px] text-slate-400 mt-1">{EMAIL_TEMPLATES.find(t => t.id === (node.config.template as string))?.desc}</p>
    </div>

    {(node.config.template as string) === '__custom__' && (
      <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Subject Line</label>
          <input type="text" value={(node.config.customSubject as string) || ''} onChange={e => onUpdateConfig(node.id, 'customSubject', e.target.value)} placeholder="e.g. Hi {{first_name}}, quick question about {{company}}" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1">Email Body (HTML)</label>
          <textarea value={(node.config.customBody as string) || ''} onChange={e => onUpdateConfig(node.id, 'customBody', e.target.value)} placeholder="<p>Hi {{first_name}},</p><p>Your message here...</p>" rows={5} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" />
        </div>
        <p className="text-[10px] text-slate-400">
          Tags: {'{{first_name}}'}, {'{{company}}'}, {'{{industry}}'}, {'{{ai_insight}}'}, {'{{your_name}}'}, {'{{sender_company}}'}
        </p>
        {!(node.config.customSubject as string) && <p className="text-[10px] text-amber-600 font-semibold">Warning: Subject line is empty</p>}
        {!(node.config.customBody as string) && <p className="text-[10px] text-amber-600 font-semibold">Warning: Email body is empty</p>}
      </div>
    )}

    <label className="flex items-center justify-between p-3 bg-violet-50 rounded-xl border border-violet-200 cursor-pointer group">
      <div className="flex items-center space-x-2">
        <BrainIcon className="w-4 h-4 text-violet-600" />
        <div>
          <span className="text-xs font-bold text-violet-700">AI Personalization</span>
          <p className="text-[10px] text-violet-500">Tailor content per lead</p>
        </div>
      </div>
      <input type="checkbox" checked={!!node.config.aiPersonalization} onChange={e => onUpdateConfig(node.id, 'aiPersonalization', e.target.checked)} className="w-4 h-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500" />
    </label>

    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1">Timing</label>
      <select value={node.config.timing as string || 'immediate'} onChange={e => onUpdateConfig(node.id, 'timing', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
        <option value="immediate">Send immediately</option>
        <option value="optimal">AI optimal time</option>
        <option value="morning">Next morning (9 AM)</option>
        <option value="afternoon">Next afternoon (2 PM)</option>
      </select>
    </div>

    <div>
      <label className="block text-xs font-bold text-slate-600 mb-1">Use Model</label>
      <select value={node.config.model as string || 'gemini-3-flash'} onChange={e => onUpdateConfig(node.id, 'model', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
        {MODEL_OPTIONS.map(m => (<option key={m} value={m}>{m}</option>))}
      </select>
    </div>

    <label className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-200 cursor-pointer">
      <div className="flex items-center space-x-2">
        <ShieldIcon className="w-4 h-4 text-amber-600" />
        <div>
          <span className="text-xs font-bold text-amber-700">Fallback Action</span>
          <p className="text-[10px] text-amber-500">If this step fails</p>
        </div>
      </div>
      <input type="checkbox" checked={!!node.config.fallbackEnabled} onChange={e => onUpdateConfig(node.id, 'fallbackEnabled', e.target.checked)} className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
    </label>

    {node.config.fallbackEnabled && (
      <select value={node.config.fallbackAction as string || 'create_task'} onChange={e => onUpdateConfig(node.id, 'fallbackAction', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
        <option value="create_task">Create a follow-up task</option>
        <option value="create_alert">Create an alert</option>
        <option value="retry">Retry after 1 hour</option>
        <option value="skip">Skip and continue</option>
      </select>
    )}
  </>
);

const SlackConfig: React.FC<{ node: WorkflowNode; onUpdateConfig: (id: string, key: string, value: string | number | boolean) => void; integrationStatuses: IntegrationStatus[] }> = ({ node, onUpdateConfig, integrationStatuses }) => {
  const slackConnected = integrationStatuses.some(i => i.provider === 'slack' && i.status === 'connected');
  return (
    <>
      {slackConnected ? (
        <div className="flex items-center space-x-2 px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Slack connected</span>
        </div>
      ) : (
        <div className="flex items-center space-x-2 px-3 py-2 bg-rose-50 rounded-xl border border-rose-200 text-xs font-bold text-rose-700">
          <AlertTriangleIcon className="w-3.5 h-3.5" />
          <span>Connect Slack in Integration Hub to use this action</span>
        </div>
      )}
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">Message Template</label>
        <textarea
          value={(node.config.messageTemplate as string) || ''}
          onChange={e => onUpdateConfig(node.id, 'messageTemplate', e.target.value)}
          placeholder="*New lead:* {{first_name}} from {{company}} (Score: {{score}})"
          rows={3}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
        />
        <p className="text-[10px] text-slate-400 mt-1">Leave blank for default format. Supports Slack markdown and {'{{tags}}'}.</p>
      </div>
    </>
  );
};

const CrmConfig: React.FC<{ node: WorkflowNode; onUpdateConfig: (id: string, key: string, value: string | number | boolean) => void; integrationStatuses: IntegrationStatus[] }> = ({ node, onUpdateConfig, integrationStatuses }) => {
  const hubspotConnected = integrationStatuses.some(i => i.provider === 'hubspot' && i.status === 'connected');
  const salesforceConnected = integrationStatuses.some(i => i.provider === 'salesforce' && i.status === 'connected');
  const anyConnected = hubspotConnected || salesforceConnected;
  return (
    <>
      {anyConnected ? (
        <div className="flex items-center space-x-2 px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>{hubspotConnected && salesforceConnected ? 'HubSpot & Salesforce' : hubspotConnected ? 'HubSpot' : 'Salesforce'} connected</span>
        </div>
      ) : (
        <div className="flex items-center space-x-2 px-3 py-2 bg-rose-50 rounded-xl border border-rose-200 text-xs font-bold text-rose-700">
          <AlertTriangleIcon className="w-3.5 h-3.5" />
          <span>Connect a CRM in Integration Hub to use this action</span>
        </div>
      )}
      <div>
        <label className="block text-xs font-bold text-slate-600 mb-1">CRM Provider</label>
        <select value={node.config.crmProvider as string || 'hubspot'} onChange={e => onUpdateConfig(node.id, 'crmProvider', e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="hubspot">HubSpot</option>
          <option value="salesforce">Salesforce</option>
        </select>
      </div>
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Field Mapping</p>
        <div className="space-y-1 text-xs text-slate-600">
          <div className="flex justify-between"><span>Email</span><span className="text-slate-400">lead.email</span></div>
          <div className="flex justify-between"><span>First Name</span><span className="text-slate-400">lead.name (first)</span></div>
          <div className="flex justify-between"><span>Last Name</span><span className="text-slate-400">lead.name (last)</span></div>
          <div className="flex justify-between"><span>Company</span><span className="text-slate-400">lead.company</span></div>
          <div className="flex justify-between"><span>Status</span><span className="text-slate-400">lead.status</span></div>
        </div>
      </div>
    </>
  );
};


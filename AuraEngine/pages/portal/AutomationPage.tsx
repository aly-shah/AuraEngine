import React from 'react';
import { useOutletContext } from 'react-router-dom';
import type { User } from '../../types';
import {
  PlusIcon, CheckIcon, GitBranchIcon, ArrowLeftIcon, ArrowRightIcon,
  SendIcon, KeyboardIcon, XIcon, CopyIcon,
  ActivityIcon, ShieldIcon, PieChartIcon, TrendUpIcon, BoltIcon, MailIcon,
} from '../../components/Icons';
import { PageHeader } from '../../components/layout/PageHeader';
import { AdvancedOnly } from '../../components/ui-mode';
import { useAutomationWorkflow } from '../../hooks/useAutomationWorkflow';
import { HEADER_PANEL_BUTTONS, WORKFLOW_STATUS_STYLES } from '../../components/automation/constants';

// ─── Components ───
import { KpiStatsBar } from '../../components/automation/KpiStatsBar';
import { WizardStepIndicator } from '../../components/automation/WizardStepIndicator';
import { WizardStep1 } from '../../components/automation/WizardStep1';
import { WizardStep3 } from '../../components/automation/WizardStep3';
import { WizardStep4 } from '../../components/automation/WizardStep4';
import { WorkflowCanvas } from '../../components/automation/WorkflowCanvas';
import { NodeConfigPanel } from '../../components/automation/NodeConfigPanel';
import { TargetLeadsPanel } from '../../components/automation/TargetLeadsPanel';
import { WorkflowAnalyticsBar } from '../../components/automation/WorkflowAnalyticsBar';

// ─── Drawers & Modal ───
import { ExecutionLogDrawer } from '../../components/automation/ExecutionLogDrawer';
import { NodeAnalyticsDrawer } from '../../components/automation/NodeAnalyticsDrawer';
import { HealthPanelDrawer } from '../../components/automation/HealthPanelDrawer';
import { ROICalculatorDrawer } from '../../components/automation/ROICalculatorDrawer';
import { TriggerAnalyticsDrawer } from '../../components/automation/TriggerAnalyticsDrawer';
import { TemplateEffectivenessDrawer } from '../../components/automation/TemplateEffectivenessDrawer';
import { CampaignsDrawer } from '../../components/automation/CampaignsDrawer';
import { KeyboardShortcutsModal } from '../../components/automation/KeyboardShortcutsModal';

interface LayoutContext {
  user: User;
  refreshProfile: () => Promise<void>;
}

// ─── Icon lookup for header panel buttons ───
const PANEL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  activity: ActivityIcon,
  shield: ShieldIcon,
  pieChart: PieChartIcon,
  trendUp: TrendUpIcon,
  bolt: BoltIcon,
  mail: MailIcon,
  send: SendIcon,
};

export default function AutomationPage() {
  const { user } = useOutletContext<LayoutContext>();
  const h = useAutomationWorkflow(user?.id);
  const [showPanelsMenu, setShowPanelsMenu] = React.useState(false);

  const sc = WORKFLOW_STATUS_STYLES[h.workflow.status];

  return (
    <div className="space-y-5">

      {/* ═══ HEADER BAR ═══ */}
      <PageHeader
        title="Automations"
        actions={
          <>
            {h.wizardActive && (
              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-black uppercase tracking-wider">
                Wizard Mode
              </span>
            )}
            {!h.wizardActive && (
              <button
                onClick={h.startWizard}
                className="flex items-center space-x-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Create New</span>
              </button>
            )}
          </>
        }
        advancedActions={
          <>
            {/* Panels dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPanelsMenu(prev => !prev)}
                className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
              >
                <ActivityIcon className="w-3.5 h-3.5" />
                <span>Panels</span>
                <svg className="w-3 h-3 ml-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </button>
              {showPanelsMenu && (
                <div className="absolute right-0 top-10 bg-white border border-slate-200 rounded-xl shadow-xl z-30 w-52 py-1">
                  {HEADER_PANEL_BUTTONS.map(btn => {
                    const isActive = h.panelVisibility[btn.panel];
                    const Icon = PANEL_ICONS[btn.iconName];
                    return (
                      <button
                        key={btn.panel}
                        onClick={() => { h.togglePanel(btn.panel); setShowPanelsMenu(false); }}
                        className={`w-full text-left px-3 py-2.5 text-xs font-bold transition-colors flex items-center space-x-2.5 ${
                          isActive ? `${btn.activeColor} ${btn.activeBg}` : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {Icon && <Icon className="w-4 h-4" />}
                        <span>{btn.label}</span>
                        {isActive && <CheckIcon className="w-3.5 h-3.5 ml-auto" />}
                      </button>
                    );
                  })}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={() => { h.togglePanel('shortcuts'); setShowPanelsMenu(false); }}
                      className="w-full text-left px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors flex items-center space-x-2.5"
                    >
                      <KeyboardIcon className="w-4 h-4" />
                      <span>Shortcuts</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Workflow Switcher */}
            <div className="relative">
              <button
                onClick={() => h.setShowWorkflowList(!h.showWorkflowList)}
                className="flex items-center space-x-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
              >
                <GitBranchIcon className="w-3.5 h-3.5" />
                <span>{h.workflows.length} Workflows</span>
              </button>
              {h.showWorkflowList && (
                <div className="absolute right-0 top-12 bg-white border border-slate-200 rounded-xl shadow-xl z-30 w-72 py-2">
                  {h.workflows.map(wf => (
                    <div
                      key={wf.id}
                      className={`flex items-center px-4 py-2.5 hover:bg-slate-50 transition-colors ${
                        wf.id === h.workflow.id ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <button
                        onClick={() => h.loadWorkflow(wf)}
                        className={`flex-1 text-left text-sm ${
                          wf.id === h.workflow.id ? 'text-indigo-700 font-bold' : 'text-slate-600'
                        }`}
                      >
                        <span className="font-semibold">{wf.name}</span>
                        <span className={`ml-2 text-[10px] font-bold uppercase ${wf.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {wf.status}
                        </span>
                      </button>
                      <div className="flex items-center space-x-1 shrink-0 ml-2">
                        <button
                          onClick={e => { e.stopPropagation(); h.handleDuplicateWorkflow(wf); }}
                          className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                          title="Duplicate"
                        >
                          <CopyIcon className="w-3.5 h-3.5" />
                        </button>
                        {wf.id !== h.workflow.id && (
                          <button
                            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${wf.name}"?`)) h.handleDeleteWorkflow(wf.id); }}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Delete"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      onClick={h.startWizard}
                      className="w-full text-left px-4 py-2.5 text-sm text-indigo-600 font-bold hover:bg-indigo-50 transition-colors flex items-center space-x-2"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      <span>Create New</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        }
      />

      {/* ═══ KPI STATS ═══ */}
      <KpiStatsBar stats={h.kpiStats} />

      {/* ═══ WIZARD STEP INDICATOR ═══ */}
      {h.wizardActive && (
        <WizardStepIndicator
          currentStep={h.wizardStep}
          onStepClick={h.setWizardStep}
          wizardTrigger={h.wizardTrigger}
        />
      )}

      {/* ═══ WIZARD STEP 1 ═══ */}
      {h.wizardActive && h.wizardStep === 1 && (
        <WizardStep1
          wizardName={h.wizardName}
          wizardDescription={h.wizardDescription}
          wizardTrigger={h.wizardTrigger}
          onNameChange={h.setWizardName}
          onDescriptionChange={h.setWizardDescription}
          onTriggerSelect={h.setWizardTrigger}
          onCancel={() => h.setWizardActive(false)}
          onNext={() => { h.handleWizardCreate(); h.setWizardStep(2); }}
        />
      )}

      {/* ═══ WIZARD STEP 2 / MAIN BUILDER ═══ */}
      {(!h.wizardActive || h.wizardStep === 2) && (
        <>
          {/* Builder Header (non-wizard) */}
          {!h.wizardActive && (
            <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4">
              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  value={h.workflow.name}
                  onChange={e => h.setWorkflow(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-transparent border-0 outline-none text-lg font-black text-slate-900 font-heading w-72"
                  placeholder="Workflow name"
                />
                <button
                  onClick={h.toggleWorkflowStatus}
                  className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${sc.bg} ${sc.text}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${h.workflow.status === 'active' ? 'animate-pulse' : ''}`}></span>
                  <span>{h.workflow.status}</span>
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button onClick={h.handleSave} className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm">
                  <CheckIcon className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Save</span>
                </button>
                <button onClick={h.handleTest} disabled={h.testRunning} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50">
                  {h.testRunning ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <SendIcon className="w-3.5 h-3.5" />}
                  <span>{h.testRunning ? 'Sending...' : 'Send Campaign'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Wizard Step 2 Header */}
          {h.wizardActive && h.wizardStep === 2 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900 font-heading">{h.workflow.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Drag nodes from the palette to build your workflow. Click any node to configure it.</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button onClick={() => h.setWizardStep(1)} className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
                    <ArrowLeftIcon className="w-3.5 h-3.5" /><span>Back</span>
                  </button>
                  <button
                    onClick={() => h.setWizardStep(3)}
                    disabled={h.workflow.nodes.length < 2}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-40"
                  >
                    <span>Next: Configure</span>
                    <ArrowRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Canvas + Config */}
          <div className="flex flex-col lg:flex-row gap-5">
            <div className="lg:w-[70%]" data-guide="automation-canvas">
              <WorkflowCanvas
                workflow={h.workflow}
                selectedNodeId={h.selectedNodeId}
                onSelectNode={h.setSelectedNodeId}
                onRemoveNode={h.removeNode}
                onAddNode={h.addNode}
                onReorderNodes={h.reorderNodes}
                onAiOptimize={h.handleAiOptimize}
                aiOptimizing={h.aiOptimizing}
                aiSuggestions={h.aiSuggestions}
                onDismissSuggestions={() => h.setAiSuggestions([])}
                integrationStatuses={h.integrationStatuses}
              />
            </div>
            <div className="lg:w-[30%]" data-guide="automation-config">
              <NodeConfigPanel
                selectedNode={h.selectedNode}
                onUpdateConfig={h.updateNodeConfig}
                onUpdateTitle={h.updateNodeTitle}
                onUpdateDescription={h.updateNodeDescription}
                onMoveNode={h.moveNode}
                integrationStatuses={h.integrationStatuses}
              />
            </div>
          </div>
        </>
      )}

      {/* ═══ TARGET LEADS ═══ */}
      {(!h.wizardActive || h.wizardStep === 2) && (
        <TargetLeadsPanel
          leads={h.leads}
          filteredLeads={h.filteredLeads}
          leadsWithEmail={h.leadsWithEmail}
          testLeadIds={h.testLeadIds}
          selectedLeadCount={h.selectedLeadCount}
          allFilteredSelected={h.allFilteredSelected}
          showLeadPanel={h.showLeadPanel}
          leadScoreFilter={h.leadScoreFilter}
          leadStatusFilter={h.leadStatusFilter}
          emailSummaryMap={h.emailSummaryMap}
          onTogglePanel={() => h.setShowLeadPanel(s => !s)}
          onScoreFilterChange={h.setLeadScoreFilter}
          onStatusFilterChange={h.setLeadStatusFilter}
          onToggleLead={h.toggleTestLead}
          onSelectAll={h.selectAllFilteredLeads}
          onDeselectAll={h.deselectAllLeads}
        />
      )}

      {/* ═══ WIZARD STEP 3 ═══ */}
      {h.wizardActive && h.wizardStep === 3 && (
        <WizardStep3
          workflow={h.workflow}
          onBack={() => h.setWizardStep(2)}
          onNext={() => h.setWizardStep(4)}
          onEditNode={(nodeId) => { h.setSelectedNodeId(nodeId); h.setWizardStep(2); }}
        />
      )}

      {/* ═══ WIZARD STEP 4 ═══ */}
      {h.wizardActive && h.wizardStep === 4 && (
        <WizardStep4
          leads={h.leads}
          testLeadIds={h.testLeadIds}
          selectedLeadCount={h.selectedLeadCount}
          allFilteredSelected={h.allFilteredSelected}
          emailSummaryMap={h.emailSummaryMap}
          testRunning={h.testRunning}
          testResults={h.testResults}
          validations={h.validations}
          validating={h.validating}
          activationMode={h.activationMode}
          scheduleDate={h.scheduleDate}
          scheduleTime={h.scheduleTime}
          segmentFilter={h.segmentFilter}
          monitorAlerts={h.monitorAlerts}
          onBack={() => h.setWizardStep(3)}
          onToggleLead={h.toggleTestLead}
          onSelectAll={h.selectAllFilteredLeads}
          onDeselectAll={h.deselectAllLeads}
          onTest={h.handleTest}
          onValidate={h.runValidation}
          onSave={h.handleSave}
          onActivate={h.handleActivate}
          onActivationModeChange={h.setActivationMode}
          onScheduleDateChange={h.setScheduleDate}
          onScheduleTimeChange={h.setScheduleTime}
          onSegmentFilterChange={h.setSegmentFilter}
          onMonitorAlertsChange={h.setMonitorAlerts}
        />
      )}

      {/* ═══ WORKFLOW ANALYTICS BAR ═══ */}
      <AdvancedOnly>
        {(!h.wizardActive || h.wizardStep === 2) && (
          <div data-guide="automation-analytics">
            <WorkflowAnalyticsBar
              workflow={h.workflow}
              executionLog={h.executionLog}
            />
          </div>
        )}
      </AdvancedOnly>

      {/* ═══ DRAWERS & MODAL ═══ */}
      <ExecutionLogDrawer
        open={h.panelVisibility.executionLog}
        onClose={() => h.closePanel('executionLog')}
        executionLog={h.executionLog}
        onRefresh={h.refreshExecutionLog}
      />
      <NodeAnalyticsDrawer
        open={h.panelVisibility.nodeAnalytics}
        onClose={() => h.closePanel('nodeAnalytics')}
        workflowName={h.workflow.name}
        nodePerformance={h.nodePerformance}
        workflowNodes={h.workflow.nodes}
      />
      <HealthPanelDrawer
        open={h.panelVisibility.healthPanel}
        onClose={() => h.closePanel('healthPanel')}
        workflowHealth={h.workflowHealth}
      />
      <ROICalculatorDrawer
        open={h.panelVisibility.roiCalculator}
        onClose={() => h.closePanel('roiCalculator')}
        roiCalculation={h.roiCalculation}
        workflowRoi={h.workflow.stats.roi}
      />
      <TriggerAnalyticsDrawer
        open={h.panelVisibility.triggerAnalytics}
        onClose={() => h.closePanel('triggerAnalytics')}
        triggerAnalytics={h.triggerAnalytics}
      />
      <TemplateEffectivenessDrawer
        open={h.panelVisibility.templateEffectiveness}
        onClose={() => h.closePanel('templateEffectiveness')}
        templateEffectiveness={h.templateEffectiveness}
      />
      <CampaignsDrawer
        open={h.panelVisibility.campaignsPanel}
        onClose={() => h.closePanel('campaignsPanel')}
        history={h.campaignHistory}
        historyLoading={h.campaignHistoryLoading}
        recipients={h.campaignRecipients}
        recipientsLoading={h.campaignRecipientsLoading}
        selectedCampaignId={h.selectedCampaignId}
        onSelectCampaign={h.setSelectedCampaignId}
        onClearRecipients={() => h.setCampaignRecipients([])}
      />
      <KeyboardShortcutsModal
        open={h.panelVisibility.shortcuts}
        onClose={() => h.closePanel('shortcuts')}
      />
    </div>
  );
}

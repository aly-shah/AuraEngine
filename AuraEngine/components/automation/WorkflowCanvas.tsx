import React, { useState, useCallback } from 'react';
import {
  BoltIcon, ZapIcon, GitBranchIcon, ClockIcon, XIcon, CheckIcon,
  BrainIcon, SparklesIcon,
} from '../Icons';
import { NODE_TYPE_META } from './constants';
import type { Workflow, WorkflowNode, NodeType } from './types';
import type { IntegrationStatus } from '../../lib/integrations';

const getNodeIcon = (type: NodeType) => {
  switch (type) {
    case 'trigger': return <BoltIcon className="w-4 h-4" />;
    case 'action': return <ZapIcon className="w-4 h-4" />;
    case 'condition': return <GitBranchIcon className="w-4 h-4" />;
    case 'wait': return <ClockIcon className="w-4 h-4" />;
  }
};

interface WorkflowCanvasProps {
  workflow: Workflow;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onRemoveNode: (id: string) => void;
  onAddNode: (type: NodeType) => void;
  onReorderNodes: (fromIndex: number, toIndex: number) => void;
  onAiOptimize: () => void;
  aiOptimizing: boolean;
  aiSuggestions: string[];
  onDismissSuggestions: () => void;
  integrationStatuses: IntegrationStatus[];
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  workflow,
  selectedNodeId,
  onSelectNode,
  onRemoveNode,
  onAddNode,
  onReorderNodes,
  onAiOptimize,
  aiOptimizing,
  aiSuggestions,
  onDismissSuggestions,
  integrationStatuses,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(idx);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIndex;
    setDragIndex(null);
    setDropIndex(null);
    if (fromIdx !== null && fromIdx !== toIdx) {
      onReorderNodes(fromIdx, toIdx);
    }
  }, [dragIndex, onReorderNodes]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const hasTrigger = workflow.nodes.some(n => n.type === 'trigger');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="font-bold text-slate-800 font-heading text-sm">Visual Workflow</h3>
          <span className="text-xs text-slate-400 font-medium">{workflow.nodes.length} steps</span>
        </div>
        <button
          onClick={onAiOptimize}
          disabled={aiOptimizing}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-[11px] font-bold hover:bg-violet-100 transition-all border border-violet-200 disabled:opacity-50"
        >
          {aiOptimizing ? <div className="w-3 h-3 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin"></div> : <BrainIcon className="w-3.5 h-3.5" />}
          <span>{aiOptimizing ? 'Analyzing...' : 'AI Optimize'}</span>
        </button>
      </div>

      {/* AI Suggestions Banner */}
      {aiSuggestions.length > 0 && (
        <div className="mx-6 mt-4 p-4 bg-violet-50 rounded-xl border border-violet-200">
          <div className="flex items-center space-x-2 mb-2">
            <BrainIcon className="w-4 h-4 text-violet-600" />
            <p className="text-xs font-black text-violet-700 uppercase tracking-wider">AI Suggestions</p>
            <button onClick={onDismissSuggestions} className="ml-auto p-0.5 text-violet-400 hover:text-violet-600">
              <XIcon className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            {aiSuggestions.map((s, i) => (
              <div key={i} className="flex items-start space-x-2">
                <SparklesIcon className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                <p className="text-xs text-violet-700 leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canvas Body */}
      <div className="p-6 min-h-[420px]">
        <div className="flex flex-col items-center space-y-0">
          {workflow.nodes.map((node, idx) => {
            const meta = NODE_TYPE_META[node.type];
            const isSelected = selectedNodeId === node.id;
            const isCond = node.type === 'condition';
            const isDragging = dragIndex === idx;
            const isDropTarget = dropIndex === idx && dragIndex !== idx;

            return (
              <React.Fragment key={node.id}>
                {/* Drop indicator line */}
                {isDropTarget && dragIndex !== null && dragIndex > idx && (
                  <div className="w-full max-w-md h-1 bg-indigo-500 rounded-full my-1 animate-pulse" />
                )}
                <div
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={e => handleDragStart(e, idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onSelectNode(node.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelectNode(node.id); }}
                  className={`w-full max-w-md relative group transition-all cursor-pointer ${
                    isDragging ? 'opacity-40' : ''
                  } ${
                    isSelected ? 'ring-2 ring-indigo-500 ring-offset-2 rounded-xl shadow-lg' : 'hover:shadow-md rounded-xl'
                  }`}
                >
                  <div className={`p-4 rounded-xl border transition-all ${
                    isSelected ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                    <div className="flex items-center space-x-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bgClass}`}>
                        {getNodeIcon(node.type)}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className={`text-[10px] font-black uppercase tracking-wider text-${meta.color}-600`}>
                          {meta.label}
                        </span>
                        <p className="font-bold text-sm text-slate-800 mt-0.5 truncate">{node.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{node.description}</p>
                      </div>
                      {node.config.aiPersonalization && (
                        <span className="shrink-0 px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded text-[9px] font-black">AI</span>
                      )}
                      {node.type === 'action' && (() => {
                        const at = node.config.actionType as string;
                        if (at === 'notify_slack') {
                          const ok = integrationStatuses.some(i => i.provider === 'slack' && i.status === 'connected');
                          return <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-400'}`} title={ok ? 'Slack connected' : 'Slack not connected'} />;
                        }
                        if (at === 'sync_crm') {
                          const prov = node.config.crmProvider as string || 'hubspot';
                          const ok = integrationStatuses.some(i => i.provider === prov && i.status === 'connected');
                          return <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-400'}`} title={ok ? `${prov} connected` : `${prov} not connected`} />;
                        }
                        return null;
                      })()}
                      {isSelected && (
                        <div className="shrink-0">
                          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></div>
                        </div>
                      )}
                    </div>
                    {isCond && (
                      <div className="flex items-center justify-center space-x-8 mt-3 pt-3 border-t border-slate-100">
                        <span className="flex items-center space-x-1.5 text-xs font-bold text-emerald-600">
                          <CheckIcon className="w-3.5 h-3.5" /><span>Yes</span>
                        </span>
                        <span className="flex items-center space-x-1.5 text-xs font-bold text-rose-500">
                          <XIcon className="w-3.5 h-3.5" /><span>No</span>
                        </span>
                      </div>
                    )}
                  </div>
                  {node.type !== 'trigger' && (
                    <div className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); onRemoveNode(node.id); }}
                        className="w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                {idx < workflow.nodes.length - 1 && (
                  <div className="flex flex-col items-center py-1">
                    <div className="w-0.5 h-4 bg-slate-200"></div>
                    <svg className="w-3 h-3 text-slate-300" fill="currentColor" viewBox="0 0 12 12"><path d="M6 9L1 4h10L6 9z" /></svg>
                  </div>
                )}
                {/* Drop indicator line */}
                {isDropTarget && dragIndex !== null && dragIndex < idx && (
                  <div className="w-full max-w-md h-1 bg-indigo-500 rounded-full my-1 animate-pulse" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Node Palette */}
        <div data-guide="automation-palette" className="mt-6 pt-5 border-t border-dashed border-slate-200">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3 text-center">Add to Workflow</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button onClick={() => onAddNode('action')} className="flex flex-col items-center p-3 bg-emerald-50 rounded-xl text-emerald-700 hover:bg-emerald-100 transition-all border border-emerald-200">
              <ZapIcon className="w-5 h-5 mb-1" />
              <span className="text-[11px] font-bold">Action</span>
              <span className="text-[9px] text-emerald-500">Email, Task, Alert</span>
            </button>
            <button onClick={() => onAddNode('condition')} className="flex flex-col items-center p-3 bg-amber-50 rounded-xl text-amber-700 hover:bg-amber-100 transition-all border border-amber-200">
              <GitBranchIcon className="w-5 h-5 mb-1" />
              <span className="text-[11px] font-bold">Condition</span>
              <span className="text-[9px] text-amber-500">If/Then Logic</span>
            </button>
            <button onClick={() => onAddNode('wait')} className="flex flex-col items-center p-3 bg-violet-50 rounded-xl text-violet-700 hover:bg-violet-100 transition-all border border-violet-200">
              <ClockIcon className="w-5 h-5 mb-1" />
              <span className="text-[11px] font-bold">Delay</span>
              <span className="text-[9px] text-violet-500">Wait X Days</span>
            </button>
            <button
              disabled={hasTrigger}
              onClick={() => { if (!hasTrigger) onAddNode('trigger'); }}
              className={`flex flex-col items-center p-3 rounded-xl border transition-all ${
                hasTrigger
                  ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-50'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'
              }`}
            >
              <BoltIcon className="w-5 h-5 mb-1" />
              <span className="text-[11px] font-bold">Trigger</span>
              <span className="text-[9px]">{hasTrigger ? 'Already added' : 'Start Event'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

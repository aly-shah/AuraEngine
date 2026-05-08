import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { User } from '../../types';
import {
  SparklesIcon, TargetIcon, BoltIcon, RefreshIcon, CheckIcon, XIcon,
  ClockIcon, PlayIcon, SlidersIcon, EditIcon, EyeIcon, CopyIcon,
  ChevronDownIcon, LayersIcon, MailIcon, BrainIcon, PieChartIcon,
  GitBranchIcon, ZapIcon, RocketIcon, PenIcon, SendIcon, FilterIcon
} from '../../components/Icons';
import { supabase } from '../../lib/supabase';
import { AI_MODELS } from '../../lib/aiConfig';
import { PROMPT_REGISTRY, CATEGORY_META, type PromptCategory, type PromptRegistryEntry } from '../../lib/promptResolver';
import { PageHeader } from '../../components/layout/PageHeader';
import { AdvancedOnly } from '../../components/ui-mode';

interface LayoutContext {
  user: User;
  refreshProfile: () => Promise<void>;
}

interface PromptRow {
  id: string;
  owner_id: string | null;
  prompt_key: string;
  category: string;
  display_name: string;
  description: string;
  system_instruction: string;
  prompt_template: string;
  temperature: number;
  top_p: number;
  version: number;
  is_active: boolean;
  is_default: boolean;
  last_tested_at: string | null;
  test_result: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  prompt_id: string;
  version: number;
  system_instruction: string;
  prompt_template: string;
  temperature: number;
  top_p: number;
  change_note: string | null;
  created_at: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  sales_outreach: <TargetIcon className="w-4 h-4" />,
  analytics: <PieChartIcon className="w-4 h-4" />,
  email: <MailIcon className="w-4 h-4" />,
  content: <SparklesIcon className="w-4 h-4" />,
  lead_research: <BrainIcon className="w-4 h-4" />,
  blog: <PenIcon className="w-4 h-4" />,
  social: <SendIcon className="w-4 h-4" />,
  automation: <GitBranchIcon className="w-4 h-4" />,
  strategy: <BoltIcon className="w-4 h-4" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  sales_outreach: 'indigo',
  analytics: 'blue',
  email: 'emerald',
  content: 'violet',
  lead_research: 'amber',
  blog: 'rose',
  social: 'sky',
  automation: 'orange',
  strategy: 'teal',
};

const colorMap: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500' },
};

const ModelTraining: React.FC = () => {
  const { user } = useOutletContext<LayoutContext>();

  // ─── State ───
  const [systemPrompts, setSystemPrompts] = useState<PromptRow[]>([]);
  const [userPrompts, setUserPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(Object.keys(CATEGORY_META)));

  // Editor state
  const [editSystemInstruction, setEditSystemInstruction] = useState('');
  const [editPromptTemplate, setEditPromptTemplate] = useState('');
  const [editTemperature, setEditTemperature] = useState(0.7);
  const [editTopP, setEditTopP] = useState(0.9);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Right panel
  const [rightTab, setRightTab] = useState<'test' | 'history'>('test');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testTime, setTestTime] = useState<number | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const templateRef = useRef<HTMLTextAreaElement>(null);

  // ─── Data Loading ───
  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      // Load system defaults
      const { data: defaults } = await supabase
        .from('user_prompts')
        .select('*')
        .is('owner_id', null)
        .eq('is_default', true);

      // Load user overrides
      const { data: customs } = await supabase
        .from('user_prompts')
        .select('*')
        .eq('owner_id', user.id);

      setSystemPrompts(defaults || []);
      setUserPrompts(customs || []);
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  // ─── Derived Data ───
  // Build a synthetic PromptRow from registry defaults (used when DB has no data)
  const getRegistryFallback = useCallback((key: string): PromptRow | null => {
    const reg = PROMPT_REGISTRY.find(r => r.promptKey === key);
    if (!reg) return null;
    return {
      id: `registry-${key}`,
      owner_id: null,
      prompt_key: key,
      category: reg.category,
      display_name: reg.displayName,
      description: reg.description,
      system_instruction: reg.defaultSystemInstruction,
      prompt_template: reg.defaultPromptTemplate,
      temperature: reg.defaultTemperature,
      top_p: reg.defaultTopP,
      version: 0,
      is_active: true,
      is_default: true,
      last_tested_at: null,
      test_result: null,
      created_at: '',
      updated_at: '',
    };
  }, []);

  const getActivePrompt = useCallback((key: string): PromptRow | null => {
    const userOverride = userPrompts.find(p => p.prompt_key === key && p.is_active);
    if (userOverride) return userOverride;
    const systemDefault = systemPrompts.find(p => p.prompt_key === key);
    if (systemDefault) return systemDefault;
    // Fallback to hardcoded registry defaults (works even without DB migration)
    return getRegistryFallback(key);
  }, [userPrompts, systemPrompts, getRegistryFallback]);

  const isCustom = useCallback((key: string): boolean => {
    return userPrompts.some(p => p.prompt_key === key && p.is_active);
  }, [userPrompts]);

  const promptsByCategory = useMemo(() => {
    const grouped: Record<string, PromptRegistryEntry[]> = {};
    for (const entry of PROMPT_REGISTRY) {
      if (!grouped[entry.category]) grouped[entry.category] = [];
      grouped[entry.category].push(entry);
    }
    return grouped;
  }, []);

  const selectedPrompt = selectedKey ? getActivePrompt(selectedKey) : null;
  const selectedRegistry = selectedKey ? PROMPT_REGISTRY.find(r => r.promptKey === selectedKey) : null;
  const selectedIsCustom = selectedKey ? isCustom(selectedKey) : false;

  // The system default to show for comparison (from DB or registry)
  const selectedSystemDefault = useMemo(() => {
    if (!selectedKey) return null;
    const dbDefault = systemPrompts.find(p => p.prompt_key === selectedKey);
    if (dbDefault) return dbDefault;
    return getRegistryFallback(selectedKey);
  }, [selectedKey, systemPrompts, getRegistryFallback]);

  // "View System Default" toggle
  const [showSystemDefault, setShowSystemDefault] = useState(false);

  // ─── Load Editor ───
  useEffect(() => {
    if (selectedPrompt) {
      setEditSystemInstruction(selectedPrompt.system_instruction);
      setEditPromptTemplate(selectedPrompt.prompt_template);
      setEditTemperature(selectedPrompt.temperature);
      setEditTopP(selectedPrompt.top_p);
      setIsDirty(false);
      setSaveMessage(null);
      setShowSystemDefault(false);
    }
  }, [selectedPrompt?.id, selectedKey]);

  // Track dirty state
  useEffect(() => {
    if (!selectedPrompt) return;
    const dirty =
      editSystemInstruction !== selectedPrompt.system_instruction ||
      editPromptTemplate !== selectedPrompt.prompt_template ||
      editTemperature !== selectedPrompt.temperature ||
      editTopP !== selectedPrompt.top_p;
    setIsDirty(dirty);
  }, [editSystemInstruction, editPromptTemplate, editTemperature, editTopP, selectedPrompt]);

  // ─── Load Version History ───
  const loadVersions = useCallback(async (promptId: string) => {
    setVersionsLoading(true);
    const { data } = await supabase
      .from('user_prompt_versions')
      .select('*')
      .eq('prompt_id', promptId)
      .order('version', { ascending: false });
    setVersions(data || []);
    setVersionsLoading(false);
  }, []);

  useEffect(() => {
    if (selectedPrompt && selectedIsCustom) {
      loadVersions(selectedPrompt.id);
    } else {
      setVersions([]);
    }
  }, [selectedPrompt?.id, selectedIsCustom, loadVersions]);

  // ─── Save Prompt ───
  const handleSave = async () => {
    if (!selectedKey || !selectedRegistry) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      const existingCustom = userPrompts.find(p => p.prompt_key === selectedKey && p.is_active);

      if (existingCustom) {
        // Update existing custom prompt
        const newVersion = existingCustom.version + 1;

        // Save version history
        await supabase.from('user_prompt_versions').insert({
          prompt_id: existingCustom.id,
          owner_id: user.id,
          version: existingCustom.version,
          system_instruction: existingCustom.system_instruction,
          prompt_template: existingCustom.prompt_template,
          temperature: existingCustom.temperature,
          top_p: existingCustom.top_p,
          change_note: `Updated to v${newVersion}`,
        });

        // Update the prompt
        const { error } = await supabase
          .from('user_prompts')
          .update({
            system_instruction: editSystemInstruction,
            prompt_template: editPromptTemplate,
            temperature: editTemperature,
            top_p: editTopP,
            version: newVersion,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCustom.id);

        if (error) throw error;
        setSaveMessage({ type: 'success', text: `Saved as Custom v${newVersion}` });
      } else {
        // Create new custom override
        const { error } = await supabase.from('user_prompts').insert({
          owner_id: user.id,
          prompt_key: selectedKey,
          category: selectedRegistry.category,
          display_name: selectedRegistry.displayName,
          description: selectedRegistry.description,
          system_instruction: editSystemInstruction,
          prompt_template: editPromptTemplate,
          temperature: editTemperature,
          top_p: editTopP,
          version: 1,
          is_active: true,
          is_default: false,
        });

        if (error) throw error;
        setSaveMessage({ type: 'success', text: 'Custom override created (v1)' });
      }

      await loadPrompts();
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Reset to Default ───
  const handleReset = async () => {
    if (!selectedKey) return;
    const existingCustom = userPrompts.find(p => p.prompt_key === selectedKey && p.is_active);
    if (!existingCustom) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_prompts')
        .delete()
        .eq('id', existingCustom.id);

      if (error) throw error;
      setSaveMessage({ type: 'success', text: 'Reset to system default' });
      await loadPrompts();
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Reset failed' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Restore Version ───
  const handleRestore = async (ver: VersionRow) => {
    if (!selectedKey) return;
    const existingCustom = userPrompts.find(p => p.prompt_key === selectedKey && p.is_active);
    if (!existingCustom) return;

    setSaving(true);
    try {
      const newVersion = existingCustom.version + 1;

      // Save current as version history
      await supabase.from('user_prompt_versions').insert({
        prompt_id: existingCustom.id,
        owner_id: user.id,
        version: existingCustom.version,
        system_instruction: existingCustom.system_instruction,
        prompt_template: existingCustom.prompt_template,
        temperature: existingCustom.temperature,
        top_p: existingCustom.top_p,
        change_note: `Rolled back to v${ver.version}`,
      });

      // Restore the old version
      const { error } = await supabase
        .from('user_prompts')
        .update({
          system_instruction: ver.system_instruction,
          prompt_template: ver.prompt_template,
          temperature: ver.temperature,
          top_p: ver.top_p,
          version: newVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingCustom.id);

      if (error) throw error;
      setSaveMessage({ type: 'success', text: `Restored from v${ver.version}` });
      await loadPrompts();
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Restore failed' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Test Prompt ───
  const handleTest = async () => {
    if (!selectedKey) return;
    setTestRunning(true);
    setTestOutput('');
    setTestTime(null);
    const start = Date.now();

    try {
      const { getGeminiClient } = await import('../../lib/geminiClient');
      const ai = getGeminiClient();

      const samplePrompt = editPromptTemplate
        .replace(/\{\{[^}]+\}\}/g, (match) => {
          const key = match.replace(/\{\{|\}\}/g, '');
          const samples: Record<string, string> = {
            lead_name: 'Sarah Chen', company: 'TechCorp', score: '85',
            insights: 'Recently raised Series B, expanding engineering team',
            type: 'email', tone: 'professional', total_leads: '42',
            avg_score: '72', status_breakdown: 'New: 15, Contacted: 12, Qualified: 10, Won: 5',
            hot_leads: '8', lead_summary: 'Sarah Chen (TechCorp) - Score: 85, Status: Qualified',
            topic: 'AI-Powered Sales Automation', post_title: 'The Future of B2B Sales',
            post_url: 'https://example.com/blog/future-b2b-sales',
            content: testInput || 'Sample content for analysis',
            user_prompt: testInput || 'Analyze my pipeline health',
            pipeline_context: 'Total Leads: 42, Avg Score: 72, Hot: 8',
          };
          return samples[key] || `[${key}]`;
        });

      const response = await ai.models.generateContent({
        model: AI_MODELS.textTesting,
        contents: samplePrompt,
        config: {
          systemInstruction: editSystemInstruction,
          temperature: editTemperature,
          topP: editTopP,
        },
      });

      const elapsed = Date.now() - start;
      setTestOutput(response.text || 'No output generated.');
      setTestTime(elapsed);

      // Update last_tested_at if custom prompt exists
      const customPrompt = userPrompts.find(p => p.prompt_key === selectedKey && p.is_active);
      if (customPrompt) {
        await supabase
          .from('user_prompts')
          .update({ last_tested_at: new Date().toISOString(), test_result: (response.text || '').slice(0, 500) })
          .eq('id', customPrompt.id);
      }
    } catch (err: any) {
      setTestOutput(`Test failed: ${err.message || 'Unknown error'}`);
      setTestTime(Date.now() - start);
    } finally {
      setTestRunning(false);
    }
  };

  // ─── Insert Placeholder ───
  const insertPlaceholder = (placeholder: string) => {
    if (!templateRef.current) return;
    const ta = templateRef.current;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = editPromptTemplate;
    setEditPromptTemplate(val.substring(0, start) + placeholder + val.substring(end));
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + placeholder.length;
      ta.focus();
    }, 0);
  };

  // ─── KPI Stats ───
  const customCount = userPrompts.filter(p => p.is_active).length;
  const categoriesWithCustom = new Set(userPrompts.filter(p => p.is_active).map(p => p.category)).size;
  const lastTest = userPrompts
    .filter(p => p.last_tested_at)
    .sort((a, b) => new Date(b.last_tested_at!).getTime() - new Date(a.last_tested_at!).getTime())[0];

  const kpiStats = [
    { label: 'Custom Prompts', value: customCount.toString(), icon: <EditIcon className="w-5 h-5" />, color: 'indigo', sub: `of ${PROMPT_REGISTRY.length} available` },
    { label: 'Categories Configured', value: categoriesWithCustom.toString(), icon: <LayersIcon className="w-5 h-5" />, color: 'emerald', sub: `of ${Object.keys(CATEGORY_META).length} total` },
    { label: 'Last Test Run', value: lastTest?.last_tested_at ? new Date(lastTest.last_tested_at).toLocaleDateString() : 'Never', icon: <PlayIcon className="w-5 h-5" />, color: 'blue', sub: lastTest ? lastTest.display_name : 'No tests yet' },
    { label: 'Active Overrides', value: `${customCount}/${PROMPT_REGISTRY.length}`, icon: <SlidersIcon className="w-5 h-5" />, color: 'violet', sub: `${PROMPT_REGISTRY.length - customCount} using defaults` },
  ];

  // ─── Render ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="AI Settings"
        description="Customize the AI prompts that power every feature across Scaliyo"
        actions={
          <button
            onClick={loadPrompts}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            <RefreshIcon className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-4 gap-4">
        {kpiStats.map((stat) => {
          const c = colorMap[stat.color] || colorMap.indigo;
          return (
            <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>
                  {stat.icon}
                </div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</div>
              </div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500 mt-1">{stat.sub}</div>
            </div>
          );
        })}
      </div>

      {/* 3-Panel Layout */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: '70vh' }}>

        {/* ─── Left Sidebar: Category Navigator ─── */}
        <div className="col-span-3 bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Prompt Categories</h2>
            <p className="text-[10px] text-gray-400 mt-1">{PROMPT_REGISTRY.length} prompts across {Object.keys(CATEGORY_META).length} categories</p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {Object.entries(promptsByCategory).map(([cat, entries]) => {
              const meta = CATEGORY_META[cat as PromptCategory];
              const color = CATEGORY_COLORS[cat] || 'gray';
              const cm = colorMap[color] || colorMap.indigo;
              const isExpanded = expandedCategories.has(cat);
              const customInCat = entries.filter(e => isCustom(e.promptKey)).length;

              return (
                <div key={cat}>
                  <button
                    onClick={() => setExpandedCategories(prev => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      return next;
                    })}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className={`w-6 h-6 rounded-md ${cm.bg} ${cm.text} flex items-center justify-center flex-shrink-0`}>
                      {CATEGORY_ICONS[cat]}
                    </div>
                    <span className="text-xs font-semibold text-gray-700 flex-1 truncate">{meta?.label || cat}</span>
                    {customInCat > 0 && (
                      <span className={`text-[9px] font-bold ${cm.text} ${cm.bg} px-1.5 py-0.5 rounded-full`}>
                        {customInCat}
                      </span>
                    )}
                    <ChevronDownIcon className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  </button>

                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {entries.map(entry => {
                        const custom = isCustom(entry.promptKey);
                        const isSelected = selectedKey === entry.promptKey;
                        return (
                          <button
                            key={entry.promptKey}
                            onClick={() => {
                              setSelectedKey(entry.promptKey);
                              setTestOutput('');
                              setTestInput('');
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all text-xs ${
                              isSelected
                                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                                : 'hover:bg-gray-50 text-gray-600'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              custom ? 'bg-emerald-500' : 'bg-gray-300'
                            }`} />
                            <span className="truncate">{entry.displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Center Panel: Prompt Editor ─── */}
        <div className="col-span-5 bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          {!selectedKey ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              <div className="text-center">
                <SlidersIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">Select a prompt to edit</p>
                <p className="text-xs mt-1">Choose from the categories on the left</p>
              </div>
            </div>
          ) : (
            <>
              {/* Editor Header */}
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-lg font-bold text-gray-900">{selectedRegistry?.displayName}</h2>
                  {(() => {
                    const cat = selectedRegistry?.category || '';
                    const color = CATEGORY_COLORS[cat] || 'gray';
                    const cm = colorMap[color] || colorMap.indigo;
                    return (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cm.bg} ${cm.text}`}>
                        {CATEGORY_META[cat as PromptCategory]?.label || cat}
                      </span>
                    );
                  })()}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    selectedIsCustom
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {selectedIsCustom ? `Custom v${selectedPrompt?.version || 1}` : 'System Default'}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{selectedRegistry?.description}</p>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  This is the prompt sent to Gemini when the <span className="font-semibold text-gray-500">{selectedRegistry?.displayName}</span> feature runs. The placeholders below get replaced with real data at runtime.
                </p>

                {/* Used In */}
                {selectedRegistry && selectedRegistry.usedIn.length > 0 && (
                  <div className="mt-3 bg-slate-50 rounded-xl border border-slate-100 p-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Used in</p>
                    <div className="space-y-1.5">
                      {selectedRegistry.usedIn.map((loc, i) => (
                        <Link
                          key={i}
                          to={loc.route}
                          className="flex items-center gap-2.5 group"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                          <span className="text-xs font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors">{loc.page}</span>
                          <span className="text-[10px] text-slate-400">&mdash;</span>
                          <span className="text-[11px] text-slate-500 group-hover:text-slate-700 transition-colors">{loc.feature}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Editor Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* View System Default (when user has custom override) */}
                {selectedIsCustom && selectedSystemDefault && (
                  <div className="border border-amber-200 bg-amber-50/50 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowSystemDefault(prev => !prev)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left"
                    >
                      <EyeIcon className="w-3.5 h-3.5 text-amber-600" />
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest flex-1">
                        View Original System Default
                      </span>
                      <ChevronDownIcon className={`w-3 h-3 text-amber-500 transition-transform ${showSystemDefault ? '' : '-rotate-90'}`} />
                    </button>
                    {showSystemDefault && (
                      <div className="px-3 pb-3 space-y-2">
                        <div>
                          <p className="text-[9px] font-bold text-amber-600 uppercase mb-1">System Instruction</p>
                          <pre className="text-[11px] text-gray-600 bg-white rounded-lg border border-amber-100 p-2 whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">{selectedSystemDefault.system_instruction}</pre>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold text-amber-600 uppercase mb-1">Prompt Template</p>
                          <pre className="text-[11px] text-gray-600 bg-white rounded-lg border border-amber-100 p-2 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">{selectedSystemDefault.prompt_template}</pre>
                        </div>
                        <div className="flex gap-3 text-[10px] text-amber-700">
                          <span>Temp: {selectedSystemDefault.temperature}</span>
                          <span>Top-P: {selectedSystemDefault.top_p}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* System Instruction */}
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                    System Instruction (AI Persona)
                  </label>
                  <textarea
                    value={editSystemInstruction}
                    onChange={e => setEditSystemInstruction(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
                    placeholder="Define the AI's role and personality..."
                  />
                </div>

                {/* Prompt Template */}
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                    Prompt Template
                  </label>
                  <textarea
                    ref={templateRef}
                    value={editPromptTemplate}
                    onChange={e => setEditPromptTemplate(e.target.value)}
                    rows={12}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
                    placeholder="Write your prompt template with {{placeholders}}..."
                  />
                </div>

                {/* Available Placeholders */}
                {selectedRegistry && selectedRegistry.placeholders.length > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                      Available Placeholders (click to insert)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRegistry.placeholders.map(ph => (
                        <button
                          key={ph}
                          onClick={() => insertPlaceholder(ph)}
                          className="px-2 py-1 bg-indigo-50 text-indigo-700 text-[11px] font-mono font-medium rounded-lg hover:bg-indigo-100 transition-colors"
                        >
                          {ph}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Temperature & Top-P */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                      <span>Temperature</span>
                      <span className="text-indigo-600">{editTemperature.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={editTemperature}
                      onChange={e => setEditTemperature(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                      <span>Precise</span>
                      <span>Creative</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                      <span>Top-P</span>
                      <span className="text-indigo-600">{editTopP.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={editTopP}
                      onChange={e => setEditTopP(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                      <span>Focused</span>
                      <span>Diverse</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editor Footer */}
              <div className="p-4 border-t border-gray-100 flex items-center gap-3">
                {saveMessage && (
                  <div className={`flex items-center gap-1.5 text-xs font-medium mr-auto ${
                    saveMessage.type === 'success' ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {saveMessage.type === 'success' ? <CheckIcon className="w-3.5 h-3.5" /> : <XIcon className="w-3.5 h-3.5" />}
                    {saveMessage.text}
                  </div>
                )}
                {!saveMessage && <div className="flex-1" />}

                {selectedIsCustom && (
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Reset to Default
                  </button>
                )}
                <button
                  onClick={handleTest}
                  disabled={testRunning}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  <PlayIcon className="w-3.5 h-3.5" />
                  {testRunning ? 'Testing...' : 'Test Prompt'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <CheckIcon className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ─── Right Panel: Test & History ─── */}
        <div className="col-span-4 bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          {/* Tab Switcher */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setRightTab('test')}
              className={`flex-1 px-4 py-3 text-xs font-semibold transition-colors ${
                rightTab === 'test'
                  ? 'text-indigo-700 border-b-2 border-indigo-600 bg-indigo-50/50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center justify-center gap-1.5">
                <PlayIcon className="w-3.5 h-3.5" />
                Test Output
              </div>
            </button>
            <AdvancedOnly>
              <button
                onClick={() => setRightTab('history')}
                className={`flex-1 px-4 py-3 text-xs font-semibold transition-colors ${
                  rightTab === 'history'
                    ? 'text-indigo-700 border-b-2 border-indigo-600 bg-indigo-50/50'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <ClockIcon className="w-3.5 h-3.5" />
                  Version History
                </div>
              </button>
            </AdvancedOnly>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {rightTab === 'test' ? (
              <div className="p-4 space-y-4">
                {!selectedKey ? (
                  <p className="text-xs text-gray-400 text-center py-8">Select a prompt to test</p>
                ) : (
                  <>
                    {/* Sample Input */}
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                        Sample Input (optional context)
                      </label>
                      <textarea
                        value={testInput}
                        onChange={e => setTestInput(e.target.value)}
                        rows={3}
                        placeholder="Add custom context for your test run..."
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
                      />
                    </div>

                    {/* Run Button */}
                    <button
                      onClick={handleTest}
                      disabled={testRunning}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {testRunning ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                          Running test...
                        </>
                      ) : (
                        <>
                          <RocketIcon className="w-3.5 h-3.5" />
                          Run Test
                        </>
                      )}
                    </button>

                    {/* Test Result */}
                    {testOutput && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            AI Output
                          </label>
                          {testTime !== null && (
                            <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1">
                              <ClockIcon className="w-3 h-3" />
                              {(testTime / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                        <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 max-h-96 overflow-y-auto">
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                            {testOutput}
                          </pre>
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(testOutput)}
                          className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-gray-500 hover:text-indigo-600 transition-colors"
                        >
                          <CopyIcon className="w-3 h-3" />
                          Copy output
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {!selectedKey ? (
                  <p className="text-xs text-gray-400 text-center py-8">Select a prompt to see history</p>
                ) : !selectedIsCustom ? (
                  <div className="text-center py-8">
                    <ClockIcon className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400">System default — no version history</p>
                    <p className="text-[10px] text-gray-300 mt-1">Save a custom override to start tracking versions</p>
                  </div>
                ) : versionsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600" />
                  </div>
                ) : versions.length === 0 ? (
                  <div className="text-center py-8">
                    <ClockIcon className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="text-xs text-gray-400">No previous versions yet</p>
                    <p className="text-[10px] text-gray-300 mt-1">History is saved each time you update the prompt</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {versions.length} version{versions.length !== 1 ? 's' : ''}
                    </p>
                    {versions.map(ver => (
                      <div key={ver.id} className="bg-gray-50 rounded-xl border border-gray-100 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-gray-700">v{ver.version}</span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(ver.created_at).toLocaleDateString()} {new Date(ver.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {ver.change_note && (
                          <p className="text-[10px] text-gray-500 mb-2">{ver.change_note}</p>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
                          <span>Temp: {ver.temperature}</span>
                          <span>Top-P: {ver.top_p}</span>
                        </div>
                        <button
                          onClick={() => handleRestore(ver)}
                          disabled={saving}
                          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors disabled:opacity-50"
                        >
                          Restore this version
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default ModelTraining;

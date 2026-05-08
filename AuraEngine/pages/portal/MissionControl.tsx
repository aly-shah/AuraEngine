// AuraEngine/pages/portal/MissionControl.tsx
//
// AI Mission Control — the single screen a sales operator opens first thing
// in the morning. Replaces the "passive" dashboard pattern (rows of charts)
// with an active-intelligence layout: recommended actions on top, signal
// surfaces below, deep dives one click away.
//
// Phase 1 ships the layout + the data wiring against existing tables. The
// "intent score", "anomaly flag", and "recommendation rationale" fields are
// computed deterministically from current data — they get upgraded to LLM
// inference in Phase 2 once memory.ts is wired into the Gemini calls.

import React, { useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, Flame, ArrowRight, TrendingUp, TrendingDown, Brain,
  Send, Target, Compass,
} from 'lucide-react';
import { User, Lead } from '../../types';
import { useLeads } from '../../lib/queries';
import { PILLARS } from '../../lib/navConfig';
import { recallWorkspaceMemory, type WorkspaceMemoryRow } from '../../lib/memory';
import { supabase } from '../../lib/supabase';

interface LayoutContext {
  user: User;
}

// ── Recommendation engine (deterministic, Phase 1) ───────────────────────────
//
// Pure-function rules over current data. Returns a small ranked list of
// "things you should do today". Phase 2 swaps the rule list for an LLM
// reasoner that consumes lead_memory + campaign_memory + workspace_memory.

interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  cta: string;
  href: string;
  pillar: keyof typeof PILLARS;
  urgency: 'high' | 'medium' | 'low';
}

function buildRecommendations(leads: Lead[]): Recommendation[] {
  const recs: Recommendation[] = [];

  const hot = leads.filter((l) => (l.score ?? 0) >= 80 && l.status !== 'Converted' && l.status !== 'Lost');
  const stale = leads.filter((l) => {
    if (!l.last_activity) return false;
    const days = (Date.now() - new Date(l.last_activity).getTime()) / 86_400_000;
    return days > 14 && l.status !== 'Converted' && l.status !== 'Lost';
  });
  const newLeads = leads.filter((l) => l.status === 'New');
  const qualified = leads.filter((l) => l.status === 'Qualified');

  if (hot.length > 0) {
    recs.push({
      id: 'rec-hot',
      title: `${hot.length} high-intent lead${hot.length === 1 ? '' : 's'} ready to engage`,
      rationale: `Score ≥ 80 and not yet closed. Fastest path to revenue.`,
      cta: 'Open hot list',
      href: '/portal/leads',
      pillar: 'engage',
      urgency: 'high',
    });
  }
  if (newLeads.length >= 5) {
    recs.push({
      id: 'rec-enrich',
      title: `${newLeads.length} new leads need enrichment`,
      rationale: 'Run AI research before first contact to lift reply rate.',
      cta: 'Enrich now',
      href: '/portal/leads',
      pillar: 'acquire',
      urgency: 'medium',
    });
  }
  if (stale.length > 0) {
    recs.push({
      id: 'rec-stale',
      title: `${stale.length} stalled lead${stale.length === 1 ? '' : 's'} (no activity 14+ days)`,
      rationale: 'Re-engagement sequence keeps dormant pipeline alive.',
      cta: 'Build re-engage sequence',
      href: '/portal/automation',
      pillar: 'engage',
      urgency: 'medium',
    });
  }
  if (qualified.length >= 3) {
    recs.push({
      id: 'rec-convert',
      title: `${qualified.length} qualified leads waiting on next step`,
      rationale: 'Convert qualified → won faster with a proposal or invoice.',
      cta: 'Move pipeline',
      href: '/portal/team-hub',
      pillar: 'convert',
      urgency: 'medium',
    });
  }
  if (recs.length === 0) {
    recs.push({
      id: 'rec-empty',
      title: 'Pipeline is quiet — let’s find new prospects',
      rationale: 'No urgent actions. Use Apollo to sweep your ICP.',
      cta: 'Find prospects',
      href: '/portal/leads/apollo',
      pillar: 'acquire',
      urgency: 'low',
    });
  }
  return recs.slice(0, 4);
}

// ── Pillar action grid ───────────────────────────────────────────────────────

interface PillarCard {
  pillar: keyof typeof PILLARS;
  primary: { label: string; href: string };
  metric: { label: string; value: string | number };
}

function buildPillarCards(leads: Lead[], emailRunsCount: number): PillarCard[] {
  const total = leads.length;
  const hot = leads.filter((l) => (l.score ?? 0) >= 80).length;
  const qualified = leads.filter((l) => l.status === 'Qualified').length;
  const won = leads.filter((l) => l.status === 'Converted').length;

  return [
    {
      pillar: 'acquire',
      primary: { label: 'Find prospects', href: '/portal/leads/apollo' },
      metric: { label: 'Leads in workspace', value: total },
    },
    {
      pillar: 'engage',
      primary: { label: 'Build campaign', href: '/portal/content-studio' },
      metric: { label: 'Active sequences', value: emailRunsCount },
    },
    {
      pillar: 'convert',
      primary: { label: 'Open pipeline', href: '/portal/team-hub' },
      metric: { label: 'Qualified', value: qualified },
    },
    {
      pillar: 'intelligence',
      primary: { label: 'Open AI Command Center', href: '/portal/ai' },
      metric: { label: 'Won deals', value: won },
    },
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

const MissionControl: React.FC = () => {
  const { user } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  const { data: leads = [], isLoading: leadsLoading } = useLeads(user.id);

  // Resolve the user's primary workspace once. credits.ts uses the same
  // workspace_members lookup; we cache the result for the session via react-query.
  const { data: workspaceId = null } = useQuery<string | null>({
    queryKey: ['mission-workspace', user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data?.workspace_id as string | undefined) ?? null;
    },
    staleTime: 5 * 60_000,
  });

  const { data: memoryRows = [] } = useQuery<WorkspaceMemoryRow[]>({
    queryKey: ['mission-memory', workspaceId],
    queryFn: () => recallWorkspaceMemory({ workspaceId: workspaceId!, limit: 6 }),
    staleTime: 60_000,
    enabled: !!workspaceId,
  });

  const { data: emailRunsCount = 0 } = useQuery<number>({
    queryKey: ['mission-active-runs', user.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('email_sequence_runs')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', user.id)
        .eq('status', 'running');
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const recommendations = useMemo(() => buildRecommendations(leads), [leads]);
  const pillarCards = useMemo(() => buildPillarCards(leads, emailRunsCount), [leads, emailRunsCount]);
  const intentLeads = useMemo(
    () =>
      [...leads]
        .filter((l) => (l.score ?? 0) >= 70 && l.status !== 'Converted' && l.status !== 'Lost')
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5),
    [leads],
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = user.businessProfile?.companyName?.split(' ')[0] || user.email?.split('@')[0] || 'there';

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p className="text-sm font-medium text-slate-500">{greeting}</p>
          <h1 className="text-3xl font-bold text-slate-900 mt-1 flex items-center gap-3">
            <Sparkles className="text-indigo-500" size={28} />
            Mission Control
          </h1>
          <p className="text-slate-600 mt-2 max-w-2xl">
            Your AI revenue operating system, briefing you on what matters today.
          </p>
        </div>
        <button
          onClick={() => navigate('/portal/ai')}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition shadow-lg shadow-slate-900/10"
        >
          <Brain size={16} /> Ask the AI
        </button>
      </header>

      {/* ── Today's recommendations ── */}
      <section aria-labelledby="recs-heading">
        <h2 id="recs-heading" className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Recommended for today
        </h2>
        {leadsLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {recommendations.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(r.href)}
                className="group text-left p-5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <UrgencyDot urgency={r.urgency} />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {PILLARS[r.pillar].label}
                    </span>
                  </div>
                  <ArrowRight className="text-slate-400 group-hover:text-indigo-500 transition" size={18} />
                </div>
                <p className="mt-2 text-base font-semibold text-slate-900">{r.title}</p>
                <p className="mt-1 text-sm text-slate-600">{r.rationale}</p>
                <p className="mt-3 text-sm font-medium text-indigo-600">{r.cta} →</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Pillar cards ── */}
      <section aria-labelledby="pillars-heading">
        <h2 id="pillars-heading" className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Operating pillars
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {pillarCards.map((c) => {
            const meta = PILLARS[c.pillar];
            const Icon = meta.icon;
            return (
              <div key={c.pillar} className="p-5 rounded-2xl border border-slate-200 bg-white flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Icon size={18} />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{meta.label}</h3>
                </div>
                <p className="text-sm text-slate-600 flex-1">{meta.description}</p>
                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <p className="text-xs text-slate-500">{c.metric.label}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{c.metric.value}</p>
                  </div>
                  <button
                    onClick={() => navigate(c.primary.href)}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    {c.primary.label} →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Buying intent + Memory ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intent column */}
        <section className="lg:col-span-2 p-6 rounded-2xl border border-slate-200 bg-white" aria-labelledby="intent-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="intent-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Flame size={18} className="text-amber-500" /> Buying intent
            </h2>
            <button onClick={() => navigate('/portal/leads')} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
              View all
            </button>
          </div>
          {intentLeads.length === 0 ? (
            <EmptyState icon={Compass} title="No high-intent leads yet" cta="Find prospects" onClick={() => navigate('/portal/leads/apollo')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {intentLeads.map((l) => (
                <li
                  key={l.id}
                  className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                  onClick={() => navigate(`/portal/leads/${l.id}`)}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Unknown lead'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{l.company || '—'} · {l.status}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold">
                      <Flame size={12} /> {l.score ?? 0}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Memory column */}
        <section className="p-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50 to-white" aria-labelledby="memory-heading">
          <h2 id="memory-heading" className="text-base font-bold text-slate-900 flex items-center gap-2 mb-3">
            <Brain size={18} className="text-indigo-500" /> AI Memory
          </h2>
          {memoryRows.length === 0 ? (
            <p className="text-sm text-slate-600">
              The AI hasn’t learned anything yet. As you run campaigns and rate replies, it will start to remember
              what works for your business.
            </p>
          ) : (
            <ul className="space-y-2">
              {memoryRows.map((m) => (
                <li key={m.id} className="text-sm text-slate-700">
                  <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">{m.kind}</span>
                  <p className="mt-0.5 line-clamp-2">{summarizeMemory(m.value)}</p>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => navigate('/portal/model-training')}
            className="mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Manage AI settings →
          </button>
        </section>
      </div>
    </div>
  );
};

function UrgencyDot({ urgency }: { urgency: Recommendation['urgency'] }) {
  const cls =
    urgency === 'high' ? 'bg-rose-500'
      : urgency === 'medium' ? 'bg-amber-500'
        : 'bg-emerald-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function EmptyState({
  icon: Icon, title, cta, onClick,
}: { icon: React.FC<{ size?: number }>; title: string; cta: string; onClick: () => void }) {
  return (
    <div className="text-center py-10">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
        <Icon size={20} />
      </div>
      <p className="mt-3 text-sm text-slate-700">{title}</p>
      <button onClick={onClick} className="mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-700">
        {cta} →
      </button>
    </div>
  );
}

function summarizeMemory(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    try {
      const j = JSON.stringify(value);
      return j.length > 140 ? `${j.slice(0, 140)}…` : j;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export default MissionControl;

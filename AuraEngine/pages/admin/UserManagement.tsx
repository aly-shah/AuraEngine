import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, UserRole } from '../../types';
import { supabase } from '../../lib/supabase';
import {
  ShieldIcon, UsersIcon, CreditCardIcon, BoltIcon, KeyboardIcon, XIcon,
  TrendUpIcon, TrendDownIcon, TargetIcon, ActivityIcon, BrainIcon,
  AlertTriangleIcon, CheckIcon, PieChartIcon, LayersIcon, SparklesIcon
} from '../../components/Icons';
import { getPlans, type DbPlan } from '../../lib/plans';

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // Sidebar & shortcut state
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showUserMetrics, setShowUserMetrics] = useState(false);
  const [showPlanAnalytics, setShowPlanAnalytics] = useState(false);
  const [showRiskAssessment, setShowRiskAssessment] = useState(false);

  // Plan change state
  const [availablePlans, setAvailablePlans] = useState<DbPlan[]>([]);
  const [changingPlanFor, setChangingPlanFor] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
    getPlans().then(setAvailablePlans).catch(e => console.warn('[UserMgmt] plan load failed:', e));
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, subscription:subscriptions(*)')
        .order('created_at', { ascending: false });

      if (data) {
        setUsers(data.map(u => ({
          ...u,
          // User type uses camelCase createdAt; alias from the snake_case DB column.
          createdAt: (u as { createdAt?: string; created_at?: string }).createdAt ?? (u as { created_at?: string }).created_at,
          subscription: Array.isArray(u.subscription) ? u.subscription[0] : u.subscription
        })));
      }
    } catch (err) {
      console.error("Unexpected fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (id: string, currentStatus: string) => {
    setIsProcessing(id);
    const nextStatus = currentStatus === 'active' ? 'disabled' : 'active';

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: nextStatus })
        .eq('id', id);

      if (!error) {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, status: nextStatus } : u));
      }
    } finally {
      setIsProcessing(null);
    }
  };

  const toggleUserRole = async (id: string, currentRole: UserRole) => {
    setIsProcessing(id);
    const nextRole = currentRole === UserRole.ADMIN ? UserRole.CLIENT : UserRole.ADMIN;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: nextRole })
        .eq('id', id);

      if (!error) {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, role: nextRole } : u));
      }
    } finally {
      setIsProcessing(null);
    }
  };

  const changeUserPlan = async (userId: string, newPlan: string) => {
    setChangingPlanFor(userId);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const { data, error } = await supabase.rpc('admin_change_user_plan', {
        p_target_user_id: userId,
        p_new_plan_name: newPlan,
        p_admin_id: authUser.id,
        p_reason: 'Admin override via User Directory',
      });
      if (error) throw new Error(error.message);
      const result = data as { success: boolean; message: string };
      if (!result.success) throw new Error(result.message);

      // Update local state
      setUsers(prev => prev.map(u => {
        if (u.id !== userId) return u;
        return {
          ...u,
          plan: newPlan,
          subscription: u.subscription
            ? { ...u.subscription, plan: newPlan, plan_name: newPlan }
            : { plan: newPlan, plan_name: newPlan, status: 'active' },
        };
      }));
    } catch (err) {
      console.error('Plan change failed:', err);
      alert(`Plan change failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setChangingPlanFor(null);
    }
  };

  const filteredUsers = useMemo(() => {
    let result = users;
    if (filter !== 'all') result = result.filter(u => u.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [users, filter, search]);

  // ── User Metrics ───────────────────────────────────────
  const userMetrics = useMemo(() => {
    const total = users.length;
    const activeCount = users.filter(u => u.status === 'active').length;
    const disabledCount = users.filter(u => u.status === 'disabled').length;
    const adminCount = users.filter(u => u.role === UserRole.ADMIN).length;
    const clientCount = users.filter(u => u.role === UserRole.CLIENT).length;
    const activeRate = total > 0 ? Math.round((activeCount / total) * 100) : 0;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thisWeek = users.filter(u => u.createdAt && new Date(u.createdAt) >= weekAgo).length;
    const thisMonth = users.filter(u => u.createdAt && new Date(u.createdAt) >= monthAgo).length;

    const avgCreditsUsed = total > 0 ? Math.round(users.reduce((a, u) => a + (u.credits_used || 0), 0) / total) : 0;
    const totalCreditsUsed = users.reduce((a, u) => a + (u.credits_used || 0), 0);
    const totalCreditsAvail = users.reduce((a, u) => a + (u.credits_total || 500), 0);
    const platformUtilization = totalCreditsAvail > 0 ? Math.round((totalCreditsUsed / totalCreditsAvail) * 100) : 0;

    const weeklySignups = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const count = users.filter(u => {
        if (!u.createdAt) return false;
        const created = new Date(u.createdAt);
        return created >= dayStart && created < dayEnd;
      }).length;
      return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), count };
    });

    return {
      total, activeCount, disabledCount, adminCount, clientCount, activeRate,
      thisWeek, thisMonth, avgCreditsUsed, platformUtilization, weeklySignups
    };
  }, [users]);

  // ── Plan Analytics ─────────────────────────────────────
  const planAnalytics = useMemo(() => {
    const plans: Record<string, { count: number; price: number; color: string }> = {
      Free: { count: 0, price: 0, color: 'bg-slate-400' },
      Starter: { count: 0, price: 59, color: 'bg-emerald-500' },
      Growth: { count: 0, price: 149, color: 'bg-indigo-500' },
      Scale: { count: 0, price: 199, color: 'bg-violet-500' },
    };
    users.forEach(u => {
      let planName = u.subscription?.plan_name || u.plan || 'Free';
      if (planName === 'Professional') planName = 'Growth';
      if (planName === 'Enterprise' || planName === 'Business') planName = 'Scale';
      if (plans[planName]) plans[planName].count++;
      else plans.Free.count++;
    });

    const totalPaid = plans.Starter.count + plans.Growth.count + plans.Scale.count;
    const mrr = plans.Starter.count * 29 + plans.Growth.count * 79 + plans.Scale.count * 199;
    const arpu = totalPaid > 0 ? Math.round(mrr / totalPaid) : 0;
    const conversionRate = users.length > 0 ? Math.round((totalPaid / users.length) * 100) : 0;
    const projectedAnnual = mrr * 12;
    const upgradePool = plans.Free.count;
    const potentialRevenue = upgradePool * 59;

    const distribution = Object.entries(plans).map(([name, data]) => ({
      name,
      ...data,
      pct: users.length > 0 ? Math.round((data.count / users.length) * 100) : 0
    }));

    return { distribution, mrr, arpu, conversionRate, projectedAnnual, upgradePool, potentialRevenue, totalPaid };
  }, [users]);

  // ── Risk Assessment ────────────────────────────────────
  const riskAssessment = useMemo(() => {
    const highUsage = users.filter(u => {
      const used = u.credits_used || 0;
      const total = u.credits_total || 500;
      return (used / total) > 0.8;
    });
    const criticalUsage = users.filter(u => {
      const used = u.credits_used || 0;
      const total = u.credits_total || 500;
      return (used / total) > 0.95;
    });
    const disabledAccounts = users.filter(u => u.status === 'disabled');
    const noActivity = users.filter(u => (u.credits_used || 0) === 0);
    const admins = users.filter(u => u.role === UserRole.ADMIN);

    const riskScore = Math.min(100, Math.round(
      (criticalUsage.length > 0 ? 30 : 0) +
      (highUsage.length > 2 ? 20 : highUsage.length > 0 ? 10 : 0) +
      (disabledAccounts.length > 0 ? 15 : 0) +
      (admins.length > 2 ? 15 : 0) +
      (noActivity.length > users.length * 0.5 && users.length > 0 ? 20 : noActivity.length > 0 ? 5 : 0)
    ));

    const alerts: { label: string; severity: 'critical' | 'warning' | 'info'; count: number }[] = [];
    if (criticalUsage.length > 0) alerts.push({ label: 'Critical credit usage (>95%)', severity: 'critical', count: criticalUsage.length });
    if (highUsage.length > 0) alerts.push({ label: 'High credit usage (>80%)', severity: 'warning', count: highUsage.length });
    if (disabledAccounts.length > 0) alerts.push({ label: 'Disabled accounts', severity: 'warning', count: disabledAccounts.length });
    if (noActivity.length > 0) alerts.push({ label: 'Zero activity users', severity: 'info', count: noActivity.length });
    if (admins.length > 2) alerts.push({ label: 'Multiple admin accounts', severity: 'warning', count: admins.length });

    return { riskScore, highUsage, criticalUsage, disabledAccounts, noActivity, alerts };
  }, [users]);

  // ── KPI Stats Row ──────────────────────────────────────
  const kpiStats = useMemo(() => [
    { label: 'Total Users', value: userMetrics.total.toString(), icon: UsersIcon, color: 'bg-blue-50 text-blue-600', sub: `+${userMetrics.thisWeek} this week` },
    { label: 'Active', value: userMetrics.activeCount.toString(), icon: CheckIcon, color: 'bg-emerald-50 text-emerald-600', sub: `${userMetrics.activeRate}% rate` },
    { label: 'Paid Plans', value: planAnalytics.totalPaid.toString(), icon: CreditCardIcon, color: 'bg-indigo-50 text-indigo-600', sub: `${planAnalytics.conversionRate}% conv.` },
    { label: 'MRR', value: `$${planAnalytics.mrr.toLocaleString()}`, icon: TrendUpIcon, color: 'bg-amber-50 text-amber-600', sub: `$${planAnalytics.arpu} ARPU` },
    { label: 'Risk Alerts', value: riskAssessment.alerts.length.toString(), icon: AlertTriangleIcon, color: 'bg-rose-50 text-rose-600', sub: riskAssessment.riskScore > 50 ? 'Needs review' : 'Healthy' },
    { label: 'Utilization', value: `${userMetrics.platformUtilization}%`, icon: ActivityIcon, color: 'bg-purple-50 text-purple-600', sub: `${userMetrics.avgCreditsUsed} avg used` },
  ], [userMetrics, planAnalytics, riskAssessment]);

  // ── Keyboard Shortcuts ─────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const key = e.key.toLowerCase();
      if (key === 'j' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setSelectedIdx(prev => Math.min(prev + 1, filteredUsers.length - 1)); }
      else if (key === 'k' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setSelectedIdx(prev => Math.max(prev - 1, 0)); }
      else if (key === 'r' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); fetchUsers(); }
      else if (key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); document.getElementById('user-search')?.focus(); }
      else if (key === 'f' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setFilter(prev => prev === 'all' ? 'active' : prev === 'active' ? 'disabled' : 'all'); }
      else if (key === 'm' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowUserMetrics(v => !v); }
      else if (key === 'p' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowPlanAnalytics(v => !v); }
      else if (key === 'a' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setShowRiskAssessment(v => !v); }
      else if (key === '?' || (e.shiftKey && key === '/')) { e.preventDefault(); setShowShortcuts(v => !v); }
      else if (key === 'escape') {
        setShowShortcuts(false); setShowUserMetrics(false); setShowPlanAnalytics(false); setShowRiskAssessment(false);
        setSelectedIdx(-1);
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredUsers.length]);

  const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  HEADER                                                       */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight font-heading">User Directory</h1>
          <p className="text-slate-500 mt-1">Global account control and privilege management system.</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowUserMetrics(v => !v)}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${showUserMetrics ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
          >
            <UsersIcon className="w-3.5 h-3.5" />
            <span>Metrics</span>
          </button>
          <button
            onClick={() => setShowPlanAnalytics(v => !v)}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${showPlanAnalytics ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}
          >
            <PieChartIcon className="w-3.5 h-3.5" />
            <span>Plans</span>
          </button>
          <button
            onClick={() => setShowRiskAssessment(v => !v)}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${showRiskAssessment ? 'bg-rose-600 text-white shadow-lg shadow-rose-200' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
          >
            <AlertTriangleIcon className="w-3.5 h-3.5" />
            <span>Risk</span>
          </button>
          <div className="w-px h-6 bg-slate-200" />
          <button
            onClick={() => setShowShortcuts(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all"
          >
            <KeyboardIcon className="w-3.5 h-3.5" />
            <span>?</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  KPI STATS ROW                                                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiStats.map((stat, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-all group">
            <div className="flex items-center space-x-2 mb-2">
              <div className={`p-1.5 rounded-lg ${stat.color}`}>
                <stat.icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 font-heading group-hover:text-indigo-600 transition-colors">{loading ? '...' : stat.value}</p>
            {stat.sub && !loading && (
              <p className="text-[10px] font-semibold text-emerald-600 mt-1">{stat.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  FILTER + SEARCH BAR                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {['all', 'active', 'disabled'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${filter === f ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-900'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative">
          <input
            id="user-search"
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-64 px-4 py-2 pl-9 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[9px] font-mono font-bold text-slate-400" style={{ display: search ? 'none' : 'block' }}>/</kbd>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  USER TABLE                                                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-24 text-center">
            <div className="w-12 h-12 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Accessing Neural Directory...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-24 text-center">
            <UsersIcon className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-sm font-bold text-slate-400">No users match your criteria</p>
            <p className="text-xs text-slate-300 mt-1">Try adjusting your filter or search query</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">
              <tr>
                <th className="px-8 py-5">Identity Node</th>
                <th className="px-8 py-5">Subscription Tier</th>
                <th className="px-8 py-5 text-center">Compute Load</th>
                <th className="px-8 py-5">Status / Role</th>
                <th className="px-8 py-5">Registered</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user: any, idx: number) => {
                const creditsUsed = user.credits_used || 0;
                const creditsTotal = user.credits_total || 500;
                const usagePercent = Math.min((creditsUsed / creditsTotal) * 100, 100);
                const currentPlan = user.subscription?.plan_name || user.plan || 'Free';
                const isSelected = idx === selectedIdx;

                return (
                  <tr
                    key={user.id}
                    className={`transition-colors group ${isSelected ? 'bg-indigo-50/60 ring-1 ring-inset ring-indigo-200' : 'hover:bg-slate-50/50'}`}
                    onClick={() => setSelectedIdx(idx)}
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-sm border uppercase ${user.role === UserRole.ADMIN ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                          {user.name?.charAt(0) || user.email?.charAt(0) || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate font-heading">{user.name || 'Anonymous'}</p>
                          <p className="text-[10px] text-slate-400 font-mono tracking-tighter truncate max-w-[180px]">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center space-x-2">
                        <div className="p-1.5 bg-slate-50 rounded-lg group-hover:bg-indigo-50 transition-colors">
                           <CreditCardIcon className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                        </div>
                        <span className="text-xs font-bold text-slate-700">{currentPlan}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col items-center space-y-1">
                        <div className="w-24 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${usagePercent > 80 ? 'bg-red-500' : usagePercent > 50 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                            style={{ width: `${usagePercent}%` }}
                          ></div>
                        </div>
                        <span className="text-[9px] font-black text-slate-400 tracking-tighter uppercase">{creditsUsed.toLocaleString()} / {creditsTotal.toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col space-y-1.5">
                        <span className={`px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest w-fit border ${
                          user.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'
                        }`}>
                          {user.status}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest w-fit border ${
                          user.role === UserRole.ADMIN ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-slate-50 text-slate-600 border-slate-100'
                        }`}>
                          {user.role}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs text-slate-500">{formatRelativeTime(user.createdAt)}</span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <select
                          value={currentPlan}
                          onChange={e => changeUserPlan(user.id, e.target.value)}
                          disabled={changingPlanFor === user.id}
                          className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest rounded-lg border transition-all outline-none ${
                            changingPlanFor === user.id
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-wait'
                              : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-100'
                          }`}
                        >
                          {availablePlans.map(plan => (
                            <option key={plan.id} value={plan.name}>{plan.name}</option>
                          ))}
                          {!availablePlans.find(p => p.name === currentPlan) && (
                            <option value={currentPlan}>{currentPlan}</option>
                          )}
                        </select>
                        <button
                          onClick={() => toggleUserRole(user.id, user.role)}
                          disabled={isProcessing === user.id}
                          className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-transparent hover:border-indigo-100"
                        >
                          {isProcessing === user.id ? 'Updating...' : 'Switch Role'}
                        </button>
                        <button
                          onClick={() => toggleUserStatus(user.id, user.status)}
                          disabled={isProcessing === user.id}
                          className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all border ${
                            user.status === 'active'
                              ? 'text-red-600 hover:bg-red-50 border-transparent hover:border-red-100'
                              : 'text-emerald-600 hover:bg-emerald-50 border-transparent hover:border-emerald-100'
                          }`}
                        >
                          {isProcessing === user.id ? 'Updating...' : (user.status === 'active' ? 'Deactivate' : 'Restore')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Table Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3 text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">
          <ShieldIcon className="w-4 h-4" />
          <span>Admin Overrides Active</span>
        </div>
        <div className="flex items-center space-x-4 text-[10px] font-bold text-slate-400">
          <span>{filteredUsers.length} of {users.length} users shown</span>
          <button onClick={() => setShowShortcuts(true)} className="flex items-center space-x-1 px-2 py-1 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
            <KeyboardIcon className="w-3 h-3" />
            <span>Shortcuts</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  USER METRICS SIDEBAR                                         */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showUserMetrics && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowUserMetrics(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-500">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                    <UsersIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 font-heading">User Metrics</h2>
                    <p className="text-xs text-slate-400">Engagement & activity breakdown</p>
                  </div>
                </div>
                <button onClick={() => setShowUserMetrics(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <XIcon className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Active Rate Gauge */}
              <div className="text-center">
                <svg viewBox="0 0 96 96" className="w-28 h-28 mx-auto">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                  <circle cx="48" cy="48" r="40" fill="none"
                    stroke={userMetrics.activeRate >= 80 ? '#10b981' : userMetrics.activeRate >= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(userMetrics.activeRate / 100) * 251.2} 251.2`}
                    transform="rotate(-90 48 48)" />
                  <text x="48" y="44" textAnchor="middle" className="text-2xl font-bold fill-slate-900" style={{ fontSize: '20px' }}>{userMetrics.activeRate}%</text>
                  <text x="48" y="58" textAnchor="middle" className="text-xs fill-slate-400" style={{ fontSize: '8px' }}>ACTIVE RATE</text>
                </svg>
                <p className="text-sm font-semibold text-slate-600 mt-2">{userMetrics.activeCount} active of {userMetrics.total} total</p>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-emerald-50 rounded-xl text-center border border-emerald-100">
                  <p className="text-2xl font-bold text-emerald-700 font-heading">{userMetrics.thisWeek}</p>
                  <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">This Week</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-xl text-center border border-blue-100">
                  <p className="text-2xl font-bold text-blue-700 font-heading">{userMetrics.thisMonth}</p>
                  <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">This Month</p>
                </div>
                <div className="p-4 bg-indigo-50 rounded-xl text-center border border-indigo-100">
                  <p className="text-2xl font-bold text-indigo-700 font-heading">{userMetrics.avgCreditsUsed}</p>
                  <p className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest">Avg Credits</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-xl text-center border border-purple-100">
                  <p className="text-2xl font-bold text-purple-700 font-heading">{userMetrics.platformUtilization}%</p>
                  <p className="text-[9px] font-bold text-purple-500 uppercase tracking-widest">Utilization</p>
                </div>
              </div>

              {/* Role Distribution */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Role Distribution</h4>
                {[
                  { role: 'Admin', count: userMetrics.adminCount, color: 'bg-purple-500', textColor: 'text-purple-600' },
                  { role: 'Client', count: userMetrics.clientCount, color: 'bg-blue-500', textColor: 'text-blue-600' },
                ].map((r, i) => {
                  const pct = userMetrics.total > 0 ? Math.round((r.count / userMetrics.total) * 100) : 0;
                  return (
                    <div key={i} className="p-3 bg-slate-50 rounded-xl">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${r.color}`} />
                          <span className="text-sm font-semibold text-slate-700">{r.role}</span>
                        </div>
                        <span className={`text-xs font-bold ${r.textColor}`}>{r.count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${r.color} rounded-full transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Weekly Signups Sparkline */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Weekly Signups</h4>
                <div className="bg-slate-900 rounded-xl p-5">
                  <div className="flex items-end space-x-2 h-24">
                    {userMetrics.weeklySignups.map((d, i) => {
                      const maxVal = Math.max(...userMetrics.weeklySignups.map(v => v.count), 1);
                      const h = (d.count / maxVal) * 100;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end space-y-1">
                          <span className="text-[9px] font-bold text-emerald-300">{d.count}</span>
                          <div className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400" style={{ height: `${Math.max(h, 8)}%` }} />
                          <span className="text-[8px] font-bold text-slate-500">{d.day}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status Breakdown</h4>
                <div className="flex items-center space-x-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <CheckIcon className="w-4 h-4 text-emerald-600" />
                  <div className="flex-grow">
                    <span className="text-sm font-semibold text-emerald-800">Active</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-700">{userMetrics.activeCount}</span>
                </div>
                <div className="flex items-center space-x-3 p-3 bg-red-50 rounded-xl border border-red-100">
                  <XIcon className="w-4 h-4 text-red-600" />
                  <div className="flex-grow">
                    <span className="text-sm font-semibold text-red-800">Disabled</span>
                  </div>
                  <span className="text-sm font-bold text-red-700">{userMetrics.disabledCount}</span>
                </div>
              </div>

              {/* Insight */}
              <div className="p-4 bg-gradient-to-r from-emerald-50 to-green-50 rounded-2xl border border-emerald-100">
                <div className="flex items-center space-x-2 mb-2">
                  <BrainIcon className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-sm font-bold text-emerald-800">User Insight</h4>
                </div>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  {userMetrics.activeRate >= 80
                    ? 'Excellent user engagement. Most accounts are active and utilizing the platform. Consider launching power-user features.'
                    : userMetrics.activeRate >= 50
                    ? 'Moderate engagement. Focus on onboarding flows and re-engagement emails to convert inactive users.'
                    : userMetrics.total === 0
                    ? 'No users registered yet. Launch marketing campaigns and referral programs to drive initial signups.'
                    : 'Low activation rate. Review the onboarding experience and consider offering guided setup wizards.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PLAN ANALYTICS SIDEBAR                                       */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showPlanAnalytics && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowPlanAnalytics(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-500">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                    <PieChartIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 font-heading">Plan Analytics</h2>
                    <p className="text-xs text-slate-400">Subscription tiers & revenue</p>
                  </div>
                </div>
                <button onClick={() => setShowPlanAnalytics(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <XIcon className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* MRR Headline */}
              <div className="text-center p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100">
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Monthly Recurring Revenue</p>
                <p className="text-4xl font-bold text-indigo-700 font-heading">${planAnalytics.mrr.toLocaleString()}</p>
                <p className="text-xs text-indigo-500 mt-1">Projected Annual: ${planAnalytics.projectedAnnual.toLocaleString()}</p>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-slate-900 font-heading">${planAnalytics.arpu}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">ARPU</p>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-slate-900 font-heading">{planAnalytics.conversionRate}%</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Conv. Rate</p>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-slate-900 font-heading">{planAnalytics.upgradePool}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Free Users</p>
                </div>
                <div className="p-4 bg-white border border-slate-200 rounded-xl text-center">
                  <p className="text-2xl font-bold text-slate-900 font-heading">${planAnalytics.potentialRevenue}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Potential</p>
                </div>
              </div>

              {/* Plan Distribution */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Plan Distribution</h4>
                {planAnalytics.distribution.map((p, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${p.color}`} />
                        <span className="text-sm font-semibold text-slate-700">{p.name}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-500">{p.count} ({p.pct}%)</span>
                        <span className="text-[10px] font-bold text-slate-400">${p.price}/mo</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full ${p.color} rounded-full transition-all`} style={{ width: `${Math.max(p.pct, 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Revenue Breakdown Chart */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue by Tier</h4>
                <div className="bg-slate-900 rounded-xl p-5">
                  <div className="space-y-3">
                    {planAnalytics.distribution.filter(p => p.price > 0).map((p, i) => {
                      const rev = p.count * p.price;
                      const pct = planAnalytics.mrr > 0 ? Math.round((rev / planAnalytics.mrr) * 100) : 0;
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-white">{p.name}</span>
                            <span className="text-xs font-bold text-indigo-300">${rev.toLocaleString()}/mo</span>
                          </div>
                          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full bg-gradient-to-r ${p.name === 'Starter' ? 'from-emerald-600 to-emerald-400' : p.name === 'Scale' ? 'from-violet-600 to-violet-400' : 'from-indigo-600 to-indigo-400'}`} style={{ width: `${Math.max(pct, 5)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Upgrade Funnel */}
              <div className="p-4 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100">
                <div className="flex items-center space-x-2 mb-3">
                  <TrendUpIcon className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-indigo-800">Upgrade Opportunity</h4>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-indigo-700">Free → Starter potential</span>
                    <span className="font-bold text-indigo-800">{planAnalytics.upgradePool} users</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-indigo-700">Potential MRR increase</span>
                    <span className="font-bold text-indigo-800">${planAnalytics.potentialRevenue}/mo</span>
                  </div>
                </div>
              </div>

              {/* Insight */}
              <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100">
                <div className="flex items-center space-x-2 mb-2">
                  <BrainIcon className="w-4 h-4 text-purple-600" />
                  <h4 className="text-sm font-bold text-purple-800">Plan Insight</h4>
                </div>
                <p className="text-xs text-purple-700 leading-relaxed">
                  {planAnalytics.conversionRate >= 40
                    ? 'Strong conversion rate! Consider adding a higher tier or add-on services to maximize ARPU.'
                    : planAnalytics.conversionRate >= 15
                    ? 'Moderate conversion. Implement trial-to-paid nudges and highlight premium feature value to free users.'
                    : planAnalytics.upgradePool > 0
                    ? 'Large free user base presents upgrade opportunity. Consider time-limited trials or feature teasing.'
                    : 'Focus on growing the user base first. Strong product-market fit will naturally drive conversions.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  RISK ASSESSMENT SIDEBAR                                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showRiskAssessment && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowRiskAssessment(false)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-500">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                    <AlertTriangleIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 font-heading">Risk Assessment</h2>
                    <p className="text-xs text-slate-400">Account health & security flags</p>
                  </div>
                </div>
                <button onClick={() => setShowRiskAssessment(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <XIcon className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Risk Score Gauge */}
              <div className="text-center">
                <svg viewBox="0 0 96 96" className="w-28 h-28 mx-auto">
                  <circle cx="48" cy="48" r="40" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                  <circle cx="48" cy="48" r="40" fill="none"
                    stroke={riskAssessment.riskScore <= 25 ? '#10b981' : riskAssessment.riskScore <= 50 ? '#f59e0b' : '#ef4444'}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(riskAssessment.riskScore / 100) * 251.2} 251.2`}
                    transform="rotate(-90 48 48)" />
                  <text x="48" y="44" textAnchor="middle" className="text-2xl font-bold fill-slate-900" style={{ fontSize: '20px' }}>{riskAssessment.riskScore}</text>
                  <text x="48" y="58" textAnchor="middle" className="text-xs fill-slate-400" style={{ fontSize: '8px' }}>RISK SCORE</text>
                </svg>
                <p className="text-sm font-semibold text-slate-600 mt-2">
                  {riskAssessment.riskScore <= 25 ? 'Low Risk — All Clear' : riskAssessment.riskScore <= 50 ? 'Moderate Risk — Review Recommended' : 'High Risk — Action Needed'}
                </p>
              </div>

              {/* Active Alerts */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Alerts ({riskAssessment.alerts.length})</h4>
                {riskAssessment.alerts.length === 0 ? (
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-center">
                    <CheckIcon className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                    <p className="text-sm font-semibold text-emerald-700">No active alerts</p>
                  </div>
                ) : (
                  riskAssessment.alerts.map((a, i) => (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${
                      a.severity === 'critical' ? 'bg-red-50 border-red-100' :
                      a.severity === 'warning' ? 'bg-amber-50 border-amber-100' :
                      'bg-blue-50 border-blue-100'
                    }`}>
                      <div className="flex items-center space-x-2.5">
                        <span className={`w-2 h-2 rounded-full ${
                          a.severity === 'critical' ? 'bg-red-500' :
                          a.severity === 'warning' ? 'bg-amber-500' :
                          'bg-blue-500'
                        }`} />
                        <span className={`text-sm font-medium ${
                          a.severity === 'critical' ? 'text-red-700' :
                          a.severity === 'warning' ? 'text-amber-700' :
                          'text-blue-700'
                        }`}>{a.label}</span>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                        a.severity === 'critical' ? 'bg-red-100 text-red-600' :
                        a.severity === 'warning' ? 'bg-amber-100 text-amber-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>{a.count}</span>
                    </div>
                  ))
                )}
              </div>

              {/* At-Risk Users */}
              {riskAssessment.highUsage.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">High Usage Accounts</h4>
                  <div className="bg-slate-900 rounded-xl p-4 space-y-3">
                    {riskAssessment.highUsage.slice(0, 5).map((u: any) => {
                      const used = u.credits_used || 0;
                      const total = u.credits_total || 500;
                      const pct = Math.round((used / total) * 100);
                      return (
                        <div key={u.id} className="flex items-center space-x-3">
                          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                            {(u.name || '?').charAt(0)}
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{u.name || 'Anonymous'}</p>
                            <div className="h-1 bg-slate-700 rounded-full overflow-hidden mt-1">
                              <div className={`h-full rounded-full ${pct > 95 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <span className={`text-[10px] font-bold ${pct > 95 ? 'text-red-400' : 'text-amber-400'}`}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Risk Factors */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-rose-50 rounded-xl text-center border border-rose-100">
                  <p className="text-2xl font-bold text-rose-700 font-heading">{riskAssessment.criticalUsage.length}</p>
                  <p className="text-[9px] font-bold text-rose-500 uppercase tracking-widest">Critical</p>
                </div>
                <div className="p-4 bg-amber-50 rounded-xl text-center border border-amber-100">
                  <p className="text-2xl font-bold text-amber-700 font-heading">{riskAssessment.highUsage.length}</p>
                  <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">High Usage</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center border border-slate-200">
                  <p className="text-2xl font-bold text-slate-700 font-heading">{riskAssessment.noActivity.length}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Dormant</p>
                </div>
                <div className="p-4 bg-red-50 rounded-xl text-center border border-red-100">
                  <p className="text-2xl font-bold text-red-700 font-heading">{riskAssessment.disabledAccounts.length}</p>
                  <p className="text-[9px] font-bold text-red-500 uppercase tracking-widest">Disabled</p>
                </div>
              </div>

              {/* Insight */}
              <div className="p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-2xl border border-rose-100">
                <div className="flex items-center space-x-2 mb-2">
                  <ShieldIcon className="w-4 h-4 text-rose-600" />
                  <h4 className="text-sm font-bold text-rose-800">Risk Insight</h4>
                </div>
                <p className="text-xs text-rose-700 leading-relaxed">
                  {riskAssessment.riskScore <= 25
                    ? 'Platform risk level is low. All accounts are within healthy parameters. Continue routine monitoring.'
                    : riskAssessment.riskScore <= 50
                    ? 'Some accounts need attention. Consider reaching out to high-usage users about plan upgrades and reviewing dormant accounts.'
                    : 'Multiple risk factors detected. Prioritize reviewing critical-usage accounts, consider automated credit limit alerts, and audit disabled accounts.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  KEYBOARD SHORTCUTS MODAL                                     */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                  <KeyboardIcon className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-black text-slate-900">User Management Shortcuts</h2>
              </div>
              <button onClick={() => setShowShortcuts(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="p-6 grid grid-cols-3 gap-x-6 gap-y-3 max-h-96 overflow-y-auto">
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Navigation</p>
                {[
                  { key: 'J', action: 'Next user' },
                  { key: 'K', action: 'Previous user' },
                  { key: '/', action: 'Focus search' },
                  { key: 'F', action: 'Cycle filter' },
                ].map((sc, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">{sc.action}</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono font-bold text-slate-700">{sc.key}</kbd>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Panels</p>
                {[
                  { key: 'M', action: 'User Metrics' },
                  { key: 'P', action: 'Plan Analytics' },
                  { key: 'A', action: 'Risk Assessment' },
                ].map((sc, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">{sc.action}</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono font-bold text-slate-700">{sc.key}</kbd>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Actions</p>
                {[
                  { key: 'R', action: 'Refresh data' },
                  { key: '?', action: 'Shortcuts' },
                  { key: 'Esc', action: 'Close / deselect' },
                ].map((sc, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">{sc.action}</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono font-bold text-slate-700">{sc.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[10px] text-slate-400">Press <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-bold">Esc</kbd> to close</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;

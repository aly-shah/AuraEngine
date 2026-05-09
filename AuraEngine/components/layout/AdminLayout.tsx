import React, { Suspense, useState } from 'react';
import { Outlet } from 'react-router-dom';
import {
  BarChart3, Users, Sparkles, Zap, Target, PenSquare,
  Shield, Lock, Settings, LogOut, DollarSign, Headphones, Wrench, Terminal, LayoutDashboard
} from 'lucide-react';
import { User } from '../../types';
import { BRAND } from '../../lib/brand';
import { canEnterSupport } from '../../lib/permissions';
import ErrorBoundary from '../ErrorBoundary';
import PortalContentSkeleton from '../skeletons/PortalContentSkeleton';
import { AppShell } from './AppShell';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BrandLogo } from './BrandLogo';
import { ActivityPanel } from '../activity/ActivityPanel';

interface AdminLayoutProps {
  user: User;
  onLogout: () => void;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ user, onLogout }) => {

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const navItems = [
    { label: 'Overview', path: '/admin', icon: <BarChart3 size={20} /> },
    { label: 'Admin Console', path: '/admin/console', icon: <LayoutDashboard size={20} /> },
    { label: 'User Directory', path: '/admin/users', icon: <Users size={20} /> },
    { label: 'Neural Analytics', path: '/admin/ai', icon: <Sparkles size={20} /> },
    { label: 'DNA Registry', path: '/admin/prompts', icon: <Zap size={20} /> },
    { label: 'Global Leads', path: '/admin/leads', icon: <Target size={20} /> },
    { label: 'Blog Engine', path: '/admin/blog', icon: <PenSquare size={20} /> },
    { label: 'System Integrity', path: '/admin/health', icon: <Shield size={20} /> },
    { label: 'Audit Vault', path: '/admin/audit', icon: <Lock size={20} /> },
    { label: 'Pricing Management', path: '/admin/pricing', icon: <DollarSign size={20} /> },
    { label: 'Platform Settings', path: '/admin/settings', icon: <Settings size={20} /> },
    { label: 'Ops Center', path: '/admin/ops', icon: <Wrench size={20} /> },
    { label: 'Command Center', path: '/admin/command', icon: <Terminal size={20} /> },
  ];

  if (canEnterSupport(user)) {
    navItems.push({ label: 'Support Console', path: '/admin/support', icon: <Headphones size={20} /> });
  }

  return (
    <>
    <AppShell
      sidebarCollapsed={sidebarCollapsed}
      sidebar={
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(prev => !prev)}
          navItems={navItems}
          header={<BrandLogo />}
          headerCollapsed={<BrandLogo collapsed />}
          footer={
            sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || 'A'}
                </div>
                <button onClick={onLogout} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors duration-150">
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm shrink-0 uppercase">
                      {user?.name?.charAt(0) || user?.email?.charAt(0) || 'A'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{user?.name || 'Admin'}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Administrator</p>
                    </div>
                  </div>
                  <button onClick={onLogout} className="p-2 text-gray-300 hover:text-red-500 transition-colors duration-150">
                    <LogOut size={16} />
                  </button>
                </div>
              </>
            )
          }
        />
      }
      topbar={
        <Topbar
          actions={
            <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-3 py-1 rounded-full uppercase tracking-widest">{BRAND.version}</span>
          }
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-75"></div>
            </div>
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Sentinel Online</span>
          </div>
        </Topbar>
      }
    >
      <ErrorBoundary>
        <Suspense fallback={<PortalContentSkeleton />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
    <ActivityPanel />
    </>
  );
};

export default AdminLayout;

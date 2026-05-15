import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeJobs } from '../../../hooks/useRealtimeJobs';
import { resolveWorkspaceForUser } from '../../../lib/memory';
import type { User } from '../../../types';
import type { Job } from '../../../lib/jobs';

interface LayoutContext {
  user: User;
}

function statusStyle(status: Job['status']): string {
  switch (status) {
    case 'succeeded': return 'bg-emerald-100 text-emerald-700';
    case 'failed': return 'bg-red-100 text-red-700';
    case 'running': return 'bg-blue-100 text-blue-700';
    case 'queued': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const MobileActivity: React.FC = () => {
  const { user } = useOutletContext<LayoutContext>();
  const { data: workspaceId = null } = useQuery<string | null>({
    queryKey: ['mobile-activity-workspace', user.id],
    queryFn: () => resolveWorkspaceForUser(user.id),
    staleTime: 5 * 60_000,
  });
  const { jobs, mode, connectionStatus, refresh } = useRealtimeJobs({ workspaceId, limit: 50 });

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-gray-900 tracking-tight">Activity</h1>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Live job & task updates</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-emerald-500' : connectionStatus === 'error' ? 'bg-red-500' : 'bg-amber-500'
          }`} />
          <span className="text-[10px] font-bold text-gray-400 uppercase">
            {mode === 'realtime' ? 'Live' : mode === 'polling' ? 'Polling' : 'Idle'}
          </span>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 border border-gray-100 text-center">
          <p className="text-sm text-gray-400">No recent activity</p>
          <p className="text-xs text-gray-300 mt-1">Jobs and tasks will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <div key={job.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {job.type?.replace(/_/g, ' ') || 'Job'}
                  </p>
                  {job.result && typeof job.result === 'object' && 'description' in job.result && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {String(job.result.description)}
                    </p>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black shrink-0 ${statusStyle(job.status)}`}>
                  {job.status}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-gray-400">
                  {job.created_at ? formatTime(job.created_at) : ''}
                </span>
                {job.status === 'running' && job.progress_total > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(Math.round((job.progress_current / job.progress_total) * 100), 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400">{job.progress_current}/{job.progress_total}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={refresh}
        className="w-full py-3 text-center text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors"
      >
        Tap to refresh
      </button>
    </div>
  );
};

export default MobileActivity;

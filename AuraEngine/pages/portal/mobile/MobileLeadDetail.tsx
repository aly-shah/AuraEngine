import React from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, Globe, Linkedin, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { cacheKeys, staleTimes } from '../../../lib/cacheKeys';
import type { User, Lead } from '../../../types';

interface LayoutContext {
  user: User;
}

const STATUS_COLORS: Record<string, string> = {
  New: 'bg-blue-100 text-blue-700',
  Contacted: 'bg-amber-100 text-amber-700',
  Qualified: 'bg-indigo-100 text-indigo-700',
  Converted: 'bg-emerald-100 text-emerald-700',
  Lost: 'bg-gray-100 text-gray-500',
};

async function fetchLead(leadId: string): Promise<Lead | null> {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  return data as Lead | null;
}

const MobileLeadDetail: React.FC = () => {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { user } = useOutletContext<LayoutContext>();

  const { data: lead, isLoading } = useQuery<Lead | null>({
    queryKey: [...cacheKeys.lead(leadId ?? ''), 'mobile'],
    queryFn: () => fetchLead(leadId!),
    staleTime: staleTimes.fast,
    enabled: !!leadId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-3 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-gray-400">Lead not found</p>
        <button onClick={() => navigate(-1)} className="mt-3 text-sm font-bold text-indigo-600">Go back</button>
      </div>
    );
  }

  const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';

  return (
    <div className="pb-8">
      {/* Back header */}
      <div className="flex items-center gap-2 px-4 py-3 sticky top-0 bg-gray-50 z-10">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-sm font-bold text-gray-900 truncate">{fullName}</h1>
      </div>

      {/* Profile Card */}
      <div className="px-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-xl shrink-0">
              {lead.first_name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-black text-gray-900">{fullName}</h2>
              {lead.title && <p className="text-xs text-gray-500 mt-0.5">{lead.title}</p>}
              <p className="text-xs text-gray-400 mt-0.5">{lead.company}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${STATUS_COLORS[lead.status] || 'bg-gray-100 text-gray-500'}`}>
                  {lead.status}
                </span>
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${
                  lead.score >= 80 ? 'bg-rose-100 text-rose-700' : lead.score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  Score: {lead.score}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2">
          {lead.primary_email && (
            <a
              href={`mailto:${lead.primary_email}`}
              className="flex items-center gap-2 bg-white rounded-xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform"
            >
              <Mail size={16} className="text-indigo-600" />
              <span className="text-xs font-bold text-gray-700">Email</span>
            </a>
          )}
          {lead.primary_phone && (
            <a
              href={`tel:${lead.primary_phone}`}
              className="flex items-center gap-2 bg-white rounded-xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform"
            >
              <Phone size={16} className="text-emerald-600" />
              <span className="text-xs font-bold text-gray-700">Call</span>
            </a>
          )}
          {lead.linkedin_url && (
            <a
              href={lead.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white rounded-xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform"
            >
              <Linkedin size={16} className="text-blue-600" />
              <span className="text-xs font-bold text-gray-700">LinkedIn</span>
            </a>
          )}
          {lead.knowledgeBase?.website && (
            <a
              href={lead.knowledgeBase.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white rounded-xl p-3 border border-gray-100 shadow-sm active:scale-95 transition-transform"
            >
              <Globe size={16} className="text-violet-600" />
              <span className="text-xs font-bold text-gray-700">Website</span>
            </a>
          )}
        </div>

        {/* Details */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {[
            { label: 'Email', value: lead.primary_email },
            { label: 'Phone', value: lead.primary_phone },
            { label: 'Company', value: lead.company },
            { label: 'Industry', value: lead.industry },
            { label: 'Location', value: lead.location },
            { label: 'Source', value: lead.source },
          ].filter(d => d.value).map(d => (
            <div key={d.label} className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-bold text-gray-400 uppercase">{d.label}</span>
              <span className="text-xs text-gray-700 font-medium truncate max-w-[60%] text-right">{d.value}</span>
            </div>
          ))}
        </div>

        {/* AI Insights */}
        {lead.insights && (
          <div className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100">
            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider mb-2">AI Insights</p>
            <p className="text-xs text-gray-700 leading-relaxed">{lead.insights}</p>
          </div>
        )}

        {/* Open on desktop — notes, activity timeline, sequence enrollments
            and the deeper enrichment surface aren't yet mobile-native. */}
        <button
          onClick={() => navigate(`/portal/leads/${lead.id}`)}
          className="w-full flex items-center justify-between bg-white rounded-2xl p-4 border border-gray-100 shadow-sm active:scale-[0.98] transition-transform"
        >
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-indigo-600">Open on desktop</span>
            <span className="text-[10px] text-gray-400 mt-0.5">Notes, activity, sequences</span>
          </div>
          <ExternalLink size={14} className="text-indigo-400" />
        </button>
      </div>
    </div>
  );
};

export default MobileLeadDetail;

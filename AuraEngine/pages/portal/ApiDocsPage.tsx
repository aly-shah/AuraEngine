// AuraEngine/pages/portal/ApiDocsPage.tsx
//
// Phase 4.2 — in-app reference for the public REST API.
// Self-contained renderer for the 4 v1 endpoints. Source of truth for
// the schema is docs/api/openapi.yaml (linked at top). This page is the
// "try it" surface — formatted curl examples + scope/auth notes.

import React, { useMemo, useState } from 'react';
import {
  BookOpen, Copy, Check, ExternalLink, Shield, Key, AlertCircle,
} from 'lucide-react';

interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  scope: string;
  summary: string;
  description: string;
  example: string;
}

const BASE = 'https://utvydxqiqedaaxmmpfpf.functions.supabase.co';

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path:   '/v1-leads',
    scope:  'leads.read',
    summary: 'List leads',
    description: 'Cursor-paginated list of leads in your workspace. Filter by status. Default limit 50, max 200.',
    example: `curl ${BASE}/v1-leads?limit=20 \\
  -H "Authorization: Bearer scal_..."`,
  },
  {
    method: 'POST',
    path:   '/v1-leads',
    scope:  'leads.write',
    summary: 'Create a lead',
    description: 'At least one of primary_email / primary_phone / linkedin_url is required. Pass Idempotency-Key to make retries safe.',
    example: `curl ${BASE}/v1-leads \\
  -X POST \\
  -H "Authorization: Bearer scal_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: \$(uuidgen)" \\
  -d '{
    "first_name": "Sarah",
    "last_name":  "Chen",
    "primary_email": "sarah@acme.com",
    "company": "Acme",
    "status":  "New"
  }'`,
  },
  {
    method: 'PATCH',
    path:   '/v1-leads?id=<uuid>',
    scope:  'leads.write',
    summary: 'Update a lead',
    description: 'Partial update. Only fields you supply are changed. Workspace-scoped — you cannot patch another workspace\'s lead even if you know its UUID.',
    example: `curl "${BASE}/v1-leads?id=<lead-uuid>" \\
  -X PATCH \\
  -H "Authorization: Bearer scal_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "Qualified", "score": 85 }'`,
  },
  {
    method: 'GET',
    path:   '/v1-sequences',
    scope:  'campaigns.read',
    summary: 'List email sequences',
    description: 'Cursor-paginated list of email sequence templates.',
    example: `curl ${BASE}/v1-sequences \\
  -H "Authorization: Bearer scal_..."`,
  },
  {
    method: 'POST',
    path:   '/v1-sequences',
    scope:  'campaigns.write',
    summary: 'Create an email sequence draft',
    description: 'Creates the sequence ROW only. Starting an actual send run is a separate workflow that involves the AI writer queue.',
    example: `curl ${BASE}/v1-sequences \\
  -X POST \\
  -H "Authorization: Bearer scal_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name":  "Q2 outbound",
    "goal":  "demo",
    "tone":  "professional"
  }'`,
  },
  {
    method: 'PATCH',
    path:   '/v1-sequences?id=<uuid>',
    scope:  'campaigns.write',
    summary: 'Update a sequence',
    description: 'Partial update of name / description / status / goal / tone.',
    example: `curl "${BASE}/v1-sequences?id=<sequence-uuid>" \\
  -X PATCH \\
  -H "Authorization: Bearer scal_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "active" }'`,
  },
  {
    method: 'GET',
    path:   '/v1-campaigns',
    scope:  'campaigns.read',
    summary: 'List sequence runs',
    description: 'Active and historical email_sequence_runs (what customers call "campaigns").',
    example: `curl ${BASE}/v1-campaigns \\
  -H "Authorization: Bearer scal_..."`,
  },
  {
    method: 'GET',
    path:   '/v1-analytics',
    scope:  'analytics.read',
    summary: 'Workspace analytics summary',
    description: 'Aggregate metrics: leads, sequences, email volume, DLQ counts, sender health. Range 7d/30d/90d.',
    example: `curl "${BASE}/v1-analytics?range=30d" \\
  -H "Authorization: Bearer scal_..."`,
  },
];

const METHOD_TONE: Record<Endpoint['method'], string> = {
  GET:   'bg-emerald-100 text-emerald-800',
  POST:  'bg-indigo-100 text-indigo-800',
  PATCH: 'bg-amber-100 text-amber-800',
};

const ApiDocsPage: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m: Record<string, Endpoint[]> = {};
    for (const e of ENDPOINTS) {
      const key = e.path.replace(/\?.*$/, '').replace(/^\/v1-/, '');
      (m[key] ??= []).push(e);
    }
    return m;
  }, []);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BookOpen size={20} className="text-indigo-500" />
          API Reference
        </h1>
        <p className="text-slate-600 mt-2 max-w-2xl">
          Personal-access-token authenticated REST API. Workspace-scoped via the
          token — endpoints derive your workspace from the key, never trust a
          client-side workspace_id param.
        </p>
      </header>

      {/* Auth + rate-limit panel */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <Shield size={11} /> Base URL
            </p>
            <p className="font-mono text-xs mt-1 break-all">{BASE}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <Key size={11} /> Auth
            </p>
            <p className="font-mono text-xs mt-1">Bearer scal_…</p>
            <a href="/portal/api-keys" className="text-xs text-indigo-600 hover:underline">Mint a key →</a>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
              <AlertCircle size={11} /> Rate limit
            </p>
            <p className="text-xs mt-1">60 requests / minute / key</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Full OpenAPI 3.1 spec:{' '}
          <a
            href="https://github.com/ZsnSolutions9920/AuraEngine/blob/main/docs/api/openapi.yaml"
            target="_blank" rel="noopener noreferrer"
            className="text-indigo-600 hover:underline inline-flex items-center gap-1"
          >
            docs/api/openapi.yaml <ExternalLink size={10} />
          </a>
        </p>
      </div>

      {/* Endpoints, grouped by resource */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([resource, endpoints]) => (
          <section key={resource} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900 capitalize">{resource}</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {endpoints.map((e) => (
                <article key={`${e.method}-${e.path}`} className="p-5 space-y-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold ${METHOD_TONE[e.method]} font-mono shrink-0`}>
                      {e.method}
                    </span>
                    <code className="font-mono text-sm text-slate-900 flex-1 break-all">{e.path}</code>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                      scope: {e.scope}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">{e.summary}</h3>
                  <p className="text-sm text-slate-600">{e.description}</p>
                  <div className="relative">
                    <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-xs overflow-x-auto"><code>{e.example}</code></pre>
                    <button
                      onClick={() => copy(`${e.method} ${e.path}`, e.example)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs"
                      title="Copy"
                    >
                      {copied === `${e.method} ${e.path}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Common error reference */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">Error codes</h2>
        <div className="space-y-2 text-sm">
          <ErrorRow status="401" code="missing_auth"        msg="No Authorization header" />
          <ErrorRow status="401" code="invalid_key"         msg="Token missing, expired, or revoked" />
          <ErrorRow status="403" code="missing_scope"       msg="Key lacks the scope required by the endpoint" />
          <ErrorRow status="400" code="bad_request"         msg="Body or query parameters are malformed" />
          <ErrorRow status="400" code="invalid_status"      msg="status field not in allowed enum" />
          <ErrorRow status="400" code="invalid_score"       msg="score outside 0..100" />
          <ErrorRow status="400" code="missing_id"          msg="PATCH requires ?id=<uuid>" />
          <ErrorRow status="404" code="not_found"           msg="Resource not in this workspace" />
          <ErrorRow status="409" code="idempotency_conflict" msg="Idempotency-Key reused with a different request body" />
          <ErrorRow status="429" code="rate_limited"        msg="60 req/min/key exceeded" />
          <ErrorRow status="500" code="query_failed"        msg="Server-side error; retry with backoff" />
        </div>
      </section>
    </div>
  );
};

const ErrorRow: React.FC<{ status: string; code: string; msg: string }> = ({ status, code, msg }) => (
  <div className="flex items-center gap-3 text-xs">
    <span className="font-mono font-bold w-10 text-slate-500">{status}</span>
    <code className="font-mono text-indigo-700 w-44">{code}</code>
    <span className="text-slate-600">{msg}</span>
  </div>
);

export default ApiDocsPage;

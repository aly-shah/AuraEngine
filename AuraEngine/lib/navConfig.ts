import React from 'react';
import {
  Compass, Users, Send, GitBranch, BarChart3, Brain,
  Sparkles, PenSquare, MessageSquare, Plug, Mail,
  SlidersHorizontal, CreditCard, FileText, Settings, BookOpen,
  HelpCircle, Zap, Target,
} from 'lucide-react';

// ── Types ──
//
// Navigation is grouped into 4 product pillars (ACQUIRE / ENGAGE / CONVERT /
// INTELLIGENCE) plus a workspace/billing/settings shelf. The pillar split is
// the product surface customers see; the shelf is plumbing.

export type NavSection =
  | 'mission'        // top-level: AI Mission Control
  | 'acquire'        // pillar 1: lead acquisition
  | 'engage'         // pillar 2: outreach
  | 'convert'        // pillar 3: pipeline + ops
  | 'intelligence'   // pillar 4: analytics + AI
  | 'workspace'      // settings shelf
  | 'billing'
  | 'settings';

export interface NavConfigItem {
  /** Route path (relative to /portal) */
  route: string;
  /** Label shown in sidebar nav */
  navLabel: string;
  /** Canonical page title rendered by PageHeader */
  pageTitle: string;
  /** Lucide icon component */
  icon: React.FC<{ size?: number }>;
  /** Navigation section grouping */
  section: NavSection;
  /** Display order within section */
  order: number;
  /** Nested child routes */
  children?: NavConfigItem[];
  /** Visual divider above this item */
  divider?: boolean;
  /** Non-clickable section header (children always visible) */
  isGroup?: boolean;
  /** Badge text (e.g. "2 active") — set dynamically at render time */
  badge?: string;
  /** Whether this item is visible in simplified mode (default true) */
  simplifiedVisible?: boolean;
}

/**
 * Pillar metadata — shown as section headers in the sidebar and used by
 * Mission Control to render pillar-scoped action cards.
 */
export const PILLARS = {
  acquire: {
    key: 'acquire' as const,
    label: 'Acquire',
    description: 'Find, enrich, and qualify the right leads.',
    icon: Compass,
  },
  engage: {
    key: 'engage' as const,
    label: 'Engage',
    description: 'Reach prospects with email, social, and AI messaging.',
    icon: Send,
  },
  convert: {
    key: 'convert' as const,
    label: 'Convert',
    description: 'Move pipeline to revenue with tasks, proposals, invoicing.',
    icon: Target,
  },
  intelligence: {
    key: 'intelligence' as const,
    label: 'Intelligence',
    description: 'Analytics, forecasts, and the AI Command Center.',
    icon: Brain,
  },
} as const;

// ── Config ──

export const NAV_CONFIG: NavConfigItem[] = [
  // ── Mission Control ──
  {
    route: '/portal',
    navLabel: 'Mission Control',
    pageTitle: 'Mission Control',
    icon: Sparkles,
    section: 'mission',
    order: 0,
  },

  // ── Pillar 1 — ACQUIRE ──
  {
    route: '/portal/leads',
    navLabel: 'Leads',
    pageTitle: 'Leads',
    icon: Users,
    section: 'acquire',
    order: 0,
    divider: true,
    children: [
      {
        route: '/portal/leads/apollo',
        navLabel: 'Find Prospects',
        pageTitle: 'Find Prospects',
        icon: Compass,
        section: 'acquire',
        order: 0,
      },
      {
        route: '/portal/intelligence',
        navLabel: 'Lead Insights',
        pageTitle: 'Lead Insights',
        icon: Brain,
        section: 'acquire',
        order: 1,
      },
    ],
  },

  // ── Pillar 2 — ENGAGE ──
  {
    route: '/portal/content',
    navLabel: 'Campaigns',
    pageTitle: 'Campaigns',
    icon: Sparkles,
    section: 'engage',
    order: 0,
    divider: true,
    children: [
      {
        route: '/portal/content-studio',
        navLabel: 'Content Studio',
        pageTitle: 'Content Studio',
        icon: PenSquare,
        section: 'engage',
        order: 0,
      },
      {
        route: '/portal/automation',
        navLabel: 'Automations',
        pageTitle: 'Automations',
        icon: GitBranch,
        section: 'engage',
        order: 1,
      },
    ],
  },
  {
    route: '/portal/social-scheduler',
    navLabel: 'Social',
    pageTitle: 'Social',
    icon: Send,
    section: 'engage',
    order: 1,
    children: [
      {
        route: '/portal/blog',
        navLabel: 'Blog Posts',
        pageTitle: 'Blog Posts',
        icon: PenSquare,
        section: 'engage',
        order: 0,
      },
    ],
  },

  // ── Pillar 3 — CONVERT ──
  {
    route: '/portal/team-hub',
    navLabel: 'Pipeline',
    pageTitle: 'Pipeline',
    icon: Zap,
    section: 'convert',
    order: 0,
    divider: true,
  },
  {
    route: '/portal/invoices',
    navLabel: 'Invoices',
    pageTitle: 'Invoices',
    icon: FileText,
    section: 'convert',
    order: 1,
  },

  // ── Pillar 4 — INTELLIGENCE ──
  {
    route: '/portal/analytics',
    navLabel: 'Reports',
    pageTitle: 'Reports',
    icon: BarChart3,
    section: 'intelligence',
    order: 0,
    divider: true,
  },
  {
    route: '/portal/ai',
    navLabel: 'AI Command Center',
    pageTitle: 'AI Command Center',
    icon: MessageSquare,
    section: 'intelligence',
    order: 1,
  },

  // ── Workspace shelf ──
  {
    route: '',
    navLabel: 'Workspace',
    pageTitle: '',
    icon: Plug,
    section: 'workspace',
    order: 0,
    isGroup: true,
    divider: true,
    children: [
      {
        route: '/portal/integrations',
        navLabel: 'Integrations',
        pageTitle: 'Integrations',
        icon: Plug,
        section: 'workspace',
        order: 0,
      },
      {
        route: '/portal/sender-accounts',
        navLabel: 'Sender Accounts',
        pageTitle: 'Sender Accounts',
        icon: Mail,
        section: 'workspace',
        order: 1,
      },
      {
        route: '/portal/model-training',
        navLabel: 'AI Settings',
        pageTitle: 'AI Settings',
        icon: SlidersHorizontal,
        section: 'workspace',
        order: 2,
        simplifiedVisible: false,
      },
    ],
  },

  // ── Billing shelf ──
  {
    route: '',
    navLabel: 'Billing',
    pageTitle: '',
    icon: CreditCard,
    section: 'billing',
    order: 0,
    isGroup: true,
    children: [
      {
        route: '/portal/billing',
        navLabel: 'Subscription',
        pageTitle: 'Subscription',
        icon: CreditCard,
        section: 'billing',
        order: 0,
      },
      {
        route: '/portal/invoices',
        navLabel: 'Invoices',
        pageTitle: 'Invoices',
        icon: FileText,
        section: 'billing',
        order: 1,
      },
    ],
  },

  // ── Settings shelf ──
  {
    route: '/portal/settings',
    navLabel: 'Settings',
    pageTitle: 'Settings',
    icon: Settings,
    section: 'settings',
    order: 0,
    children: [
      {
        route: '/portal/manual',
        navLabel: 'User Manual',
        pageTitle: 'User Manual',
        icon: BookOpen,
        section: 'settings',
        order: 0,
      },
      {
        route: '/portal/help',
        navLabel: 'Help Center',
        pageTitle: 'Help Center',
        icon: HelpCircle,
        section: 'settings',
        order: 1,
      },
    ],
  },
];

// ── Helpers ──

const _routeMap = new Map<string, NavConfigItem>();
function populateMap(items: NavConfigItem[]) {
  for (const item of items) {
    if (item.route) _routeMap.set(item.route, item);
    if (item.children) populateMap(item.children);
  }
}
populateMap(NAV_CONFIG);

export function getNavItem(route: string): NavConfigItem | undefined {
  return _routeMap.get(route);
}

export function getPageTitle(route: string): string | undefined {
  return _routeMap.get(route)?.pageTitle;
}

export function getParentNavItem(route: string): NavConfigItem | undefined {
  for (const item of NAV_CONFIG) {
    if (item.children?.some(c => c.route === route)) return item;
  }
  return undefined;
}

export function getBreadcrumbs(route: string): { label: string; path: string }[] {
  const crumbs: { label: string; path: string }[] = [];
  const parent = getParentNavItem(route);
  if (parent && parent.route) {
    crumbs.push({ label: parent.navLabel, path: parent.route });
  }
  const current = getNavItem(route);
  if (current) {
    crumbs.push({ label: current.pageTitle, path: current.route });
  }
  return crumbs;
}

/** Items belonging to a single pillar, sorted by order. Used by sidebar + Mission Control. */
export function getPillarItems(pillar: NavSection): NavConfigItem[] {
  return NAV_CONFIG
    .filter(i => i.section === pillar)
    .sort((a, b) => a.order - b.order);
}

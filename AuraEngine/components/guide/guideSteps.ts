export interface GuideStep {
  id: string;
  target: string;
  title: string;
  description: string;
  route?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface GuideTour {
  id: string;
  label: string;
  steps: GuideStep[];
}

export const guideTours: GuideTour[] = [
  {
    id: 'dashboard',
    label: 'Dashboard Tour',
    steps: [
      {
        id: 'dashboard-hero',
        target: '[data-guide="dashboard-hero"]',
        title: 'Welcome to Scaliyo',
        description: 'Your command center with key metrics, pipeline insights, and quick access to all tools.',
        route: '/portal',
      },
      {
        id: 'dashboard-actions',
        target: '[data-guide="dashboard-actions"]',
        title: 'Quick Insight Panels',
        description: 'Access Pipeline Health, Lead Velocity, Goal Tracking, and more at a glance.',
        route: '/portal',
      },
      {
        id: 'dashboard-quick-actions',
        target: '[data-guide="dashboard-quick-actions"]',
        title: 'Quick Actions',
        description: 'Import CSV files, generate AI content, and add new leads directly from the dashboard.',
        route: '/portal',
      },
      {
        id: 'dashboard-stats',
        target: '[data-guide="dashboard-stats"]',
        title: 'Email & Lead Performance',
        description: 'Track open rates, conversions, lead scores, and performance trends in real time.',
        route: '/portal',
      },
      {
        id: 'dashboard-followup',
        target: '[data-guide="dashboard-followup"]',
        title: 'Follow-up Alerts',
        description: 'Never miss a hot lead — get notified when leads engage with your emails multiple times.',
        route: '/portal',
      },
      {
        id: 'dashboard-segments',
        target: '[data-guide="dashboard-segments"]',
        title: 'Lead Segmentation',
        description: 'AI-powered lead grouping helps you target the right audience with the right message.',
        route: '/portal',
      },
    ],
  },
  {
    id: 'leads',
    label: 'Lead Management Tour',
    steps: [
      {
        id: 'leads-filters',
        target: '[data-guide="leads-filters"]',
        title: 'Filter Your Leads',
        description: 'Filter by score, status, tags, and email engagement to find exactly who you need.',
        route: '/portal/leads',
      },
      {
        id: 'leads-bulk-actions',
        target: '[data-guide="leads-bulk-actions"]',
        title: 'Bulk Operations',
        description: 'Select multiple leads for campaigns, tagging, export, or batch actions.',
        route: '/portal/leads',
      },
      {
        id: 'leads-table',
        target: '[data-guide="leads-table"]',
        title: 'Lead Pipeline',
        description: 'View and manage all your leads. Click any row to open the full lead profile.',
        route: '/portal/leads',
      },
      {
        id: 'leads-add',
        target: '[data-guide="leads-add"]',
        title: 'Add New Leads',
        description: 'Add leads manually or import from CSV.',
        route: '/portal/leads',
      },
      {
        id: 'leads-email-filter',
        target: '[data-guide="leads-email-filter"]',
        title: 'Email Engagement Filter',
        description: 'Filter leads by email status — sent, opened, clicked — to prioritize follow-ups.',
        route: '/portal/leads',
      },
    ],
  },
  {
    id: 'content-studio',
    label: 'Content Studio Tour',
    steps: [
      {
        id: 'content-editor',
        target: '[data-guide="content-editor"]',
        title: 'Email Editor',
        description: 'Write and personalize email content with AI assistance and rich formatting.',
        route: '/portal/content-studio',
      },
      {
        id: 'content-image-gen',
        target: '[data-guide="content-image-gen"]',
        title: 'Image Generator',
        description: 'Create AI-powered images for your emails and campaigns.',
        route: '/portal/content-studio',
      },
      {
        id: 'content-cta',
        target: '[data-guide="content-cta"]',
        title: 'CTA Button Builder',
        description: 'Create trackable call-to-action buttons to drive clicks and conversions.',
        route: '/portal/content-studio',
      },
      {
        id: 'content-preview',
        target: '[data-guide="content-preview"]',
        title: 'Preview & Send',
        description: 'Preview your email as recipients will see it, then send to your campaigns.',
        route: '/portal/content-studio',
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation Tour',
    steps: [
      {
        id: 'automation-canvas',
        target: '[data-guide="automation-canvas"]',
        title: 'Visual Workflow Builder',
        description: 'Drag-and-drop workflow nodes to build powerful automation sequences.',
        route: '/portal/automation',
      },
      {
        id: 'automation-palette',
        target: '[data-guide="automation-palette"]',
        title: 'Add Steps',
        description: 'Choose from triggers, actions, conditions, and delays to build your workflow.',
        route: '/portal/automation',
      },
      {
        id: 'automation-config',
        target: '[data-guide="automation-config"]',
        title: 'Configure Nodes',
        description: 'Click any node to edit its settings, conditions, and behavior.',
        route: '/portal/automation',
      },
      {
        id: 'automation-analytics',
        target: '[data-guide="automation-analytics"]',
        title: 'Workflow Analytics',
        description: 'Track workflow performance, execution counts, and ROI metrics.',
        route: '/portal/automation',
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics Tour',
    steps: [
      {
        id: 'analytics-reports',
        target: '[data-guide="analytics-reports"]',
        title: 'Report Types',
        description: 'Choose from Performance, Lead Source, ROI, AI, Email, and Team reports.',
        route: '/portal/analytics',
      },
      {
        id: 'analytics-charts',
        target: '[data-guide="analytics-charts"]',
        title: 'Interactive Charts',
        description: 'Drill into any metric — hover for details, click to filter, zoom to explore.',
        route: '/portal/analytics',
      },
      {
        id: 'analytics-export',
        target: '[data-guide="analytics-export"]',
        title: 'Export Reports',
        description: 'Download reports in PDF, Excel, CSV, or PowerPoint format.',
        route: '/portal/analytics',
      },
    ],
  },
];

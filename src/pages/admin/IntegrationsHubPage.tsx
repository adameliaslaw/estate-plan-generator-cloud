/**
 * src/pages/admin/IntegrationsHubPage.tsx
 *
 * Unified status view across every integration your firm has wired up
 * — practice tools, payments, email, calendar, AI providers — plus
 * placeholders for connectors still on the roadmap.
 *
 * Addresses grievance #3: solo lawyers on 5 tools that don't talk.
 * This is the productized-consulting surface ("you already have the
 * right tools — you need them connected").
 */

import { Link } from 'react-router-dom';
import {
  Cable,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Mail,
  Calendar,
  FolderOpen,
  CreditCard,
  Sparkles,
  Map,
  UserPlus,
  Briefcase,
  PenTool,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useDocument } from '@/hooks/useFirestore';
import { ROUTES, COLLECTIONS } from '@/config/constants';
import type { Firm } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionStatus = 'connected' | 'not_configured' | 'coming_soon';

interface Integration {
  id: string;
  name: string;
  category: 'practice' | 'communication' | 'docs_calendar' | 'payments' | 'ai';
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: ConnectionStatus;
  /** Internal route to the existing setup screen for this integration */
  configRoute?: string;
  /** External link if no internal flow exists yet */
  externalLink?: string;
}

const CATEGORY_LABEL: Record<Integration['category'], string> = {
  practice: 'Practice Management',
  communication: 'Communication',
  docs_calendar: 'Documents & Calendar',
  payments: 'Payments',
  ai: 'AI Providers',
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function buildIntegrations(firm: Firm | null): Integration[] {
  const settings = firm?.settings;
  const has = (v: string | undefined | null): boolean => !!(v && v.length > 0);

  return [
    // Practice management
    {
      id: 'clio',
      name: 'Clio',
      category: 'practice',
      description: 'Sync matters, contacts, and time entries from Clio Manage.',
      icon: Briefcase,
      status: 'coming_soon',
    },
    {
      id: 'mycase',
      name: 'MyCase',
      category: 'practice',
      description: 'Bi-directional sync with MyCase matters and documents.',
      icon: Briefcase,
      status: 'coming_soon',
    },
    {
      id: 'levitate',
      name: 'Levitate',
      category: 'practice',
      description: 'Push new clients to Levitate CRM with referral metadata.',
      icon: UserPlus,
      status: has(settings?.levitateApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },

    // Communication
    {
      id: 'sendgrid',
      name: 'SendGrid',
      category: 'communication',
      description: 'Branded transactional email — questionnaire invites, follow-ups, receipts.',
      icon: Mail,
      status: has(settings?.sendGridApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
    {
      id: 'calendly',
      name: 'Calendly',
      category: 'communication',
      description: 'Auto-create matters when a prospect books a consultation.',
      icon: Calendar,
      status: 'coming_soon',
    },

    // Docs & Calendar
    {
      id: 'google_calendar',
      name: 'Google Calendar',
      category: 'docs_calendar',
      description: 'Two-way sync of signing ceremonies, deadlines, and appointments.',
      icon: Calendar,
      status: 'not_configured',
      configRoute: ROUTES.SETTINGS,
    },
    {
      id: 'google_drive',
      name: 'Google Drive',
      category: 'docs_calendar',
      description: 'Mirror generated documents to a firm Drive folder.',
      icon: FolderOpen,
      status: 'not_configured',
      configRoute: ROUTES.SETTINGS,
    },
    {
      id: 'esign',
      name: 'eSignature',
      category: 'docs_calendar',
      description: 'Send retainers and wills out for electronic signature.',
      icon: PenTool,
      status: 'connected',
    },

    // Payments
    {
      id: 'lawpay',
      name: 'LawPay',
      category: 'payments',
      description: 'Accept retainer payments and run direct charges.',
      icon: CreditCard,
      status: has(settings?.lawPayApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },

    // AI providers
    {
      id: 'openai',
      name: 'OpenAI',
      category: 'ai',
      description: 'GPT-5 for document drafting, structured extraction.',
      icon: Sparkles,
      status: has(settings?.openAiApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      category: 'ai',
      description: 'Claude for long-context reasoning and review.',
      icon: Sparkles,
      status: has(settings?.anthropicApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      category: 'ai',
      description: 'Vision + OCR for PDF intake and brief analysis.',
      icon: Sparkles,
      status: has(settings?.geminiApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      category: 'ai',
      description: 'Web-grounded research with citations.',
      icon: Sparkles,
      status: has(settings?.perplexityApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
    {
      id: 'google_maps',
      name: 'Google Maps',
      category: 'docs_calendar',
      description: 'Property lookups for real estate deed prep.',
      icon: Map,
      status: has(settings?.googleMapsApiKey) ? 'connected' : 'not_configured',
      configRoute: ROUTES.SETTINGS_FIRM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-2.5 w-2.5" /> Connected
      </span>
    );
  }
  if (status === 'coming_soon') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600 ring-1 ring-gray-200">
        <Clock className="h-2.5 w-2.5" /> Coming soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
      <Circle className="h-2.5 w-2.5" /> Not configured
    </span>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const Icon = integration.icon;
  const disabled = integration.status === 'coming_soon';

  const ActionEl = (() => {
    if (disabled) {
      return (
        <button
          disabled
          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold text-gray-400 cursor-not-allowed"
        >
          Coming soon
        </button>
      );
    }
    if (integration.configRoute) {
      return (
        <Link
          to={integration.configRoute}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors',
            integration.status === 'connected'
              ? 'border border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              : 'bg-[#1a365d] text-white hover:bg-[#2b6cb0]',
          )}
        >
          {integration.status === 'connected' ? 'Manage' : 'Connect'}
        </Link>
      );
    }
    if (integration.externalLink) {
      return (
        <a
          href={integration.externalLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:border-gray-300"
        >
          Open <ExternalLink className="h-2.5 w-2.5" />
        </a>
      );
    }
    return (
      <button
        disabled
        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold text-gray-400 cursor-not-allowed"
      >
        Built-in
      </button>
    );
  })();

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-colors',
        disabled
          ? 'border-gray-100 bg-gray-50/40 opacity-75'
          : 'border-gray-200 bg-white shadow-sm hover:border-gray-300',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              integration.status === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900">{integration.name}</h3>
              <StatusBadge status={integration.status} />
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500 leading-relaxed">{integration.description}</p>
          </div>
        </div>
        <div className="shrink-0">{ActionEl}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntegrationsHubPage() {
  const { userProfile } = useAuth();
  const { data: firm, loading } = useDocument<Firm>(
    userProfile?.firmId ? `${COLLECTIONS.FIRMS}/${userProfile.firmId}` : null,
  );

  const integrations = buildIntegrations(firm);
  const connectedCount = integrations.filter((i) => i.status === 'connected').length;
  const availableCount = integrations.filter((i) => i.status !== 'coming_soon').length;

  const byCategory = (cat: Integration['category']) =>
    integrations.filter((i) => i.category === cat);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
            <Cable className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Integrations</h1>
            <p className="text-[11px] text-gray-500">
              {loading
                ? 'Loading firm settings…'
                : `${connectedCount} of ${availableCount} connected · 3 on roadmap`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-6">
        {(['practice', 'communication', 'docs_calendar', 'payments', 'ai'] as const).map((cat) => {
          const items = byCategory(cat);
          if (items.length === 0) return null;
          return (
            <section key={cat} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  {CATEGORY_LABEL[cat]}
                </h2>
                <div className="h-px flex-1 bg-gray-100" />
                <span className="text-[10px] text-gray-400">
                  {items.filter((i) => i.status === 'connected').length} / {items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {items.map((i) => (
                  <IntegrationCard key={i.id} integration={i} />
                ))}
              </div>
            </section>
          );
        })}

        <p className="text-[10px] text-gray-400 text-center pt-2">
          Connection status reflects API keys stored in firm settings. OAuth-based integrations
          (Google) require completing the full auth flow in Settings.
        </p>
      </div>
    </div>
  );
}

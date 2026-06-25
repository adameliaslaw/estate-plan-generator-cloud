/**
 * DocumentEditorPage.tsx
 *
 * Page wrapper that loads a specific document and renders the TipTap editor.
 *
 * Route: /clients/:clientId/documents/:documentId/edit
 *
 * Responsibilities:
 *   - Extract clientId and documentId from URL params
 *   - Derive firmId from the authenticated user profile
 *   - Fetch client name for breadcrumb display
 *   - Render back button + breadcrumb
 *   - Render DocumentEditor full-height
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  ← Back  │  Dashboard > Clients > [Name] > [Doc]       │
 *   ├─────────────────────────────────────────────────────────┤
 *   │                                                         │
 *   │            DocumentEditor (full height)                 │
 *   │                                                         │
 *   └─────────────────────────────────────────────────────────┘
 */

import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  LayoutDashboard,
  Users,
  FileText,
  Edit3,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocument } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { type Client, type Document } from '@/types';
import { cn } from '@/lib/utils';
import DocumentEditor from '@/components/editor/DocumentEditor';

// ── Breadcrumb component ───────────────────────────────────────────────────────

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  current?: boolean;
}

function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((item, index) => {
        const Icon = item.icon;
        const isLast = index === items.length - 1;

        return (
          <div key={index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
            )}
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="flex items-center gap-1 text-gray-500 hover:text-[#2b6cb0] transition-colors"
              >
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate max-w-[120px]">{item.label}</span>
              </Link>
            ) : (
              <span
                className={cn(
                  'flex items-center gap-1 truncate max-w-[160px]',
                  isLast
                    ? 'font-semibold text-[#1a365d]'
                    : 'text-gray-500',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate">{item.label}</span>
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentEditorPage() {
  const { clientId, documentId } = useParams<{
    clientId: string;
    documentId: string;
  }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();

  const firmId = userProfile?.firmId ?? '';

  // Fetch client data for breadcrumb
  const clientPath =
    clientId && firmId ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}` : null;
  const { data: client, loading: clientLoading } =
    useDocument<Client>(clientPath);

  // Fetch document data for breadcrumb
  const documentPath =
    clientId && firmId && documentId
      ? `${COLLECTIONS.DOCUMENTS(firmId, clientId)}/${documentId}`
      : null;
  const { data: document, loading: documentLoading } =
    useDocument<Document>(documentPath);

  // ── Guard: missing params ──
  if (!clientId || !documentId || !firmId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Alert className="max-w-md border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-sm text-red-700">
            {!firmId
              ? 'Your account is not associated with a firm. Please contact your administrator.'
              : 'Invalid document URL. Please navigate from the client dashboard.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ── Breadcrumb data ──
  const clientDisplayName = client
    ? `${client.personalInfo?.firstName ?? ''} ${client.personalInfo?.lastName ?? ''}`.trim() || 'Client'
    : clientLoading
    ? '…'
    : 'Client';

  const documentDisplayName = document?.displayName ?? (documentLoading ? '…' : 'Document');

  const breadcrumbItems: BreadcrumbItem[] = [
    {
      label: 'Dashboard',
      href: ROUTES.DASHBOARD,
      icon: LayoutDashboard,
    },
    {
      label: 'Clients',
      href: ROUTES.CLIENTS,
      icon: Users,
    },
    {
      label: clientDisplayName,
      href: ROUTES.CLIENT_DETAIL(clientId),
      icon: undefined,
    },
    {
      label: 'Documents',
      href: `${ROUTES.CLIENT_DETAIL(clientId)}?tab=documents`,
      icon: FileText,
    },
    {
      label: documentDisplayName,
      icon: Edit3,
      current: true,
    },
  ];

  const handleBack = () => {
    // Navigate back to the client dashboard on the documents tab
    navigate(`${ROUTES.CLIENT_DETAIL(clientId)}?tab=documents`);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-sm text-gray-600 hover:text-[#2b6cb0] hover:bg-[#ebf4ff] flex-shrink-0 pl-2"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {/* Divider */}
          <div className="h-5 w-px bg-gray-200 flex-shrink-0" />

          {/* Breadcrumb */}
          <div className="flex-1 overflow-hidden">
            {clientLoading || documentLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : (
              <Breadcrumb items={breadcrumbItems} />
            )}
          </div>

          {/* Read-only indicator for client role */}
          {userProfile?.role === 'client' && (
            <div className="flex-shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
              View only
            </div>
          )}
        </div>

        {/* ── Editor (fills remaining height) ──────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          <DocumentEditor
            firmId={firmId}
            clientId={clientId}
            documentId={documentId}
            readOnly={userProfile?.role === 'client'}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

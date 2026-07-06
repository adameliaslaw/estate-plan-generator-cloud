/**
 * TemplatePreviewPanel.tsx
 *
 * Split-pane live preview for the template authoring dialog. Renders the
 * current template content against a real firm client's data using the same
 * Handlebars helpers the server uses at generation time.
 *
 * Usage: rendered alongside (or below) the template content textarea when
 * the author toggles "Show preview" on. Debounces renders so fast typing
 * doesn't thrash the browser.
 */

import { useEffect, useMemo, useState } from 'react';
import { orderBy, limit } from 'firebase/firestore';
import { sanitizeHtml } from '@/lib/sanitize';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import type { Client } from '@/types';
import { renderTemplatePreview } from '@/utils/template-preview';
import { Combobox } from '@/components/ui/combobox';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientDisplayName(c: Client): string {
  const { lastName, firstName } = c.personalInfo ?? {};
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName ?? 'Unknown';
  return `${lastName}, ${firstName}`;
}

/** Default client to auto-select if present: Karen Elias. */
function pickDefaultClient(clients: Client[]): Client | null {
  const karen = clients.find(
    (c) =>
      c.personalInfo?.firstName?.toLowerCase() === 'karen' &&
      c.personalInfo?.lastName?.toLowerCase() === 'elias',
  );
  if (karen) return karen;
  // Fall back to the most recently-updated non-archived client
  const active = clients.filter((c) => !c.isArchived);
  return active[0] ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  firmId: string;
  template: string;
  className?: string;
}

export default function TemplatePreviewPanel({ firmId, template, className }: Props) {
  const { data: clients, loading: clientsLoading } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    useMemo(() => [orderBy('updatedAt', 'desc'), limit(100)], []),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [debouncedTemplate, setDebouncedTemplate] = useState(template);

  // Debounce template edits so every keystroke doesn't re-compile
  useEffect(() => {
    const h = setTimeout(() => setDebouncedTemplate(template), 250);
    return () => clearTimeout(h);
  }, [template]);

  // Auto-select Karen Elias (or latest client) once the list loads
  useEffect(() => {
    if (selectedId != null || clients.length === 0) return;
    const def = pickDefaultClient(clients);
    if (def) setSelectedId(def.id);
  }, [clients, selectedId]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? null,
    [clients, selectedId],
  );

  const { html, error } = useMemo(
    () => renderTemplatePreview(debouncedTemplate, selectedClient),
    [debouncedTemplate, selectedClient],
  );

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Live Preview
        </span>
        <div className="flex items-center gap-2">
          {clientsLoading ? (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading clients…
            </div>
          ) : (
            <div className="w-48">
              <Combobox
                className="h-8 text-xs"
                placeholder="— Pick a client —"
                emptyText="No matching client."
                value={selectedId ?? ''}
                onChange={(v) => setSelectedId(v || null)}
                options={clients
                  .filter((c) => !c.isArchived)
                  .map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
              />
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-white">
        {error ? (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="font-mono">{error}</span>
          </div>
        ) : null}

        {!selectedClient && !clientsLoading ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-gray-400">
            Pick a client above to see the template rendered with their data.
          </div>
        ) : (
          <div
            className="prose prose-sm max-w-none p-4 text-sm"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-[10px] italic text-gray-400">
        Preview renders with the same Handlebars helpers as production. Updates after you stop typing for 250ms.
      </div>
    </div>
  );
}

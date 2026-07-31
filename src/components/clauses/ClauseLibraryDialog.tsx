/**
 * ClauseLibraryDialog — the attorney-only Clause Picker (HOMEWORK feature
 * decision, 2026-07-30): a searchable/filterable modal over
 * firms/{firmId}/clauseCatalog with All / My Clauses / Mined folders,
 * state + category filters, a preview pane, and "Use Clause" insert with
 * client-context placeholder resolution. Also hosts the manual
 * "Save to My Clauses" form (writes via the addMyClause callable — the
 * catalog is closed to client SDK writes).
 *
 * Mined entries are only offered once approved: the design's promise is
 * that nothing reaches drafting before Adam's click (status: 'approved').
 */

import { useMemo, useState } from 'react';
import { BookMarked, Loader2, Plus, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import {
  addMyClause,
  resolveClausePlaceholders,
  type ClauseCatalogEntry,
} from '@/services/clause-library-service';
import { cn } from '@/lib/utils';

type Folder = 'all' | 'my' | 'mined';

export interface ClauseLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firmId: string;
  /** Known values for {{PLACEHOLDER}} tokens; unknown tokens stay visible. */
  placeholderValues?: Record<string, string | undefined>;
  /** Receives the resolved clause text on "Use Clause". */
  onInsert: (text: string) => void;
}

export default function ClauseLibraryDialog({
  open,
  onOpenChange,
  firmId,
  placeholderValues = {},
  onInsert,
}: ClauseLibraryDialogProps) {
  const { userProfile } = useAuth();
  const [folder, setFolder] = useState<Folder>('all');
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', text: '', category: '', state: '' });

  const { data: entries, loading } = useCollection<ClauseCatalogEntry>(
    open ? `firms/${firmId}/clauseCatalog` : '',
  );

  const usable = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.origin === 'manual' ||
          (e.status === 'approved' && e.piiScanStatus !== 'blocked'),
      ),
    [entries],
  );

  const categories = useMemo(
    () => [...new Set(usable.map((e) => e.category).filter((c): c is string => !!c))].sort(),
    [usable],
  );
  const states = useMemo(
    () => [...new Set(usable.map((e) => e.state).filter((s): s is string => !!s))].sort(),
    [usable],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return usable.filter((e) => {
      if (folder === 'my' && !(e.origin === 'manual' && e.createdBy === userProfile?.uid)) {
        return false;
      }
      if (folder === 'mined' && e.origin === 'manual') return false;
      if (stateFilter && e.state !== stateFilter) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (
        q &&
        !`${e.title} ${e.functionSummary ?? ''} ${e.canonicalText}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [usable, folder, search, stateFilter, categoryFilter, userProfile?.uid]);

  const selected = visible.find((e) => e.id === selectedId) ?? visible[0] ?? null;
  const preview = selected
    ? resolveClausePlaceholders(selected.canonicalText, placeholderValues)
    : '';

  async function handleSave() {
    if (!draft.title.trim() || !draft.text.trim()) {
      setSaveError('Title and clause text are required.');
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      await addMyClause({
        firmId,
        title: draft.title.trim(),
        text: draft.text,
        category: draft.category.trim() || undefined,
        state: draft.state.trim() || undefined,
      });
      setDraft({ title: '', text: '', category: '', state: '' });
      setAdding(false);
      setFolder('my');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save clause.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-[#1a365d]" />
            Clause Library
          </DialogTitle>
          <DialogDescription>
            Search the firm's clause catalog and insert language into this field.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={folder} onValueChange={(v) => setFolder(v as Folder)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="my">My Clauses</TabsTrigger>
              <TabsTrigger value="mined">Mined</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search clauses…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <select
            aria-label="Filter by state"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setAdding((p) => !p)}>
            <Plus className="mr-1 h-4 w-4" />
            My Clause
          </Button>
        </div>

        {adding && (
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex gap-2">
              <Input
                placeholder="Title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <Input
                placeholder="Category (optional)"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="max-w-44"
              />
              <Input
                placeholder="State (e.g. NJ)"
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value.toUpperCase() })}
                className="max-w-28"
              />
            </div>
            <Textarea
              placeholder="Clause text — use {{PLACEHOLDER}} tokens for values that vary per client"
              rows={4}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <Button size="sm" onClick={handleSave} disabled={saveBusy}>
              {saveBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save to My Clauses
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-3">
          <ScrollArea className="w-72 shrink-0 rounded-lg border border-gray-200">
            {loading ? (
              <div className="flex items-center justify-center p-6 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No clauses match.</p>
            ) : (
              <ul aria-label="Clause results">
                {visible.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className={cn(
                        'w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50',
                        selected?.id === e.id && 'bg-[#ebf4ff]',
                      )}
                    >
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {e.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {e.origin === 'manual' ? (
                          <Badge variant="outline">My clause</Badge>
                        ) : (
                          <Badge variant="outline">Mined</Badge>
                        )}
                        {e.category && <Badge variant="secondary">{e.category}</Badge>}
                        {e.state && <Badge variant="secondary">{e.state}</Badge>}
                        {e.counts?.matters !== undefined && (
                          <span className="text-xs text-gray-400">
                            used in {e.counts.matters} matters
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>

          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200">
            {selected ? (
              <>
                <div className="border-b border-gray-100 px-4 py-2">
                  <h3 className="text-sm font-semibold text-gray-900">{selected.title}</h3>
                  {selected.functionSummary && (
                    <p className="text-xs text-gray-500">{selected.functionSummary}</p>
                  )}
                </div>
                <ScrollArea className="flex-1 px-4 py-3">
                  <pre className="whitespace-pre-wrap font-serif text-sm text-gray-800">
                    {preview}
                  </pre>
                </ScrollArea>
                <div className="border-t border-gray-100 px-4 py-2 text-right">
                  <Button
                    onClick={() => {
                      onInsert(preview);
                      onOpenChange(false);
                    }}
                  >
                    Use Clause
                  </Button>
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-gray-500">Select a clause to preview it.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * DocumentEditor.tsx
 *
 * Main TipTap-based legal document editor component.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Top bar (title, status badge, saved indicator, counts)     │
 *   │  EditorToolbar (3 rows)                                     │
 *   ├────────────────────────────────────────┬────────────────────┤
 *   │                                        │                    │
 *   │   TipTap editor (legal page style)     │  CommentsPanel     │
 *   │   - White paper with shadow            │  (collapsible)     │
 *   │   - 1-inch margins                     │                    │
 *   │   - Times New Roman 12pt               │                    │
 *   │   - DRAFT/REVIEW watermark             │                    │
 *   │                                        │                    │
 *   ├────────────────────────────────────────┴────────────────────┤
 *   │  EditorStatusBar (counts, save status, version)            │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Features:
 *   - TipTap with full extension suite (StarterKit + all listed extensions)
 *   - Auto-save: debounced 2s write to Firestore on every change
 *   - Periodic versioning: every 15 auto-saves, create a new version snapshot
 *   - Status-based read-only: 'final' docs locked (attorney can unlock)
 *   - DRAFT / REVIEW watermarks via CSS class
 *   - Find & Replace floating panel
 *   - Version history slide-over
 *   - Comments panel
 *   - Keyboard shortcut: Ctrl+H → find & replace
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';

// TipTap extensions
import StarterKit from '@tiptap/starter-kit';

import TextAlign from '@tiptap/extension-text-align';
import Heading from '@tiptap/extension-heading';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';

// UI
import {
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  PenSquare,
  Save,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize';

// Project
import { useDocument, updateDoc, createDoc } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS } from '@/config/constants';
import { type Document, type DocStatus } from '@/types';
import { serverTimestamp } from 'firebase/firestore';
import { logSystemActivity } from '@/utils/activity-logger';
import { usePermissions } from '@/hooks/usePermissions';
import { documentService } from '@/services/document-service';

// Editor subcomponents
import EditorToolbar from './EditorToolbar';
import EditorStatusBar, { type SaveStatus } from './EditorStatusBar';
import CommentsPanel from './CommentsPanel';
import VersionHistory from './VersionHistory';
import FindReplaceDialog from './FindReplaceDialog';
import TemplateComparePanel from './TemplateComparePanel';
import DocumentStatusBadge from '@/components/documents/DocumentStatusBadge';

// Styles
import './editor-styles.css';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DocumentEditorProps {
  firmId: string;
  clientId: string;
  documentId: string;
  readOnly?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTO_SAVE_DEBOUNCE_MS = 2000;
const VERSION_EVERY_N_SAVES = 15;

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentEditor({
  firmId,
  clientId,
  documentId,
  readOnly: readOnlyProp = false,
}: DocumentEditorProps) {
  const { userProfile } = useAuth();
  const { canManageDocuments, isAttorney, isAdmin, isParalegal } = usePermissions();

  // ── Firestore path helpers ──
  const docPath = `${COLLECTIONS.DOCUMENTS(firmId, clientId)}/${documentId}`;
  const versionsPath = `${docPath}/versions`;

  // ── Load document data ──
  const { data: document, loading: docLoading, error: docError } = useDocument<Document>(docPath);

  // ── Local state ──
  const [localTitle, setLocalTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showComparePanel, setShowComparePanel] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [docUnlocked, setDocUnlocked] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Refs for debounced auto-save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveCountRef = useRef(0);
  // Highest version number produced this session, seeded from and kept >= the
  // document's persisted currentVersion. saveVersion reads+increments this
  // synchronously so rapid successive snapshots don't both read a stale
  // document.currentVersion (which lags until the Firestore subscription
  // re-delivers) and collide on versionNumber (CY).
  const currentVersionRef = useRef(0);
  // useEditor's onUpdate closure is created once on mount, before userProfile /
  // document have loaded. Route auto-save through a ref so edits always use the
  // latest closure (correct updatedBy + current document) instead of a stale one
  // that writes updatedBy:'unknown' and snapshots a stale document.
  const scheduleAutoSaveRef = useRef<(html: string) => void>(() => {});
  // Set true after a regenerate so the next document delivery reloads the new
  // content into the editor even though contentLoaded is already true.
  const forceReloadRef = useRef(false);
  // True for the duration of a regenerate op. While true, the load effect
  // reloads incoming snapshots but does NOT clear forceReloadRef, so the
  // regenerated-content snapshot is honored even if it arrives before the
  // generateSingleDocument callable resolves (R5-022).
  const regeneratingRef = useRef(false);

  // ── Derived state ──
  const isReadOnly =
    readOnlyProp ||
    (document?.status === 'final' && !docUnlocked) ||
    !canManageDocuments ||
    // Lock the editor while a regenerate is in flight so a keystroke can't
    // schedule an autosave that overwrites the incoming regenerated draft (CV).
    regenerating;

  // ── TipTap editor ──
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // We use the separate Heading extension
      }),
      Heading.configure({
        levels: [1, 2, 3, 4],
      }),

      TextAlign.configure({
        types: ['heading', 'paragraph'],
        defaultAlignment: 'left',
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight.configure({
        multicolor: true,
      }),
      Placeholder.configure({
        placeholder:
          'Begin drafting your legal document here. Use the toolbar above to format text, insert legal blocks, and manage document status.',
      }),
      CharacterCount.configure({
        limit: 200000, // ~200k characters max for a legal doc
      }),
      TextStyle,
      FontFamily.configure({
        types: ['textStyle'],
      }),
      Color.configure({
        types: ['textStyle'],
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Superscript,
      Subscript,
    ],
    content: '',
    editable: !isReadOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
      scheduleAutoSaveRef.current(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'legal-editor-content',
        spellcheck: 'true',
      },
      handleKeyDown: (_view, event) => {
        // Ctrl+H or Cmd+H → find & replace
        if ((event.ctrlKey || event.metaKey) && event.key === 'h') {
          event.preventDefault();
          setShowFindReplace((prev) => !prev);
          return true;
        }
        return false;
      },
    },
  });

  // ── Update editor editable state when readOnly changes ──
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isReadOnly);
    }
  }, [editor, isReadOnly]);

  // ── Load document content on mount / doc change ──
  useEffect(() => {
    if (!document || (contentLoaded && !forceReloadRef.current)) return;
    setLocalTitle(document.displayName ?? '');

    const docWithContent = document as Document & { editorContent?: string; content?: string };
    const rawEditorContent = docWithContent.editorContent ?? '';
    const rawContent = docWithContent.content ?? '';

    // Strip HTML tags before checking for real text content.
    // An auto-saved empty TipTap node like "<p></p>" (truthy, 33 chars) must
    // not win over the real AI-generated content in the `content` field.
    const hasRealText = (html: string) => !!html.replace(/<[^>]*>/g, '').trim();
    let htmlContent = '';
    if (hasRealText(rawEditorContent)) {
      htmlContent = rawEditorContent;
    } else if (hasRealText(rawContent)) {
      htmlContent = rawContent;
    }

    if (htmlContent && editor) {
      editor.commands.setContent(sanitizeHtml(htmlContent), { emitUpdate: false });
      setContentLoaded(true);
      // Keep forcing reloads until the regenerate op finishes (see regeneratingRef),
      // otherwise the pre-regen editorContent snapshot clears the flag and the
      // real regenerated snapshot that arrives next is skipped.
      if (!regeneratingRef.current) forceReloadRef.current = false;
      setHasUnsavedChanges(false);
      setSaveStatus('saved');
      setLastSavedAt(
        document.updatedAt
          ? new Date((document.updatedAt as unknown as { seconds: number }).seconds * 1000)
          : new Date(),
      );
    } else if (!htmlContent) {
      setContentLoaded(true);
    }
    // If htmlContent exists but editor is not ready yet, the effect will
    // re-run when editor initializes (editor is in the dependency array).
  }, [document, editor, contentLoaded]);

  // Keep the version counter at least as high as the persisted currentVersion so
  // externally-driven bumps (e.g. a server-side regenerate) are picked up and a
  // local snapshot never reuses a number.
  useEffect(() => {
    const persisted = document?.currentVersion ?? 0;
    if (persisted > currentVersionRef.current) currentVersionRef.current = persisted;
  }, [document]);

  // ── Save a version snapshot ──
  const saveVersion = useCallback(
    async (html: string, changeNotes?: string) => {
      // Read + bump synchronously (before any await) so a concurrent saveVersion
      // sees the incremented value and can't reuse this number (CY).
      const newVersionNum = currentVersionRef.current + 1;
      currentVersionRef.current = newVersionNum;
      try {
        await createDoc(versionsPath, {
          content: html,
          versionNumber: newVersionNum,
          createdAt: serverTimestamp(),
          createdBy: userProfile?.uid ?? 'unknown',
          createdByName:
            userProfile?.displayName ?? userProfile?.email ?? 'Unknown',
          changeNotes: changeNotes ?? '',
          status: document?.status ?? 'draft',
          wordCount: html
            .replace(/<[^>]+>/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean).length,
        });
        // Update current version number on the document
        await updateDoc(docPath, {
          currentVersion: newVersionNum,
          updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        });

        // Log the activity
        await logSystemActivity(firmId, userProfile, 'editing document', {
          clientId,
          documentName: document?.displayName ?? 'Document'
        });
      } catch (err) {
        console.error('[DocumentEditor] Save version error:', err);
        throw err;
      }
    },
    [document, versionsPath, docPath, userProfile, firmId, clientId],
  );

  // ── Auto-save (debounced) ──
  const scheduleAutoSave = useCallback(
    (html: string) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(async () => {
        setSaveStatus('saving');
        try {
          await updateDoc<Document & { editorContent: string }>(docPath, {
            editorContent: html,
            updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
          });

          // Periodic versioning
          autoSaveCountRef.current += 1;

          if (autoSaveCountRef.current % VERSION_EVERY_N_SAVES === 0) {
            await saveVersion(html, 'Auto-saved checkpoint');
          }

          setSaveStatus('saved');
          setLastSavedAt(new Date());
          setHasUnsavedChanges(false);
        } catch (err) {
          console.error('[DocumentEditor] Auto-save error:', err);
          setSaveStatus('error');
        }
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [docPath, userProfile, saveVersion],
  );

  // Keep the onUpdate-facing ref pointed at the latest scheduleAutoSave so the
  // editor's one-time onUpdate closure never auto-saves with a stale userProfile.
  useEffect(() => {
    scheduleAutoSaveRef.current = scheduleAutoSave;
  }, [scheduleAutoSave]);

  // ── Manual save version (called from VersionHistory) ──
  const handleSaveVersion = useCallback(
    async (changeNotes: string) => {
      if (!editor) return;
      const html = editor.getHTML();
      // First ensure current content is saved
      setSaveStatus('saving');
      try {
        await updateDoc<Document & { editorContent: string }>(docPath, {
          editorContent: html,
          updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        });
        await saveVersion(html, changeNotes);
        setSaveStatus('saved');
        setLastSavedAt(new Date());
        setHasUnsavedChanges(false);
      } catch (err) {
        setSaveStatus('error');
        throw err;
      }
    },
    [editor, docPath, saveVersion, userProfile],
  );

  // ── Regenerate this document from the underlying template + client data ──
  // Preserves the doc's spouseRole if it's the spouse's copy (deterministic
  // from the doc id suffix `_spouse` since that's how saveDocumentToVault
  // builds it). Without this, regenerating Adam's spouse-version of a will
  // would overwrite the client (Karen's) doc instead.
  const handleRegenerate = useCallback(async () => {
    if (!document || !document.docType) return;
    const inferredSpouseRole: 'client' | 'spouse' = documentId.endsWith('_spouse') ? 'spouse' : 'client';
    const whoseLabel = inferredSpouseRole === 'spouse' ? ' (spouse)' : '';
    const confirmMsg =
      `Regenerate "${document.displayName ?? document.docType}"${whoseLabel} from the current ` +
      `template and client data?\n\nYour current edits will be saved as version ${document.currentVersion ?? '?'} ` +
      `before the new draft replaces the working copy.`;
    if (!window.confirm(confirmMsg)) return;

    setRegenerating(true);
    setRegenError(null);
    // Force the load effect to pull the regenerated content into the editor as
    // soon as its snapshot arrives, and keep forcing until the op completes.
    // The snapshot can land BEFORE generateSingleDocument resolves, so setting
    // this only after the await raced and lost — the stale draft stayed and the
    // next keystroke autosaved it over the regenerated document (R5-022).
    regeneratingRef.current = true;
    forceReloadRef.current = true;
    // Cancel any pending debounced autosave — otherwise a timer scheduled from a
    // pre-regen keystroke could fire mid-regenerate and write stale editor HTML
    // to editorContent after the new draft lands (CV data-loss window).
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    // Per-property docs (deed_0, affidavitOfConsideration_1, gitRep3_0) must
    // regenerate the SAME property. Without propertyIndex the backend falls back
    // to the first property and writes a different un-suffixed doc, leaving this
    // editor's document stale (R5-023). Derive the index from the doc id suffix.
    const PER_PROPERTY_DOCS = new Set(['deed', 'affidavitOfConsideration', 'gitRep3']);
    let propertyIndex: number | undefined;
    if (PER_PROPERTY_DOCS.has(document.docType)) {
      const base = documentId.replace(/_spouse$/, '');
      const m = base.match(/_(\d+)$/);
      if (m) propertyIndex = parseInt(m[1], 10);
    }
    try {
      // Snapshot current edits so they aren't lost — flushing the in-memory
      // unsaved HTML into editorContent lets the backend's pre-overwrite version
      // snapshot capture it (matches the confirm dialog's promise).
      if (editor && hasUnsavedChanges) {
        await updateDoc<Document & { editorContent: string }>(docPath, {
          editorContent: editor.getHTML(),
          updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        });
      }
      await documentService.generateSingleDocument({
        firmId,
        clientId,
        docType: document.docType,
        spouseRole: inferredSpouseRole,
        propertyIndex,
      });
    } catch (err) {
      // Regen failed — cancel the forced reload so we keep the user's draft.
      forceReloadRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      setRegenError(msg);
      console.error('[DocumentEditor] regenerate failed:', err);
    } finally {
      regeneratingRef.current = false;
      setRegenerating(false);
    }
  }, [document, documentId, docPath, editor, firmId, clientId, hasUnsavedChanges, userProfile]);

  // ── Restore a version ──
  const handleRestoreVersion = useCallback(
    async (content: string, _vn: number) => {
      if (!editor) return;
      // Preserve the CURRENT working copy as a version BEFORE overwriting it, so
      // unsnapshotted edits aren't lost — the restore dialog promises exactly
      // this (R5-024). saveVersion owns the version counter (currentVersionRef)
      // and the parent-doc currentVersion bump, so routing through it also
      // avoids the duplicate versionNumber VersionHistory produced by numbering
      // restores off the lagging currentVersion prop.
      const currentHtml = editor.getHTML();
      if (currentHtml.replace(/<[^>]*>/g, '').trim()) {
        await saveVersion(currentHtml, 'Auto-saved before restore');
      }
      const safeContent = sanitizeHtml(content);
      editor.commands.setContent(safeContent, { emitUpdate: false });
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
      scheduleAutoSave(safeContent);
    },
    [editor, saveVersion, scheduleAutoSave],
  );

  // ── Status change ──
  const handleStatusChange = useCallback(
    async (newStatus: DocStatus) => {
      // Save a version on status change
      if (editor) {
        const html = editor.getHTML();
        await updateDoc<Document & { editorContent: string }>(docPath, {
          editorContent: html,
          status: newStatus,
          updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        });
        await saveVersion(
          html,
          `Status changed to ${newStatus}`,
        );
      } else {
        await updateDoc(docPath, {
          status: newStatus,
          updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        });
      }
      // If reverting from final, keep unlocked state
      if (newStatus !== 'final') {
        setDocUnlocked(false);
      }
    },
    [editor, docPath, saveVersion, userProfile],
  );

  // ── Title save ──
  const handleTitleSave = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = localTitle.trim();
    if (!trimmed || trimmed === document?.displayName) return;
    try {
      await updateDoc(docPath, {
        displayName: trimmed,
        updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
      });
    } catch (err) {
      console.error('[DocumentEditor] Title save error:', err);
    }
  }, [localTitle, document, docPath, userProfile]);

  // ── Cleanup auto-save timer on unmount ──
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // ── Loading state ──
  if (docLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#2b6cb0]" />
          <p className="text-sm text-gray-500">Loading document…</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (docError || !document) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 p-8">
        <Alert className="max-w-md border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-sm text-red-700">
            {docError
              ? `Failed to load document: ${docError.message}`
              : 'Document not found. It may have been deleted or you may not have permission to view it.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const status = document.status as DocStatus;

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        {/* Title */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {editingTitle ? (
            <Input
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') {
                  setLocalTitle(document.displayName);
                  setEditingTitle(false);
                }
              }}
              className="h-8 max-w-sm text-base font-semibold text-[#1a365d] border-[#2b6cb0] focus-visible:ring-[#2b6cb0]"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="truncate text-base font-semibold text-[#1a365d]">
                {document.displayName}
              </h1>
              {!isReadOnly && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0 text-gray-400 hover:text-[#2b6cb0]"
                      onClick={() => setEditingTitle(true)}
                    >
                      <PenSquare className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    <p>Rename document</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          <DocumentStatusBadge status={status} size="sm" warnings={document.warnings} validationFindings={document.validationFindings} />
        </div>

        {/* Right side: save indicator, unlock button */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Save indicator */}
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </span>
          )}
          {saveStatus === 'saved' && lastSavedAt && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Clock className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
          {saveStatus === 'unsaved' && (
            <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-xs text-red-500">
              <AlertCircle className="h-3.5 w-3.5" />
              Save failed
            </span>
          )}

          {/* Manual save */}
          {hasUnsavedChanges && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
                  onClick={() => {
                    if (editor) scheduleAutoSave(editor.getHTML());
                  }}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>Save now (Ctrl+S)</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Regenerate this document — attorney/admin/paralegal only,
              available for any doc that has a docType (i.e. was generated
              by the system). Snapshots current content as a version, then
              re-runs the unified generator and overwrites the working copy. */}
          {(isAttorney || isAdmin || isParalegal) && document?.docType && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff] disabled:opacity-50"
                  onClick={handleRegenerate}
                  disabled={regenerating || isReadOnly}
                >
                  {regenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>Re-run generation from the latest template + client data. Current edits saved as a version first.</p>
              </TooltipContent>
            </Tooltip>
          )}
          {regenError && (
            <span className="text-xs text-red-600">{regenError}</span>
          )}

          {/* Unlock final document (attorney only) */}
          {status === 'final' &&
            (isAttorney || isAdmin || isParalegal) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-7 gap-1.5 text-xs',
                      docUnlocked
                        ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                    )}
                    onClick={() => setDocUnlocked((prev) => !prev)}
                  >
                    {docUnlocked ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" />
                        Unlocked
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        Locked
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p>
                    {docUnlocked
                      ? 'Click to re-lock the document'
                      : 'Click to unlock for editing (attorney only)'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
        </div>
      </div>

      {/* ── TOOLBAR ─────────────────────────────────────────────────────── */}
      <EditorToolbar
        editor={editor}
        status={status}
        onStatusChange={handleStatusChange}
        onFindReplace={() => setShowFindReplace((prev) => !prev)}
        readOnly={isReadOnly}
        hasTemplateBaseline={!!document.templateBaseline}
        onCompareTemplate={() => setShowComparePanel(true)}
      />

      {/* ── FINAL LOCKED BANNER ─────────────────────────────────────────── */}
      {status === 'final' && !docUnlocked && (
        <div className="flex items-center justify-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <Lock className="h-4 w-4 text-emerald-600" />
          <span>
            This document has been finalized and is <strong>locked for execution</strong>. Attorneys
            can unlock it to make amendments.
          </span>
          {(isAttorney || isAdmin || isParalegal) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs text-emerald-700 hover:bg-emerald-100 px-2"
              onClick={() => setDocUnlocked(true)}
            >
              <Unlock className="h-3 w-3" />
              Unlock
            </Button>
          )}
        </div>
      )}

      {/* ── EDITOR + COMMENTS ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="relative flex-1 overflow-hidden">
          {/* Find & Replace floating panel */}
          <FindReplaceDialog
            editor={editor}
            open={showFindReplace}
            onClose={() => setShowFindReplace(false)}
          />

          {/* Legal page wrapper */}
          <div
            className={cn(
              'legal-editor legal-editor-wrap overflow-y-auto h-full',
              status === 'draft' && 'is-draft',
              status === 'review' && 'is-review',
              isReadOnly && 'is-readonly',
            )}
          >
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Comments sidebar */}
        <CommentsPanel
          firmId={firmId}
          clientId={clientId}
          documentId={documentId}
          collapsed={commentsCollapsed}
          onToggleCollapse={() => setCommentsCollapsed((prev) => !prev)}
        />
      </div>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      <EditorStatusBar
        editor={editor}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        currentVersion={document.currentVersion ?? 1}
        onViewHistory={() => setShowVersionHistory(true)}
      />

      {/* ── VERSION HISTORY PANEL ───────────────────────────────────────── */}
      <VersionHistory
        open={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        firmId={firmId}
        clientId={clientId}
        documentId={documentId}
        currentContent={editor?.getHTML() ?? ''}
        currentVersion={document.currentVersion ?? 1}
        onRestoreVersion={handleRestoreVersion}
        onSaveVersion={handleSaveVersion}
      />

      {/* Backdrop for version history slide-over */}
      {showVersionHistory && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
          onClick={() => setShowVersionHistory(false)}
        />
      )}

      {/* ── TEMPLATE COMPARISON PANEL ────────────────────────────────── */}
      <TemplateComparePanel
        open={showComparePanel}
        onClose={() => setShowComparePanel(false)}
        templateBaseline={document.templateBaseline ?? ''}
        currentContent={editor?.getHTML() ?? document.content ?? ''}
        documentTitle={document.displayName}
      />
    </div>
  );
}

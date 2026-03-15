/**
 * TemplatePreviewDialog.tsx
 *
 * Rich template preview with inline editing and custom field support.
 * Renders template HTML in a TipTap editor with legal document styling,
 * provides a variable sidebar panel, toggle to source view, and save-back.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Heading from '@tiptap/extension-heading';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';

import {
  Eye,
  Code2,
  Save,
  X,
  Plus,
  Bold,
  Italic,
  UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Braces,
  Loader2,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { templateService, type FullTemplate } from '@/services/knowledge-base-service';
import './template-preview-styles.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract all {{variableName}} tokens from an HTML/Handlebars string. */
function extractVariables(html: string): string[] {
  const regex = /\{\{(?!#|\/|!|>)([^}]+)\}\}/g;
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    vars.add(match[1].trim());
  }
  return Array.from(vars).sort();
}

/**
 * Decode HTML entities that may have been double-encoded during
 * Firebase callable function serialization.
 * e.g. "&lt;p&gt;" → "<p>", "&amp;nbsp;" → "&nbsp;"
 */
function decodeHtmlEntities(html: string): string {
  // If content already starts with a valid HTML tag, it's not double-encoded
  const trimmed = html.trim();
  if (trimmed.startsWith('<') && !trimmed.startsWith('&lt;')) {
    return html;
  }
  // Use the browser's built-in HTML parser to decode entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  return textarea.value;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface TemplatePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  firmId: string;
  templateId: string;
  templateName: string;
  onSaved?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function TemplatePreviewDialog({
  open,
  onClose,
  firmId,
  templateId,
  templateName,
  onSaved,
}: TemplatePreviewDialogProps) {
  // State
  const [template, setTemplate] = useState<FullTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [sourceContent, setSourceContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');

  // Track editor HTML for variable extraction (avoids complex dep in useMemo)
  const [editorHtml, setEditorHtml] = useState('');

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Heading.configure({ levels: [1, 2, 3, 4] }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        defaultAlignment: 'left',
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      Color.configure({ types: ['textStyle'] }),
      Superscript,
      Subscript,
    ],
    content: '',
    editable: true,
    onUpdate: ({ editor: ed }) => {
      setIsDirty(true);
      setEditorHtml(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'legal-editor-content',
        spellcheck: 'true',
      },
    },
  });

  // Load template content when dialog opens
  useEffect(() => {
    if (!open || !firmId || !templateId) return;

    let cancelled = false;
    setLoading(true);
    setIsDirty(false);
    setViewMode('rendered');
    setShowAddField(false);
    setNewFieldName('');

    templateService
      .getTemplateContent(firmId, templateId)
      .then((full) => {
        if (cancelled) return;
        // Decode HTML entities in case content was double-escaped
        const decodedContent = decodeHtmlEntities(full.content);
        setTemplate({ ...full, content: decodedContent });
        setSourceContent(decodedContent);
        setEditorHtml(decodedContent);
        editor?.commands.setContent(decodedContent, { emitUpdate: false });
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load template content.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, firmId, templateId, editor]);

  // Current content (from whichever view is active)
  const getCurrentContent = useCallback(() => {
    if (viewMode === 'source') return sourceContent;
    return editor?.getHTML() ?? '';
  }, [viewMode, sourceContent, editor]);

  // Variables extracted from content
  const variables = useMemo(() => {
    const content = viewMode === 'source' ? sourceContent : editorHtml;
    return extractVariables(content);
  }, [viewMode, sourceContent, editorHtml]);

  // Toggle view mode — sync content between views
  const handleToggleView = useCallback(() => {
    if (viewMode === 'rendered') {
      // Going to source: capture editor HTML
      setSourceContent(editor?.getHTML() ?? '');
      setViewMode('source');
    } else {
      // Going back to rendered: push source into editor
      editor?.commands.setContent(sourceContent, { emitUpdate: false });
      setViewMode('rendered');
    }
  }, [viewMode, editor, sourceContent]);

  // Insert a variable at the cursor
  const handleInsertVariable = useCallback(
    (varName: string) => {
      if (viewMode === 'source') {
        // For source mode, append to source
        setSourceContent((prev) => prev + `{{${varName}}}`);
        setIsDirty(true);
      } else if (editor) {
        editor.chain().focus().insertContent(`{{${varName}}}`).run();
        // onUpdate will set dirty
      }
    },
    [viewMode, editor],
  );

  // Add custom field
  const handleAddCustomField = useCallback(() => {
    const trimmed = newFieldName.trim().replace(/[{}]/g, '');
    if (!trimmed) return;
    // Format: camelCase-ish — allow dots for nesting
    const fieldName = trimmed.replace(/\s+/g, '');
    handleInsertVariable(fieldName);
    setNewFieldName('');
    setShowAddField(false);
  }, [newFieldName, handleInsertVariable]);

  // Save changes
  const handleSave = useCallback(async () => {
    if (!template || !firmId) return;

    setSaving(true);
    try {
      const content = getCurrentContent();
      const vars = extractVariables(content);

      await templateService.uploadTemplate({
        firmId,
        templateId: template.id,
        docType: template.docType,
        name: template.name,
        description: template.description,
        variant: template.variant,
        complexity: template.complexity,
        content,
        isDefault: template.isDefault,
        variables: vars,
        tags: template.tags ?? [],
      });

      toast.success('Template saved successfully.');
      setIsDirty(false);
      onSaved?.();
    } catch {
      toast.error('Failed to save template.');
    } finally {
      setSaving(false);
    }
  }, [template, firmId, getCurrentContent, onSaved]);

  // ── Toolbar button helper ──
  const ToolbarBtn = ({
    icon: Icon,
    label,
    isActive,
    onClick,
    disabled,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    isActive?: boolean;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`rounded p-1.5 transition-colors ${
            isActive
              ? 'bg-[#2b6cb0] text-white'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] w-[1200px] max-h-[92vh] overflow-hidden flex flex-col p-0">
        <TooltipProvider delayDuration={200}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-5 w-5 text-[#2b6cb0]" />
              {templateName}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => viewMode !== 'rendered' && handleToggleView()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'rendered'
                      ? 'bg-white text-[#2b6cb0] shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Rendered
                </button>
                <button
                  onClick={() => viewMode !== 'source' && handleToggleView()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'source'
                      ? 'bg-white text-[#2b6cb0] shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Source
                </button>
              </div>

              {/* Save button */}
              <Button
                size="sm"
                disabled={!isDirty || saving}
                onClick={handleSave}
                className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white gap-1.5 h-8"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {saving ? 'Saving…' : isDirty ? 'Save Changes' : 'Saved'}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ── Mini Toolbar (rendered mode only) ────────────────────────────── */}
        {viewMode === 'rendered' && editor && (
          <div className="flex items-center gap-0.5 px-5 py-2 border-b border-gray-100 bg-gray-50/50 flex-shrink-0 flex-wrap">
            <ToolbarBtn
              icon={Undo2}
              label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            />
            <ToolbarBtn
              icon={Redo2}
              label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            />

            <div className="w-px h-5 bg-gray-200 mx-1" />

            <ToolbarBtn
              icon={Bold}
              label="Bold"
              isActive={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolbarBtn
              icon={Italic}
              label="Italic"
              isActive={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolbarBtn
              icon={UnderlineIcon}
              label="Underline"
              isActive={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />

            <div className="w-px h-5 bg-gray-200 mx-1" />

            <ToolbarBtn
              icon={Heading1}
              label="Heading 1"
              isActive={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolbarBtn
              icon={Heading2}
              label="Heading 2"
              isActive={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolbarBtn
              icon={Heading3}
              label="Heading 3"
              isActive={editor.isActive('heading', { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            />

            <div className="w-px h-5 bg-gray-200 mx-1" />

            <ToolbarBtn
              icon={AlignLeft}
              label="Align Left"
              isActive={editor.isActive({ textAlign: 'left' })}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
            />
            <ToolbarBtn
              icon={AlignCenter}
              label="Align Center"
              isActive={editor.isActive({ textAlign: 'center' })}
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
            />
            <ToolbarBtn
              icon={AlignRight}
              label="Align Right"
              isActive={editor.isActive({ textAlign: 'right' })}
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
            />
            <ToolbarBtn
              icon={AlignJustify}
              label="Justify"
              isActive={editor.isActive({ textAlign: 'justify' })}
              onClick={() => editor.chain().focus().setTextAlign('justify').run()}
            />

            <div className="w-px h-5 bg-gray-200 mx-1" />

            <ToolbarBtn
              icon={List}
              label="Bullet List"
              isActive={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <ToolbarBtn
              icon={ListOrdered}
              label="Ordered List"
              isActive={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-[#2b6cb0]" />
              <p className="text-sm text-gray-500">Loading template…</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* ── Editor / Source area ──────────────────────────────────── */}
            <div className="flex-1 overflow-hidden">
              {viewMode === 'rendered' ? (
                <div className="template-preview-wrap">
                  <div className="template-preview">
                    <EditorContent editor={editor} />
                  </div>
                </div>
              ) : (
                <div className="p-4 h-full">
                  <textarea
                    value={sourceContent}
                    onChange={(e) => {
                      setSourceContent(e.target.value);
                      setIsDirty(true);
                    }}
                    className="template-source-view w-full h-full resize-none"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

            {/* ── Variables Sidebar ─────────────────────────────────────── */}
            <div className="w-64 border-l border-gray-200 bg-gray-50/50 flex flex-col flex-shrink-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <Braces className="h-3.5 w-3.5 text-[#2b6cb0]" />
                    Template Variables
                  </h3>
                  <span className="text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                    {variables.length}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  Click a variable to insert at cursor
                </p>
              </div>

              {/* Variable list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {variables.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center mt-4">
                    No variables detected
                  </p>
                ) : (
                  variables.map((v) => (
                    <button
                      key={v}
                      onClick={() => handleInsertVariable(v)}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-mono bg-white border border-gray-200 text-[#2b6cb0] hover:bg-blue-50 hover:border-blue-300 transition-all group flex items-center gap-1.5"
                      title={`Insert {{${v}}} at cursor`}
                    >
                      <Braces className="h-3 w-3 text-gray-400 group-hover:text-[#2b6cb0] flex-shrink-0" />
                      <span className="truncate">{v}</span>
                      <Plus className="h-3 w-3 text-gray-300 group-hover:text-[#2b6cb0] ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))
                )}
              </div>

              {/* Add custom field */}
              <div className="px-3 pb-3 pt-2 border-t border-gray-200 flex-shrink-0 bg-white">
                {showAddField ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddCustomField();
                        if (e.key === 'Escape') {
                          setShowAddField(false);
                          setNewFieldName('');
                        }
                      }}
                      placeholder="e.g. clientFullName"
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-mono focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={handleAddCustomField}
                        disabled={!newFieldName.trim()}
                        className="flex-1 h-7 text-xs bg-[#2b6cb0] hover:bg-[#1a365d] text-white gap-1"
                      >
                        <Check className="h-3 w-3" />
                        Insert
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowAddField(false);
                          setNewFieldName('');
                        }}
                        className="h-7 text-xs px-2"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddField(true)}
                    className="w-full h-8 text-xs border-dashed border-gray-300 text-gray-600 hover:text-[#2b6cb0] hover:border-[#2b6cb0] gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Custom Field
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

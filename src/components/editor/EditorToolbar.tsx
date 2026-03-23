/**
 * EditorToolbar.tsx
 *
 * Three-row professional toolbar for the TipTap legal document editor.
 *
 * Row 1 — Text formatting:
 *   Font family · Font size · Bold · Italic · Underline · Strikethrough ·
 *   Superscript · Subscript · Text color · Highlight · Clear formatting
 *
 * Row 2 — Document structure:
 *   Paragraph style · Text align · Bullet list · Numbered list ·
 *   Indent · Outdent · Table · HR / page break · Link · Image
 *
 * Row 3 — Actions:
 *   Undo · Redo · Find & Replace · Insert legal blocks (signature, notary,
 *   witness, self-proving affidavit) · Status change dropdown
 *
 * All buttons show a tooltip on hover (shadcn/ui Tooltip).
 * Active state is highlighted when the format is applied at cursor.
 */

import { useCallback, useRef, useState } from 'react';
import { type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Indent,
  Outdent,
  Link2,
  ImageIcon,
  Table2,
  Minus,
  Undo2,
  Redo2,
  Search,
  RemoveFormatting,
  ChevronDown,
  PenLine,
  Stamp,
  Users,
  FileBadge,
  Check,
  Loader2,
  Lock,
  Unlock,
  FileCheck,
  FileEdit,
  Columns,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { type DocStatus } from '@/types';

import {
  SIGNATURE_BLOCK,
  WITNESS_BLOCK,
  NOTARY_BLOCK,
  SELF_PROVING_AFFIDAVIT,
  PAGE_BREAK,
  DEFINITIONS_BLOCK,
} from './legal-blocks';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditorToolbarProps {
  editor: Editor | null;
  status: DocStatus;
  onStatusChange: (status: DocStatus) => Promise<void>;
  onFindReplace: () => void;
  readOnly?: boolean;
  className?: string;
  /** Whether this document has a template baseline for comparison */
  hasTemplateBaseline?: boolean;
  /** Open the template comparison panel */
  onCompareTemplate?: () => void;
}

// ── Small helper: Toolbar button ──────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  disabled,
  tooltip,
  children,
  className,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'default' : 'ghost'}
          size="icon"
          className={cn(
            'h-7 w-7 rounded-md',
            active
              ? 'bg-[#1a365d] text-white hover:bg-[#2d4a7a] hover:text-white'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            disabled && 'pointer-events-none opacity-40',
            className,
          )}
          onClick={onClick}
          disabled={disabled}
          type="button"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Color picker (inline hex input) ──────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="relative flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
          onClick={() => inputRef.current?.click()}
          title={label}
        >
          {children}
          <input
            ref={inputRef}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={label}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Table grid picker ────────────────────────────────────────────────────────

function TablePicker({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [hovered, setHovered] = useState<{ r: number; c: number } | null>(null);
  const MAX = 8;

  return (
    <div className="p-2">
      <p className="mb-1.5 text-xs text-gray-500 text-center">
        {hovered ? `${hovered.r} × ${hovered.c} table` : 'Select table size'}
      </p>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${MAX}, 1fr)` }}>
        {Array.from({ length: MAX * MAX }, (_, i) => {
          const r = Math.floor(i / MAX) + 1;
          const c = (i % MAX) + 1;
          const isActive = hovered && r <= hovered.r && c <= hovered.c;
          return (
            <button
              key={i}
              type="button"
              className={cn(
                'h-5 w-5 rounded-sm border transition-colors',
                isActive
                  ? 'border-[#2b6cb0] bg-[#ebf4ff]'
                  : 'border-gray-200 bg-gray-50 hover:border-gray-300',
              )}
              onMouseEnter={() => setHovered({ r, c })}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onInsert(r, c)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Link dialog (inline in dropdown) ─────────────────────────────────────────

function LinkInput({ onInsert }: { onInsert: (url: string, text?: string) => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  return (
    <div className="p-3 space-y-2 w-64">
      <p className="text-xs font-semibold text-gray-700">Insert Link</p>
      <Input
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="h-7 text-xs"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && url && onInsert(url, text)}
      />
      <Input
        placeholder="Display text (optional)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-7 text-xs"
      />
      <Button
        size="sm"
        className="h-7 w-full text-xs bg-[#2b6cb0] hover:bg-[#1a365d]"
        disabled={!url}
        onClick={() => onInsert(url, text)}
        type="button"
      >
        Insert
      </Button>
    </div>
  );
}

// ── Status change config ──────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{
  value: DocStatus;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: string;
}> = [
  {
    value: 'draft',
    label: 'Draft',
    icon: FileEdit,
    description: 'Working copy — editable',
    color: 'text-amber-600',
  },
  {
    value: 'review',
    label: 'Under Review',
    icon: FileCheck,
    description: 'Submitted for attorney review',
    color: 'text-blue-600',
  },
  {
    value: 'final',
    label: 'Final',
    icon: Lock,
    description: 'Approved — locked for execution',
    color: 'text-emerald-600',
  },
];

// ── Main Toolbar ──────────────────────────────────────────────────────────────

export default function EditorToolbar({
  editor,
  status,
  onStatusChange,
  onFindReplace,
  readOnly = false,
  className,
  hasTemplateBaseline,
  onCompareTemplate,
}: EditorToolbarProps) {
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('#fef08a');

  const handleStatusChange = useCallback(
    async (newStatus: DocStatus) => {
      if (newStatus === status) return;
      setIsChangingStatus(true);
      try {
        await onStatusChange(newStatus);
      } finally {
        setIsChangingStatus(false);
      }
    },
    [status, onStatusChange],
  );

  const insertContent = useCallback(
    (html: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(html).run();
    },
    [editor],
  );

  const handleLinkInsert = useCallback(
    (url: string, text?: string) => {
      if (!editor) return;
      if (text) {
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${url}">${text}</a>`)
          .run();
      } else {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          editor.chain().focus().setLink({ href: url }).run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent(`<a href="${url}">${url}</a>`)
            .run();
        }
      }
    },
    [editor],
  );

  const handleImageInsert = useCallback(() => {
    const url = window.prompt('Image URL:');
    if (url) {
      editor?.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const currentStatus = STATUS_OPTIONS.find((s) => s.value === status);
  const CurrentStatusIcon = currentStatus?.icon ?? FileEdit;

  return (
    <div
      className={cn(
        'editor-toolbar flex flex-col border-b border-gray-200 bg-white',
        readOnly && 'pointer-events-none opacity-60',
        className,
      )}
    >
      {/* ── ROW 1: Text formatting ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 px-2 py-1">
        {/* Font family */}
        <Select
          value={
            (editor.getAttributes('textStyle').fontFamily as string | undefined) ??
            'Times New Roman'
          }
          onValueChange={(v) =>
            editor.chain().focus().setFontFamily(v).run()
          }
        >
          <SelectTrigger className="h-7 w-[150px] text-xs border-gray-200 focus:ring-0 focus:ring-offset-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Times New Roman" className="text-xs" style={{ fontFamily: 'Times New Roman' }}>
              Times New Roman
            </SelectItem>
            <SelectItem value="Arial" className="text-xs" style={{ fontFamily: 'Arial' }}>
              Arial
            </SelectItem>
            <SelectItem value="Courier New" className="text-xs" style={{ fontFamily: 'Courier New' }}>
              Courier New
            </SelectItem>
            <SelectItem value="Georgia" className="text-xs" style={{ fontFamily: 'Georgia' }}>
              Georgia
            </SelectItem>
            <SelectItem value="Garamond" className="text-xs" style={{ fontFamily: 'Garamond' }}>
              Garamond
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Font size */}
        <Select
          value={String(
            (editor.getAttributes('textStyle').fontSize as string | undefined)?.replace('px', '') ?? '16',
          )}
          onValueChange={(v) =>
            editor.chain().focus().setMark('textStyle', { fontSize: `${v}px` }).run()
          }
        >
          <SelectTrigger className="h-7 w-[60px] text-xs border-gray-200 focus:ring-0 focus:ring-offset-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Bold */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          tooltip="Bold (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>

        {/* Italic */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          tooltip="Italic (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>

        {/* Underline */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          tooltip="Underline (Ctrl+U)"
        >
          <Underline className="h-4 w-4" />
        </ToolbarButton>

        {/* Strikethrough */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          tooltip="Strikethrough"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Superscript */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          active={editor.isActive('superscript')}
          tooltip="Superscript"
        >
          <Superscript className="h-4 w-4" />
        </ToolbarButton>

        {/* Subscript */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          active={editor.isActive('subscript')}
          tooltip="Subscript"
        >
          <Subscript className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Text color */}
        <ColorPicker
          value={textColor}
          onChange={(color) => {
            setTextColor(color);
            editor.chain().focus().setColor(color).run();
          }}
          label="Text color"
        >
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold leading-none" style={{ fontFamily: 'serif' }}>A</span>
            <div className="mt-0.5 h-1 w-4 rounded-sm" style={{ backgroundColor: textColor }} />
          </div>
        </ColorPicker>

        {/* Highlight */}
        <ColorPicker
          value={highlightColor}
          onChange={(color) => {
            setHighlightColor(color);
            editor.chain().focus().toggleHighlight({ color }).run();
          }}
          label="Highlight color"
        >
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold leading-none text-yellow-600">ab</span>
            <div className="mt-0.5 h-1 w-4 rounded-sm" style={{ backgroundColor: highlightColor }} />
          </div>
        </ColorPicker>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Clear formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          tooltip="Clear all formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* ── ROW 2: Structure ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 px-2 py-1">
        {/* Paragraph style */}
        <Select
          value={
            editor.isActive('heading', { level: 1 })
              ? 'h1'
              : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
              ? 'h3'
              : editor.isActive('heading', { level: 4 })
              ? 'h4'
              : 'paragraph'
          }
          onValueChange={(v) => {
            if (v === 'paragraph') {
              editor.chain().focus().setParagraph().run();
            } else if (v === 'h1') {
              editor.chain().focus().toggleHeading({ level: 1 }).run();
            } else if (v === 'h2') {
              editor.chain().focus().toggleHeading({ level: 2 }).run();
            } else if (v === 'h3') {
              editor.chain().focus().toggleHeading({ level: 3 }).run();
            } else if (v === 'h4') {
              editor.chain().focus().toggleHeading({ level: 4 }).run();
            }
          }}
        >
          <SelectTrigger className="h-7 w-[130px] text-xs border-gray-200 focus:ring-0 focus:ring-offset-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="paragraph" className="text-xs">Normal Text</SelectItem>
            <SelectItem value="h1" className="text-xs font-bold">Heading 1</SelectItem>
            <SelectItem value="h2" className="text-xs font-semibold">Heading 2</SelectItem>
            <SelectItem value="h3" className="text-xs font-medium">Heading 3</SelectItem>
            <SelectItem value="h4" className="text-xs italic">Heading 4</SelectItem>
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Text align */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          tooltip="Align left"
        >
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          tooltip="Align center"
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          tooltip="Align right"
        >
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          active={editor.isActive({ textAlign: 'justify' })}
          tooltip="Justify"
        >
          <AlignJustify className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          tooltip="Bullet list"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          tooltip="Numbered list"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>

        {/* Indent / Outdent */}
        <ToolbarButton
          onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
          disabled={!editor.can().sinkListItem('listItem')}
          tooltip="Indent (Tab)"
        >
          <Indent className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().liftListItem('listItem').run()}
          disabled={!editor.can().liftListItem('listItem')}
          tooltip="Outdent (Shift+Tab)"
        >
          <Outdent className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Table insert */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-gray-600 hover:bg-gray-100"
                  type="button"
                >
                  <Table2 className="h-4 w-4" />
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>Insert table</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="p-0">
            <TablePicker
              onInsert={(rows, cols) => {
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows, cols, withHeaderRow: true })
                  .run();
              }}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => editor.chain().focus().addColumnBefore().run()}
            >
              Add column before
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => editor.chain().focus().addColumnAfter().run()}
            >
              Add column after
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => editor.chain().focus().deleteColumn().run()}
            >
              Delete column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => editor.chain().focus().addRowBefore().run()}
            >
              Add row before
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => editor.chain().focus().addRowAfter().run()}
            >
              Add row after
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs text-red-600"
              onSelect={() => editor.chain().focus().deleteRow().run()}
            >
              Delete row
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-red-600"
              onSelect={() => editor.chain().focus().deleteTable().run()}
            >
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Page break / HR */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          tooltip="Insert page break"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Link */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={editor.isActive('link') ? 'default' : 'ghost'}
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-md',
                    editor.isActive('link')
                      ? 'bg-[#1a365d] text-white'
                      : 'text-gray-600 hover:bg-gray-100',
                  )}
                  type="button"
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>Insert / edit link</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="p-0">
            <LinkInput onInsert={handleLinkInsert} />
            {editor.isActive('link') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs text-red-600"
                  onSelect={() => editor.chain().focus().unsetLink().run()}
                >
                  Remove link
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Image */}
        <ToolbarButton
          onClick={handleImageInsert}
          tooltip="Insert image"
        >
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* ── ROW 3: Actions ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        {/* Undo / Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          tooltip="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          tooltip="Redo (Ctrl+Y)"
        >
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Find & Replace */}
        <ToolbarButton
          onClick={onFindReplace}
          tooltip="Find & Replace (Ctrl+H)"
        >
          <Search className="h-4 w-4" />
        </ToolbarButton>

        {/* Compare with Template (only for hybrid docs) */}
        {hasTemplateBaseline && onCompareTemplate && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-[#2b6cb0] hover:bg-[#ebf4ff] hover:text-[#1a365d] font-medium pointer-events-auto opacity-100"
                  type="button"
                  onClick={onCompareTemplate}
                >
                  <Columns className="h-4 w-4" />
                  Compare with Template
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p>View template baseline vs AI-enhanced content side by side</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Legal blocks dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-gray-600 hover:bg-gray-100"
                  type="button"
                >
                  <PenLine className="h-4 w-4" />
                  Insert Legal Block
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>Insert pre-formatted legal blocks</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(SIGNATURE_BLOCK)}
            >
              <PenLine className="h-3.5 w-3.5 text-[#2b6cb0]" />
              Signature Block
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(WITNESS_BLOCK)}
            >
              <Users className="h-3.5 w-3.5 text-[#2b6cb0]" />
              Witness Block (2 witnesses)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(NOTARY_BLOCK)}
            >
              <Stamp className="h-3.5 w-3.5 text-[#2b6cb0]" />
              Notary Acknowledgment (NJ)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(SELF_PROVING_AFFIDAVIT)}
            >
              <FileBadge className="h-3.5 w-3.5 text-[#2b6cb0]" />
              Self-Proving Affidavit (N.J.S.A. 3B:3-4)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(DEFINITIONS_BLOCK)}
            >
              <FileCheck className="h-3.5 w-3.5 text-[#2b6cb0]" />
              Definitions Article
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-xs"
              onSelect={() => insertContent(PAGE_BREAK)}
            >
              <Minus className="h-3.5 w-3.5 text-gray-400" />
              Page Break
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Document status dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-7 gap-1.5 px-2.5 text-xs border font-medium',
                    status === 'draft' && 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
                    status === 'review' && 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
                    status === 'final' && 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                  )}
                  disabled={isChangingStatus}
                  type="button"
                >
                  {isChangingStatus ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CurrentStatusIcon className="h-3.5 w-3.5" />
                  )}
                  {currentStatus?.label ?? status}
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p>Change document status</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            {STATUS_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <DropdownMenuItem
                  key={opt.value}
                  className="gap-2 text-xs"
                  onSelect={() => handleStatusChange(opt.value)}
                  disabled={opt.value === status || isChangingStatus}
                >
                  <Icon className={cn('h-3.5 w-3.5', opt.color)} />
                  <div className="flex-1">
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-[10px] text-gray-400">{opt.description}</p>
                  </div>
                  {opt.value === status && (
                    <Check className="h-3.5 w-3.5 text-gray-400" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Lock/unlock indicator for final docs */}
        {status === 'final' && (
          <div className="ml-1 flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
            <Lock className="h-3 w-3" />
            Document locked
          </div>
        )}
        {readOnly && status !== 'final' && (
          <div className="ml-1 flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500 border border-gray-200">
            <Unlock className="h-3 w-3" />
            Read-only
          </div>
        )}
      </div>
    </div>
  );
}

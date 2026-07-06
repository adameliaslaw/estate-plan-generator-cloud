/**
 * CommentsPanel.tsx
 *
 * Collapsible right-sidebar for document-level comments and annotations.
 * Supports attorney–paralegal collaboration during document review.
 *
 * Features:
 *   - List of comments with author, timestamp, text, resolve button
 *   - Reply threads per comment
 *   - Add new comment (textarea + submit)
 *   - Resolved comments shown collapsed / grayed out
 *   - Real-time updates via Firestore onSnapshot (through useCollection hook)
 *
 * Firestore path:
 *   /firms/{firmId}/clients/{clientId}/documents/{docId}/comments/{commentId}
 *
 * Comment shape:
 *   { content, authorId, authorName, resolved, createdAt, replies: [{...}] }
 */

import { useState, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  Reply,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useCollection, createDoc, updateDoc } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: { seconds: number; nanoseconds: number } | null;
}

export interface DocumentComment {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  resolved: boolean;
  position?: number;
  createdAt: { seconds: number; nanoseconds: number } | null;
  replies: CommentReply[];
}

interface CommentsPanelProps {
  firmId: string;
  clientId: string;
  documentId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: { seconds: number } | null): string {
  if (!ts) return 'just now';
  const date = new Date(ts.seconds * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

function getAvatarColor(authorId: string): string {
  const colors = [
    'bg-blue-600',
    'bg-purple-600',
    'bg-emerald-600',
    'bg-amber-600',
    'bg-rose-600',
    'bg-teal-600',
    'bg-indigo-600',
  ];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, authorId, size = 'sm' }: { name: string; authorId: string; size?: 'sm' | 'md' }) {
  const color = getAvatarColor(authorId);
  const initials = getInitials(name);
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0',
        color,
        size === 'sm' ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm',
      )}
    >
      {initials}
    </div>
  );
}

// ── Single comment card ───────────────────────────────────────────────────────

function CommentCard({
  comment,
  onResolve,
  onAddReply,
}: {
  comment: DocumentComment;
  onResolve: () => void;
  onAddReply: (text: string) => void;
}) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [replyError, setReplyError] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    setReplyError(false);
    try {
      await onAddReply(replyText.trim());
      setReplyText('');
      setShowReplyInput(false);
    } catch {
      // Keep the typed text and tell the user it didn't post (R5-077).
      setReplyError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const replyCount = comment.replies?.length ?? 0;

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        comment.resolved
          ? 'border-gray-100 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white hover:border-gray-300',
      )}
    >
      {/* Comment header */}
      <div className="flex items-start gap-2.5 p-3">
        <Avatar name={comment.authorName} authorId={comment.authorId} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-1">
            <p className="text-xs font-semibold text-gray-800 truncate">
              {comment.authorName}
            </p>
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              {formatTimestamp(comment.createdAt)}
            </span>
          </div>
          <p
            className={cn(
              'mt-1 text-sm leading-relaxed text-gray-700',
              comment.resolved && 'line-through text-gray-400',
            )}
          >
            {comment.content}
          </p>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-1 border-t border-gray-100 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 gap-1 px-2 text-[10px]',
                comment.resolved
                  ? 'text-gray-400 hover:text-gray-600'
                  : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50',
              )}
              onClick={onResolve}
            >
              {comment.resolved ? (
                <>
                  <Circle className="h-3 w-3" />
                  Re-open
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Resolve
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>{comment.resolved ? 'Re-open this comment' : 'Mark as resolved'}</p>
          </TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px] text-gray-500 hover:text-gray-700"
          onClick={() => setShowReplyInput(!showReplyInput)}
        >
          <Reply className="h-3 w-3" />
          Reply
        </Button>

        {replyCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-0.5 px-1.5 text-[10px] text-gray-400 hover:text-gray-600"
            onClick={() => setShowReplies(!showReplies)}
          >
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[9px] bg-gray-100 text-gray-500"
            >
              {replyCount}
            </Badge>
            {showReplies ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>

      {/* Replies list */}
      {showReplies && replyCount > 0 && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-2">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="flex items-start gap-2">
              <Avatar name={reply.authorName} authorId={reply.authorId} size="sm" />
              <div className="flex-1 min-w-0 bg-gray-50 rounded-md px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-[10px] font-semibold text-gray-700 truncate">
                    {reply.authorName}
                  </p>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">
                    {formatTimestamp(reply.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                  {reply.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReplyInput && (
        <div className="border-t border-gray-100 p-3 space-y-2">
          <Textarea
            placeholder="Write a reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            className="resize-none text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleReply();
              }
              if (e.key === 'Escape') {
                setShowReplyInput(false);
              }
            }}
          />
          {replyError && (
            <p className="text-xs text-red-600">
              Failed to post reply. Please try again.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs bg-[#2b6cb0] hover:bg-[#1a365d]"
              onClick={handleReply}
              disabled={!replyText.trim() || submitting}
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Send
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setShowReplyInput(false);
                setReplyText('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommentsPanel({
  firmId,
  clientId,
  documentId,
  collapsed,
  onToggleCollapse,
}: CommentsPanelProps) {
  const { userProfile } = useAuth();
  const commentsPath = `firms/${firmId}/clients/${clientId}/documents/${documentId}/comments`;

  const { data: comments, loading } = useCollection<DocumentComment>(commentsPath);
  const [newCommentText, setNewCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  const openComments = comments.filter((c) => !c.resolved);
  const resolvedComments = comments.filter((c) => c.resolved);
  const visibleComments = showResolved ? comments : openComments;

  const handleAddComment = async () => {
    if (!newCommentText.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await createDoc(commentsPath, {
        content: newCommentText.trim(),
        authorId: userProfile?.uid ?? 'unknown',
        authorName: userProfile?.displayName ?? userProfile?.email ?? 'Unknown',
        resolved: false,
        position: null,
        createdAt: serverTimestamp(),
        replies: [],
      });
      setNewCommentText('');
    } catch (err) {
      setError('Failed to add comment. Please try again.');
      console.error('[CommentsPanel] Add comment error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (comment: DocumentComment) => {
    try {
      await updateDoc(`${commentsPath}/${comment.id}`, {
        resolved: !comment.resolved,
      });
    } catch (err) {
      console.error('[CommentsPanel] Resolve error:', err);
    }
  };

  const handleAddReply = async (comment: DocumentComment, replyText: string) => {
    const newReply: CommentReply = {
      id: crypto.randomUUID(),
      authorId: userProfile?.uid ?? 'unknown',
      authorName: userProfile?.displayName ?? userProfile?.email ?? 'Unknown',
      content: replyText,
      // Firestore's serverTimestamp() sentinel can't be used inside an array
      // element (arrayUnion), so a server-resolved time is impossible here.
      // Stamp a client-side Timestamp.now() instead — otherwise createdAt stays
      // null forever and every reply renders as "just now".
      createdAt: Timestamp.now(),
    };
    try {
      // Append atomically so concurrent replies don't clobber each other
      // (a render-captured [...comment.replies] read-modify-write would).
      await updateDoc<DocumentComment>(`${commentsPath}/${comment.id}`, {
        replies: arrayUnion(newReply) as unknown as CommentReply[],
      });
    } catch (err) {
      console.error('[CommentsPanel] Reply error:', err);
      // Re-throw so the reply UI keeps the text and shows a failure instead of
      // clearing the input as if the reply posted (R5-077).
      throw err;
    }
  };

  // Sort: open first, then by created desc
  const sortedComments = [...visibleComments].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    const aTime = a.createdAt?.seconds ?? 0;
    const bTime = b.createdAt?.seconds ?? 0;
    return bTime - aTime;
  });

  // Collapsed state — show just the icon toggle
  if (collapsed) {
    return (
      <div className="comments-panel flex w-10 flex-col items-center border-l border-gray-200 bg-white py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-500 hover:text-[#2b6cb0]"
              onClick={onToggleCollapse}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <p>Show comments</p>
          </TooltipContent>
        </Tooltip>
        <div className="mt-2 flex flex-col items-center gap-1">
          <MessageSquare className="h-5 w-5 text-gray-400" />
          {openComments.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 min-w-[16px] px-1 text-[9px] bg-amber-100 text-amber-700"
            >
              {openComments.length}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="comments-panel flex w-72 flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#2b6cb0]" />
          <span className="text-sm font-semibold text-[#1a365d]">Comments</span>
          {openComments.length > 0 && (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-xs bg-amber-100 text-amber-700 border border-amber-200"
            >
              {openComments.length}
            </Badge>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-gray-600"
              onClick={onToggleCollapse}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <p>Hide comments</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* New comment input */}
      <div className="border-b border-gray-100 p-3 space-y-2">
        <Textarea
          ref={newCommentRef}
          placeholder="Add a comment…"
          value={newCommentText}
          onChange={(e) => setNewCommentText(e.target.value)}
          rows={3}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleAddComment();
            }
          }}
        />
        {error && (
          <Alert className="border-red-200 bg-red-50 py-1.5 px-3">
            <AlertDescription className="text-xs text-red-700">{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9px]">⌘↵</kbd> to submit
          </span>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs bg-[#2b6cb0] hover:bg-[#1a365d]"
            onClick={handleAddComment}
            disabled={!newCommentText.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            Add
          </Button>
        </div>
      </div>

      {/* Resolved toggle */}
      {resolvedComments.length > 0 && (
        <div className="border-b border-gray-100 px-3 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1.5 text-[10px] text-gray-500 hover:text-gray-700 px-0"
            onClick={() => setShowResolved(!showResolved)}
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {showResolved ? 'Hide' : 'Show'} {resolvedComments.length} resolved
          </Button>
        </div>
      )}

      {/* Comments list */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          )}

          {!loading && sortedComments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="h-8 w-8 text-gray-200 mb-3" />
              <p className="text-xs font-medium text-gray-400">No comments yet</p>
              <p className="text-[10px] text-gray-300 mt-1">
                Add a comment above to start the discussion
              </p>
            </div>
          )}

          {!loading &&
            sortedComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                onResolve={() => handleResolve(comment)}
                onAddReply={(text) => handleAddReply(comment, text)}
              />
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}

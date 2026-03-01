/**
 * DocumentStatusBadge.tsx
 *
 * Reusable badge component for document status.
 * draft   → amber / yellow
 * review  → blue
 * final   → green
 */

import { type DocStatus } from '@/types';
import { cn } from '@/lib/utils';

interface DocumentStatusBadgeProps {
  status: DocStatus;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_CONFIG: Record<
  DocStatus,
  { label: string; classes: string }
> = {
  draft: {
    label: 'Draft',
    classes: 'bg-amber-100 text-amber-800 ring-amber-200',
  },
  review: {
    label: 'In Review',
    classes: 'bg-blue-100 text-blue-800 ring-blue-200',
  },
  final: {
    label: 'Final',
    classes: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  },
};

export default function DocumentStatusBadge({
  status,
  size = 'sm',
  className,
}: DocumentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    classes: 'bg-gray-100 text-gray-600 ring-gray-200',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        config.classes,
        className,
      )}
    >
      {config.label}
    </span>
  );
}

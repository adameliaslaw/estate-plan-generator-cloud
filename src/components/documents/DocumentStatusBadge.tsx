/**
 * DocumentStatusBadge.tsx
 *
 * Reusable badge component for document status.
 * draft        → amber / yellow
 * review       → blue
 * final        → green
 * incomplete   → red  (with specific missing-data list)
 * needs_review → purple (with validation findings)
 *
 * When `isStale` is true on a draft, shows a warning indicator
 * that the source data has changed since the document was generated.
 */

import { type DocStatus } from '@/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, AlertCircle, Eye } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DocumentStatusBadgeProps {
  status: DocStatus;
  isStale?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Completeness warnings — specific missing data fields */
  warnings?: string[];
  /** Structural validation findings */
  validationFindings?: Array<{ name: string; severity: 'error' | 'warning' }>;
}

const STATUS_CONFIG: Record<
  DocStatus,
  { label: string; classes: string; icon?: 'warning' | 'incomplete' | 'review'; tooltip?: string }
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
  incomplete: {
    label: 'Incomplete',
    classes: 'bg-red-100 text-red-800 ring-red-200',
    icon: 'incomplete',
    tooltip: 'This document may be missing required sections or data. Consider regenerating with complete client information.',
  },
  needs_review: {
    label: 'Needs Review',
    classes: 'bg-purple-100 text-purple-800 ring-purple-200',
    icon: 'review',
    tooltip: 'Auto-validation detected structural issues (e.g., placeholder text, truncation). An attorney should review before finalizing.',
  },
  error: {
    label: 'Generation Failed',
    classes: 'bg-red-100 text-red-800 ring-red-200',
    icon: 'warning',
    tooltip: 'Document generation failed. Review the error and regenerate.',
  },
};

/** Build a detailed tooltip string from warnings or validation findings. */
function buildTooltip(
  baseTooltip: string,
  warnings?: string[],
  validationFindings?: Array<{ name: string; severity: 'error' | 'warning' }>,
): string {
  const parts: string[] = [baseTooltip];

  if (warnings && warnings.length > 0) {
    parts.push('');
    parts.push('Missing data:');
    for (const w of warnings.slice(0, 5)) {
      parts.push(`• ${w}`);
    }
    if (warnings.length > 5) {
      parts.push(`• …and ${warnings.length - 5} more`);
    }
  }

  if (validationFindings && validationFindings.length > 0) {
    parts.push('');
    parts.push('Validation issues:');
    for (const f of validationFindings.slice(0, 5)) {
      const sev = f.severity === 'error' ? '❌' : '⚠️';
      parts.push(`${sev} ${f.name}`);
    }
    if (validationFindings.length > 5) {
      parts.push(`…and ${validationFindings.length - 5} more`);
    }
  }

  return parts.join('\n');
}

export default function DocumentStatusBadge({
  status,
  isStale = false,
  size = 'sm',
  className,
  warnings,
  validationFindings,
}: DocumentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    classes: 'bg-gray-100 text-gray-600 ring-gray-200',
  };

  // Stale draft — override styling with a warning look
  if (isStale && status === 'draft') {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
                'bg-orange-100 text-orange-800 ring-orange-300',
                className,
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              Draft — Data Changed
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Client data was updated after this document was generated. 
            Consider regenerating to reflect the latest information.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Statuses with icons and tooltips (incomplete, needs_review)
  if (config.icon) {
    const IconComponent = config.icon === 'incomplete' ? AlertCircle : Eye;
    const tooltip = buildTooltip(config.tooltip ?? '', warnings, validationFindings);
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
                config.classes,
                className,
              )}
            >
              <IconComponent className="h-3 w-3" />
              {config.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

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

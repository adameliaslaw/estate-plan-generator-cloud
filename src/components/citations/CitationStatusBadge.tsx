import { ShieldCheck, AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CitationResult } from '@/services/citation-verifier-service';

type Size = 'sm' | 'md';

const SIZE_CLASSES: Record<Size, { wrapper: string; icon: string }> = {
  sm: { wrapper: 'px-2 py-0.5 text-[10px]', icon: 'h-2.5 w-2.5' },
  md: { wrapper: 'px-2.5 py-0.5 text-xs',   icon: 'h-3 w-3' },
};

const NOT_FOUND_LABELS: Record<Size, string> = { sm: 'Not found', md: 'Not found' };
const ERROR_LABELS: Record<Size, string> = { sm: 'Check', md: 'Check manually' };

export function CitationStatusBadge({
  status,
  size = 'md',
}: {
  status: CitationResult['status'];
  size?: Size;
}) {
  const s = SIZE_CLASSES[size];
  const common = cn('inline-flex items-center gap-1 rounded-full font-semibold ring-1 shrink-0', s.wrapper);

  if (status === 'verified') {
    return (
      <span className={cn(common, 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>
        <ShieldCheck className={s.icon} /> Verified
      </span>
    );
  }
  if (status === 'not_found') {
    return (
      <span className={cn(common, 'bg-red-50 text-red-700 ring-red-200')}>
        <AlertTriangle className={s.icon} /> {NOT_FOUND_LABELS[size]}
      </span>
    );
  }
  return (
    <span className={cn(common, 'bg-amber-50 text-amber-700 ring-amber-200')}>
      <HelpCircle className={s.icon} /> {ERROR_LABELS[size]}
    </span>
  );
}

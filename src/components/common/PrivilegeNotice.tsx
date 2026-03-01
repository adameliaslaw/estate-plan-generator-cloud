/**
 * PrivilegeNotice.tsx
 *
 * Attorney-client privilege / confidentiality notice banner.
 * Renders as a subtle top-of-page or bottom-of-page notice on all
 * client-facing pages.
 *
 * Usage:
 *   import PrivilegeNotice from '@/components/common/PrivilegeNotice';
 *   <PrivilegeNotice />               // default: top placement
 *   <PrivilegeNotice position="bottom" />
 */

import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrivilegeNoticeProps {
  /** Where to render the banner — 'top' (default) or 'bottom' */
  position?: 'top' | 'bottom';
  /** Additional CSS classes to apply to the outer container */
  className?: string;
}

export default function PrivilegeNotice({
  position = 'top',
  className,
}: PrivilegeNoticeProps) {
  return (
    <div
      role="note"
      aria-label="Confidentiality Notice"
      className={cn(
        // Base layout
        'w-full px-4 py-2',
        // Colors: very light gray background, navy text, top accent border
        'bg-gray-50 text-[#1a365d]',
        position === 'top'
          ? 'border-t-2 border-t-[#1a365d] border-b border-b-gray-200'
          : 'border-t border-t-gray-200 border-b-2 border-b-[#1a365d]',
        // Print: include in printouts
        'print:border-[#1a365d]',
        className,
      )}
    >
      <div className="mx-auto flex max-w-5xl items-start gap-2.5">
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#2b6cb0]"
          aria-hidden="true"
        />
        <p className="text-[11px] leading-snug text-[#1a365d]/80">
          <span className="font-semibold uppercase tracking-wide text-[#1a365d]">
            Confidentiality Notice:
          </span>{' '}
          Information submitted through this portal is intended for use by{' '}
          <span className="font-medium">Elias Counsel, LLC</span> in connection with your legal
          representation. Upon execution of an engagement letter, all communications are protected
          by attorney-client privilege. Do not share your login credentials.
        </p>
      </div>
    </div>
  );
}

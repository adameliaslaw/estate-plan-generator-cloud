/**
 * PaymentsTab.tsx
 *
 * Full billing ledger for a single client matter.
 *
 * Features:
 *   - Summary cards: Total Fees | Total Payments | Outstanding Balance
 *   - Filter bar: All | Paid | Pending | Overdue
 *   - Payment ledger table with status badges and action menu
 *   - "Record Manual Payment" dialog
 *   - "Send Payment Request" dialog (LawPay placeholder)
 *   - Loading skeleton + empty state
 *
 * Data lives at: /firms/{firmId}/clients/{clientId}/payments
 * Amounts are stored in cents; displayed in dollars.
 */

import { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import {
  DollarSign,
  Plus,
  Send,
  MoreHorizontal,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Ban,
  RefreshCcw,
  Circle,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { useCollection, createDoc, deleteDoc } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS } from '@/config/constants';
import { sanitizeInput } from '@/utils/sanitize';
import type { Payment, PaymentMethod, PaymentStatus, AccountDesignation } from '@/types';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentsTabProps {
  firmId: string;
  clientId: string;
  clientEmail?: string;
  clientName?: string;
}

type FilterStatus = 'all' | 'paid' | 'pending' | 'overdue';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: PaymentMethod[] = [
  'Credit Card',
  'Debit Card',
  'ACH / Bank Transfer',
  'Check',
  'Cash',
  'Wire Transfer',
  'Other',
];

const FILTER_TABS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
];

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(
  value: Payment['paidAt'] | Payment['createdAt'] | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  try {
    const date = 'toDate' in value ? value.toDate() : new Date(value as unknown as string);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return fallback;
  }
}

// ── Status badge config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  paid: {
    label: 'Paid',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
  },
  pending: {
    label: 'Pending',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: Clock,
  },
  partial: {
    label: 'Partial',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: Circle,
  },
  overdue: {
    label: 'Overdue',
    className: 'bg-red-50 text-red-700 border-red-200',
    icon: AlertCircle,
  },
  refunded: {
    label: 'Refunded',
    className: 'bg-gray-100 text-gray-500 border-gray-200',
    icon: RefreshCcw,
  },
  voided: {
    label: 'Voided',
    className: 'bg-gray-100 text-gray-400 border-gray-200',
    icon: Ban,
  },
};

function StatusBadge({ status }: { status: PaymentStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const isVoided = status === 'voided';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        cfg.className,
        isVoided && 'line-through',
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── LawPay placeholder ────────────────────────────────────────────────────────

async function sendLawPayRequest(
  firmId: string,
  clientId: string,
  amount: number,
  description: string,
  accountDesignation: AccountDesignation,
): Promise<void> {
  if (import.meta.env.DEV) console.info('[LawPay] sendLawPayRequest called', {
    firmId,
    clientId,
    amount,
    description,
    accountDesignation,
  });
  toast.info(
    'Payment request will be sent via LawPay. Integration pending setup in Settings.',
    { duration: 6000 },
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  amount,
  accent,
}: {
  label: string;
  amount: number;
  accent?: 'amber' | 'green';
}) {
  const bgClass =
    accent === 'amber'
      ? 'bg-amber-50 border-amber-200'
      : accent === 'green'
        ? 'bg-emerald-50 border-emerald-200'
        : 'bg-white border-gray-200';

  const textClass =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'green'
        ? 'text-emerald-700'
        : 'text-[#1a365d]';

  return (
    <Card className={cn('shadow-sm', bgClass)}>
      <CardContent className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        <p className={cn('mt-1 text-2xl font-bold tabular-nums', textClass)}>
          {formatCents(amount)}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function PaymentsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="border-gray-200 shadow-sm">
            <CardContent className="px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="space-y-0 divide-y divide-gray-100">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-7 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Record Manual Payment dialog ──────────────────────────────────────────────

interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  firmId: string;
  clientId: string;
  createdBy: string;
}

function RecordPaymentDialog({
  open,
  onClose,
  firmId,
  clientId,
  createdBy,
}: RecordPaymentDialogProps) {
  const [description, setDescription] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [accountDesignation, setAccountDesignation] = useState<AccountDesignation>('operating');
  const [checkNumber, setCheckNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setDescription('');
    setAmountDollars('');
    setMethod('');
    setAccountDesignation('operating');
    setCheckNumber('');
    setDate(new Date().toISOString().slice(0, 10));
    setNotes('');
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSave() {
    const cleanDescription = sanitizeInput(description.trim());
    const cleanNotes = sanitizeInput(notes.trim());
    const parsedDollars = parseFloat(amountDollars);

    if (!cleanDescription) {
      toast.error('Description is required.');
      return;
    }
    if (isNaN(parsedDollars) || parsedDollars <= 0) {
      toast.error('Please enter a valid amount greater than $0.');
      return;
    }
    if (!method) {
      toast.error('Please select a payment method.');
      return;
    }

    const amountCents = Math.round(parsedDollars * 100);

    setSaving(true);
    try {
      const payload: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'> = {
        firmId,
        clientId,
        description: cleanDescription,
        amount: amountCents,
        amountPaid: amountCents,
        balanceDue: 0,
        paymentMethod: method as PaymentMethod,
        status: 'paid',
        accountDesignation,
        checkNumber: method === 'Check' ? sanitizeInput(checkNumber.trim()) : undefined,
        dueDate: date || undefined,
        notes: cleanNotes || undefined,
        createdBy,
        updatedBy: createdBy,
      };

      // Remove undefined keys to keep Firestore clean
      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );

      await createDoc(COLLECTIONS.PAYMENTS(firmId, clientId), clean);
      toast.success('Payment recorded successfully.');
      handleClose();
    } catch (err) {
      console.error('[RecordPaymentDialog] save error:', err);
      toast.error('Failed to record payment. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#1a365d]">Record Manual Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-description">Description <span className="text-red-500">*</span></Label>
            <Input
              id="rp-description"
              placeholder="e.g. Retainer — Estate Planning Package"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-amount">Amount (USD) <span className="text-red-500">*</span></Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">
                $
              </span>
              <Input
                id="rp-amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                className="pl-7"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
              />
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-method">Payment Method <span className="text-red-500">*</span></Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="rp-method">
                <SelectValue placeholder="Select method…" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Check # — conditional */}
          {method === 'Check' && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-check">Check Number</Label>
              <Input
                id="rp-check"
                placeholder="e.g. 1042"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                maxLength={20}
              />
            </div>
          )}

          {/* Account Designation (IOLTA) */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-account">Account Designation</Label>
            <Select
              value={accountDesignation}
              onValueChange={(v) => setAccountDesignation(v as AccountDesignation)}
            >
              <SelectTrigger id="rp-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">Operating Account</SelectItem>
                <SelectItem value="trust">Trust Account (IOLTA)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              Select Trust Account for client funds held in escrow (IOLTA compliance).
            </p>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-date">Date</Label>
            <Input
              id="rp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="rp-notes">Notes</Label>
            <Textarea
              id="rp-notes"
              placeholder="Optional internal notes…"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#1a365d] text-white hover:bg-[#1e407a]"
          >
            {saving ? 'Saving…' : 'Record Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Send Payment Request dialog ───────────────────────────────────────────────

interface SendRequestDialogProps {
  open: boolean;
  onClose: () => void;
  firmId: string;
  clientId: string;
  clientEmail?: string;
  clientName?: string;
  createdBy: string;
}

function SendRequestDialog({
  open,
  onClose,
  firmId,
  clientId,
  clientName,
  createdBy,
}: SendRequestDialogProps) {
  const [description, setDescription] = useState('');
  const [amountDollars, setAmountDollars] = useState('');
  const [accountDesignation, setAccountDesignation] = useState<AccountDesignation>('operating');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setDescription('');
    setAmountDollars('');
    setAccountDesignation('operating');
    setDueDate('');
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSend() {
    const cleanDescription = sanitizeInput(description.trim());
    const parsedDollars = parseFloat(amountDollars);

    if (!cleanDescription) {
      toast.error('Description is required.');
      return;
    }
    if (isNaN(parsedDollars) || parsedDollars <= 0) {
      toast.error('Please enter a valid amount greater than $0.');
      return;
    }

    const amountCents = Math.round(parsedDollars * 100);

    setSaving(true);
    try {
      const payload: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'> = {
        firmId,
        clientId,
        description: cleanDescription,
        amount: amountCents,
        amountPaid: 0,
        balanceDue: amountCents,
        status: 'pending',
        accountDesignation,
        dueDate: dueDate || undefined,
        createdBy,
        updatedBy: createdBy,
      };

      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );

      await createDoc(COLLECTIONS.PAYMENTS(firmId, clientId), clean);

      // LawPay placeholder
      await sendLawPayRequest(
        firmId,
        clientId,
        amountCents,
        cleanDescription,
        accountDesignation,
      );

      handleClose();
    } catch (err) {
      console.error('[SendRequestDialog] save error:', err);
      toast.error('Failed to create payment request. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#1a365d]">Send Payment Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 pb-1">
          <p className="text-sm text-gray-500">
            {clientName
              ? `Create a payment request for ${clientName}.`
              : 'Create a payment request for this client.'}{' '}
            The request will be sent via LawPay once the integration is configured in Settings.
          </p>
        </div>

        <div className="space-y-4 py-1">
          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="sr-description">Description <span className="text-red-500">*</span></Label>
            <Input
              id="sr-description"
              placeholder="e.g. Estate Plan Balance Due"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="sr-amount">Amount (USD) <span className="text-red-500">*</span></Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">
                $
              </span>
              <Input
                id="sr-amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                className="pl-7"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
              />
            </div>
          </div>

          {/* Account Designation */}
          <div className="space-y-1.5">
            <Label htmlFor="sr-account">Account Designation</Label>
            <Select
              value={accountDesignation}
              onValueChange={(v) => setAccountDesignation(v as AccountDesignation)}
            >
              <SelectTrigger id="sr-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">Operating Account</SelectItem>
                <SelectItem value="trust">Trust Account (IOLTA)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-1.5">
            <Label htmlFor="sr-due">Due Date (optional)</Label>
            <Input
              id="sr-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <Alert className="border-blue-200 bg-blue-50">
          <ExternalLink className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-xs text-blue-800">
            LawPay integration is pending setup. Configure your API keys in{' '}
            <span className="font-semibold">Settings → Billing</span> to activate payment links.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={saving}
            className="bg-[#2b6cb0] text-white hover:bg-[#2563a8]"
          >
            {saving ? 'Creating…' : 'Create Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaymentsTab({
  firmId,
  clientId,
  clientEmail,
  clientName,
}: PaymentsTabProps) {
  const { userProfile } = useAuth();
  const uid = userProfile?.uid ?? '';

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: payments, loading, error } = useCollection<Payment>(
    firmId && clientId ? COLLECTIONS.PAYMENTS(firmId, clientId) : null,
    [orderBy('createdAt', 'desc')],
  );

  // ── Computed totals ─────────────────────────────────────────────────────────
  const { totalFees, totalPaid, outstanding } = useMemo(() => {
    const totalFees = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const totalPaid = payments.reduce((sum, p) => sum + (p.amountPaid ?? 0), 0);
    return { totalFees, totalPaid, outstanding: totalFees - totalPaid };
  }, [payments]);

  // ── Filtered rows ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filterStatus === 'all') return payments;
    return payments.filter((p) => p.status === filterStatus);
  }, [payments, filterStatus]);

  // ── Delete handler ──────────────────────────────────────────────────────────
  async function handleDelete(payment: Payment & { id: string }) {
    setDeletingId(payment.id);
    try {
      await deleteDoc(`${COLLECTIONS.PAYMENTS(firmId, clientId)}/${payment.id}`);
      toast.success('Payment record deleted.');
    } catch (err) {
      console.error('[PaymentsTab] delete error:', err);
      toast.error('Failed to delete payment. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) return <PaymentsSkeleton />;

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800">
          Failed to load payments: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total Fees" amount={totalFees} />
        <SummaryCard label="Total Payments" amount={totalPaid} />
        <SummaryCard
          label="Outstanding Balance"
          amount={outstanding}
          accent={outstanding > 0 ? 'amber' : 'green'}
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                filterStatus === tab.value
                  ? 'bg-white text-[#1a365d] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {tab.label}
              {tab.value !== 'all' && (
                <span className="ml-1.5 text-xs text-gray-400">
                  ({payments.filter((p) => p.status === tab.value).length})
                </span>
              )}
              {tab.value === 'all' && (
                <span className="ml-1.5 text-xs text-gray-400">({payments.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
            onClick={() => setShowRequestDialog(true)}
          >
            <Send className="h-4 w-4" />
            Send Payment Request
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-[#1a365d] text-white hover:bg-[#1e407a]"
            onClick={() => setShowRecordDialog(true)}
          >
            <Plus className="h-4 w-4" />
            Record Payment
          </Button>
        </div>
      </div>

      {/* ── Ledger table ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ebf4ff]">
              <DollarSign className="h-7 w-7 text-[#2b6cb0]" />
            </div>
            <h3 className="text-base font-semibold text-[#1a365d]">
              {filterStatus === 'all'
                ? 'No payments recorded yet'
                : `No ${filterStatus} payments`}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              {filterStatus === 'all'
                ? 'Record a payment or send a payment request to get started.'
                : `No payments with status "${filterStatus}" found. Try switching the filter above.`}
            </p>
            {filterStatus === 'all' && (
              <div className="mt-5 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
                  onClick={() => setShowRequestDialog(true)}
                >
                  <Send className="h-4 w-4" />
                  Send Request
                </Button>
                <Button
                  size="sm"
                  className="gap-2 bg-[#1a365d] text-white hover:bg-[#1e407a]"
                  onClick={() => setShowRecordDialog(true)}
                >
                  <Plus className="h-4 w-4" />
                  Record Payment
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* Table */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Method
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Account
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    LawPay Ref #
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((payment) => {
                  const isDeleting = deletingId === payment.id;
                  return (
                    <tr
                      key={payment.id}
                      className={cn(
                        'transition-colors hover:bg-gray-50/60',
                        isDeleting && 'opacity-50',
                      )}
                    >
                      {/* Date */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">
                        {payment.paidAt
                          ? formatDate(payment.paidAt)
                          : payment.dueDate
                            ? new Date(payment.dueDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : formatDate(payment.createdAt)}
                      </td>

                      {/* Description */}
                      <td className="px-4 py-3.5">
                        <span className="font-medium text-[#1a365d]">{payment.description}</span>
                        {payment.invoiceNumber && (
                          <span className="ml-2 text-xs text-gray-400">
                            #{payment.invoiceNumber}
                          </span>
                        )}
                        {payment.checkNumber && (
                          <span className="ml-2 text-xs text-gray-400">
                            Chk #{payment.checkNumber}
                          </span>
                        )}
                        {payment.notes && (
                          <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">
                            {payment.notes}
                          </p>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        <span className="font-semibold text-[#1a365d]">
                          {formatCents(payment.amount)}
                        </span>
                        {payment.amountPaid > 0 && payment.amountPaid < payment.amount && (
                          <div className="text-xs text-gray-400">
                            Paid: {formatCents(payment.amountPaid)}
                          </div>
                        )}
                        {payment.balanceDue > 0 && (
                          <div className="text-xs text-amber-600">
                            Due: {formatCents(payment.balanceDue)}
                          </div>
                        )}
                      </td>

                      {/* Method */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-600">
                        {payment.paymentMethod ?? <span className="text-gray-300">—</span>}
                      </td>

                      {/* Account */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            payment.accountDesignation === 'trust'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-gray-100 text-gray-600',
                          )}
                        >
                          {payment.accountDesignation === 'trust' ? 'Trust' : 'Operating'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <StatusBadge status={payment.status} />
                      </td>

                      {/* LawPay Ref # */}
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-gray-500">
                        {payment.lawPayTransactionId ?? payment.lawPayChargeId ?? (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-gray-400 hover:text-gray-700"
                              disabled={isDeleting}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {payment.lawPayPaymentUrl && (
                              <>
                                <DropdownMenuItem asChild>
                                  <a
                                    href={payment.lawPayPaymentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Open LawPay Link
                                  </a>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            {payment.receiptUrl && (
                              <>
                                <DropdownMenuItem asChild>
                                  <a
                                    href={payment.receiptUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    View Receipt
                                  </a>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              className="flex items-center gap-2 text-red-600 focus:bg-red-50 focus:text-red-700"
                              onClick={() => handleDelete(payment)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete Record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer totals row */}
            {filtered.length > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-end gap-8 px-4 py-3 text-sm">
                  <span className="text-gray-500">
                    Showing {filtered.length} of {payments.length} record
                    {payments.length !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Total Fees</p>
                      <p className="font-semibold text-[#1a365d]">{formatCents(totalFees)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Paid</p>
                      <p className="font-semibold text-emerald-700">{formatCents(totalPaid)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Balance</p>
                      <p
                        className={cn(
                          'font-bold',
                          outstanding > 0 ? 'text-amber-700' : 'text-emerald-700',
                        )}
                      >
                        {formatCents(outstanding)}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <RecordPaymentDialog
        open={showRecordDialog}
        onClose={() => setShowRecordDialog(false)}
        firmId={firmId}
        clientId={clientId}
        createdBy={uid}
      />
      <SendRequestDialog
        open={showRequestDialog}
        onClose={() => setShowRequestDialog(false)}
        firmId={firmId}
        clientId={clientId}
        clientEmail={clientEmail}
        clientName={clientName}
        createdBy={uid}
      />
    </div>
  );
}

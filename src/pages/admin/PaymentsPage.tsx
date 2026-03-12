/**
 * PaymentsPage.tsx
 *
 * Full-page cross-client payments monitoring view.
 * Linked from the sidebar navigation under "Calendar".
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    DollarSign,
    CheckCircle2,
    Clock,
    AlertTriangle,
    Search,
    Send,
    Plus,
    Trash2,
} from 'lucide-react';
import { where, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { useCollectionGroup, useCollection } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS } from '@/config/constants';
import { cn } from '@/lib/utils';
import { functions } from '@/config/firebase';
import { sanitizeInput } from '@/utils/sanitize';
import { logSystemActivity } from '@/utils/activity-logger';
import type { Payment, Client, PaymentMethod } from '@/types';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { createDoc, deleteDoc } from '@/hooks/useFirestore';

// ── Cloud Function call ─────────────────────────────────────────────────────

const callCreatePaymentRequest = httpsCallable<
    {
        firmId: string;
        clientId: string;
        amount: number;
        description: string;
        accountDesignation: 'operating';
        clientEmail: string;
        clientName: string;
    },
    { paymentUrl: string; paymentDocId: string }
>(functions, 'createPaymentRequest');

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(cents / 100);
}

function formatDate(
    value: { toDate?: () => Date } | Date | string | undefined | null,
    fallback = '—',
): string {
    if (!value) return fallback;
    let d: Date;
    if (typeof value === 'string') {
        d = new Date(value);
    } else if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
        d = (value as { toDate: () => Date }).toDate();
    } else {
        d = value as Date;
    }
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

type FilterTab = 'all' | 'paid' | 'pending' | 'overdue';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    paid: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Paid' },
    pending: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
    overdue: { bg: 'bg-red-50', text: 'text-red-700', label: 'Overdue' },
    refunded: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Refunded' },
    voided: { bg: 'bg-gray-100', text: 'text-gray-400', label: 'Voided' },
};

// ── Send Payment Request Dialog ──────────────────────────────────────────────

function SendPaymentDialog({
    open,
    onClose,
    firmId,
    clients,
}: {
    open: boolean;
    onClose: () => void;
    firmId: string;
    clients: (Client & { id: string })[];
}) {
    const { userProfile } = useAuth();
    const [selectedClientId, setSelectedClientId] = useState('');
    const [description, setDescription] = useState('');
    const [amountDollars, setAmountDollars] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [saving, setSaving] = useState(false);
    const [resultUrl, setResultUrl] = useState<string | null>(null);

    function resetForm() {
        setSelectedClientId('');
        setDescription('');
        setAmountDollars('');
        setDueDate('');
        setResultUrl(null);
    }

    function handleClose() {
        resetForm();
        onClose();
    }

    const selectedClient = clients.find((c) => c.id === selectedClientId);

    const clientDisplayName = (c: Client & { id: string }) => {
        const pi = c.personalInfo;
        return pi
            ? `${pi.firstName ?? ''} ${pi.lastName ?? ''}`.trim() || c.id
            : c.id;
    };

    const clientEmail = selectedClient?.personalInfo?.email ?? '';

    async function handleSend() {
        const cleanDescription = sanitizeInput(description.trim());
        const parsedDollars = parseFloat(amountDollars);

        if (!selectedClientId) {
            toast.error('Please select a client.');
            return;
        }
        if (!cleanDescription) {
            toast.error('Description is required.');
            return;
        }
        if (isNaN(parsedDollars) || parsedDollars <= 0) {
            toast.error('Please enter a valid amount greater than $0.');
            return;
        }

        const amountCents = Math.round(parsedDollars * 100);
        const cName = selectedClient ? clientDisplayName(selectedClient) : '';

        setSaving(true);
        try {
            const result = await callCreatePaymentRequest({
                firmId,
                clientId: selectedClientId,
                amount: amountCents,
                description: cleanDescription,
                accountDesignation: 'operating',
                clientEmail,
                clientName: cName,
            });

            const { paymentUrl } = result.data;
            setResultUrl(paymentUrl);

            try { await navigator.clipboard.writeText(paymentUrl); } catch { /* ignore */ }
            toast.success('Payment request created! Link copied to clipboard.', { duration: 6000 });

            await logSystemActivity(firmId, userProfile, 'sending payment request', {
                clientName: cName,
                paymentAmount: `$${amountDollars}`,
            });
        } catch (err) {
            console.error('[SendPaymentDialog] error:', err);
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
                    <DialogDescription className="text-sm text-gray-500">
                        Create a LawPay payment link for a client.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* Client Selector */}
                    <div className="space-y-1.5">
                        <Label htmlFor="sp-client">Client <span className="text-red-500">*</span></Label>
                        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                            <SelectTrigger id="sp-client">
                                <SelectValue placeholder="Select a client…" />
                            </SelectTrigger>
                            <SelectContent>
                                {clients.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {clientDisplayName(c)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <Label htmlFor="sp-desc">Description <span className="text-red-500">*</span></Label>
                        <Input
                            id="sp-desc"
                            placeholder="e.g. Estate Plan Balance Due"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={200}
                        />
                    </div>

                    {/* Amount */}
                    <div className="space-y-1.5">
                        <Label htmlFor="sp-amount">Amount (USD) <span className="text-red-500">*</span></Label>
                        <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">$</span>
                            <Input
                                id="sp-amount"
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



                    {/* Due Date */}
                    <div className="space-y-1.5">
                        <Label htmlFor="sp-due">Due Date (optional)</Label>
                        <Input
                            id="sp-due"
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                        />
                    </div>
                </div>

                {resultUrl ? (
                    <Alert className="border-emerald-200 bg-emerald-50">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-xs text-emerald-800">
                            Payment link created!{' '}
                            <a
                                href={resultUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold underline"
                            >
                                Open payment page
                            </a>
                            {' '}(link also copied to clipboard)
                        </AlertDescription>
                    </Alert>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSend}
                        disabled={saving || !!resultUrl}
                        className="bg-[#2b6cb0] text-white hover:bg-[#2563a8]"
                    >
                        {saving ? 'Creating…' : 'Create Request'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Record Manual Payment Dialog ─────────────────────────────────────────────

const PAYMENT_METHODS: PaymentMethod[] = ['Credit Card', 'Debit Card', 'Check', 'Cash', 'ACH / Bank Transfer', 'Wire Transfer', 'Other'];

function RecordPaymentDialog({
    open,
    onClose,
    firmId,
    clients,
}: {
    open: boolean;
    onClose: () => void;
    firmId: string;
    clients: (Client & { id: string })[];
}) {
    const { userProfile } = useAuth();
    const [selectedClientId, setSelectedClientId] = useState('');
    const [description, setDescription] = useState('');
    const [amountDollars, setAmountDollars] = useState('');
    const [method, setMethod] = useState<PaymentMethod | ''>('');
    const [checkNumber, setCheckNumber] = useState('');
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    function resetForm() {
        setSelectedClientId('');
        setDescription('');
        setAmountDollars('');
        setMethod('');
        setCheckNumber('');
        setDate(new Date().toISOString().slice(0, 10));
        setNotes('');
    }

    function handleClose() {
        resetForm();
        onClose();
    }

    const clientDisplayName = (c: Client & { id: string }) => {
        const pi = c.personalInfo;
        return pi
            ? `${pi.firstName ?? ''} ${pi.lastName ?? ''}`.trim() || c.id
            : c.id;
    };

    async function handleSave() {
        const cleanDescription = sanitizeInput(description.trim());
        const cleanNotes = sanitizeInput(notes.trim());
        const parsedDollars = parseFloat(amountDollars);

        if (!selectedClientId) {
            toast.error('Please select a client.');
            return;
        }
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
        const cName = clients.find(c => c.id === selectedClientId) ? clientDisplayName(clients.find(c => c.id === selectedClientId)!) : '';

        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                firmId,
                clientId: selectedClientId,
                description: cleanDescription,
                amount: amountCents,
                amountPaid: amountCents,
                balanceDue: 0,
                paymentMethod: method,
                status: 'paid',
                accountDesignation: 'operating',
                checkNumber: method === 'Check' ? sanitizeInput(checkNumber.trim()) : undefined,
                dueDate: date || '',
                notes: cleanNotes || '',
                createdBy: userProfile?.uid ?? '',
                updatedBy: userProfile?.uid ?? '',
            };

            const clean = Object.fromEntries(
                Object.entries(payload).filter(([, v]) => v !== undefined),
            );

            await createDoc(`firms/${firmId}/clients/${selectedClientId}/payments`, clean);

            await logSystemActivity(firmId, userProfile, 'logging payment', {
                clientName: cName,
                paymentAmount: `$${amountDollars}`,
            });

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
                    <DialogDescription className="text-sm text-gray-500">
                        Record a payment that has already been received.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    {/* Client Selector */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rp2-client">Client <span className="text-red-500">*</span></Label>
                        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                            <SelectTrigger id="rp2-client">
                                <SelectValue placeholder="Select a client…" />
                            </SelectTrigger>
                            <SelectContent>
                                {clients.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {clientDisplayName(c)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rp2-description">Description <span className="text-red-500">*</span></Label>
                        <Input
                            id="rp2-description"
                            placeholder="e.g. Retainer — Estate Planning Package"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={200}
                        />
                    </div>

                    {/* Amount */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rp2-amount">Amount (USD) <span className="text-red-500">*</span></Label>
                        <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">$</span>
                            <Input
                                id="rp2-amount"
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
                        <Label htmlFor="rp2-method">Payment Method <span className="text-red-500">*</span></Label>
                        <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                            <SelectTrigger id="rp2-method">
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
                            <Label htmlFor="rp2-check">Check Number</Label>
                            <Input
                                id="rp2-check"
                                placeholder="e.g. 1042"
                                value={checkNumber}
                                onChange={(e) => setCheckNumber(e.target.value)}
                                maxLength={20}
                            />
                        </div>
                    )}

                    {/* Date */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rp2-date">Date</Label>
                        <Input
                            id="rp2-date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5">
                        <Label htmlFor="rp2-notes">Notes</Label>
                        <Textarea
                            id="rp2-notes"
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

// ── Component ────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
    const { userProfile } = useAuth();
    const navigate = useNavigate();
    const firmId = userProfile?.firmId ?? '';

    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSendDialog, setShowSendDialog] = useState(false);
    const [showRecordDialog, setShowRecordDialog] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDeletePayment, setConfirmDeletePayment] = useState<(Payment & { id: string }) | null>(null);

    // Fetch all clients for name lookup
    const { data: allClients } = useCollection<Client>(
        firmId ? COLLECTIONS.CLIENTS(firmId) : null,
        useMemo(() => [orderBy('createdAt', 'desc'), limit(200)], []),
    );

    // Collection-group query: all payments for this firm
    const { data: allPayments, loading } = useCollectionGroup<Payment>(
        firmId ? 'payments' : null,
        useMemo(
            () => [
                where('firmId', '==', firmId),
                orderBy('createdAt', 'desc'),
                limit(500),
            ],
            [firmId],
        ),
    );

    // Build clientId → name lookup
    const clientNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of allClients) {
            const pi = c.personalInfo;
            const name = pi
                ? `${pi.lastName ?? ''}${pi.firstName ? ', ' + pi.firstName : ''}`.trim()
                : c.id;
            map.set(c.id, name || c.id);
        }
        return map;
    }, [allClients]);

    // Compute summaries
    const { totalReceived, totalOutstanding, totalFees, paidCount, pendingCount, overdueCount } =
        useMemo(() => {
            let received = 0;
            let outstanding = 0;
            let fees = 0;
            let paid = 0;
            let pending = 0;
            let overdue = 0;

            for (const p of allPayments) {
                fees += p.amount || 0;
                if (p.status === 'paid') {
                    received += p.amountPaid || p.amount || 0;
                    paid++;
                } else if (p.status === 'overdue') {
                    outstanding += p.balanceDue || p.amount || 0;
                    overdue++;
                } else if (p.status === 'pending') {
                    outstanding += p.balanceDue || p.amount || 0;
                    pending++;
                }
            }
            return { totalReceived: received, totalOutstanding: outstanding, totalFees: fees, paidCount: paid, pendingCount: pending, overdueCount: overdue };
        }, [allPayments]);

    // Filter by tab + search
    const filteredPayments = useMemo(() => {
        let list = allPayments;
        if (activeTab !== 'all') {
            list = list.filter((p) => p.status === activeTab);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter((p) => {
                const clientName = (clientNameMap.get(p.clientId) ?? '').toLowerCase();
                const desc = (p.description ?? '').toLowerCase();
                return clientName.includes(q) || desc.includes(q);
            });
        }
        return list;
    }, [allPayments, activeTab, searchQuery, clientNameMap]);

    // Delete handler
    async function handleDeletePayment(payment: Payment & { id: string }) {
        setDeletingId(payment.id);
        try {
            await deleteDoc(`firms/${firmId}/clients/${payment.clientId}/payments/${payment.id}`);
            toast.success('Payment record deleted.');
        } catch (err) {
            console.error('[PaymentsPage] delete error:', err);
            toast.error('Failed to delete payment.');
        } finally {
            setDeletingId(null);
            setConfirmDeletePayment(null);
        }
    }

    const tabs: { key: FilterTab; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: allPayments.length },
        { key: 'paid', label: 'Paid', count: paidCount },
        { key: 'pending', label: 'Pending', count: pendingCount },
        { key: 'overdue', label: 'Overdue', count: overdueCount },
    ];

    return (
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[#1a365d]">Payments</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Monitor all payments received and outstanding across clients
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setShowRecordDialog(true)}
                        className="border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#2b6cb0]/5"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Record Payment
                    </Button>
                    <Button
                        onClick={() => setShowSendDialog(true)}
                        className="bg-[#2b6cb0] text-white hover:bg-[#2563a8]"
                    >
                        <Send className="mr-2 h-4 w-4" />
                        Send Payment Request
                    </Button>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                        <DollarSign className="h-4 w-4" />
                        Total Fees
                    </div>
                    <p className="mt-2 text-2xl font-bold text-[#1a365d]">
                        {formatCents(totalFees)}
                    </p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                        Total Received
                    </div>
                    <p className="mt-2 text-2xl font-bold text-emerald-700">
                        {formatCents(totalReceived)}
                    </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                        <Clock className="h-4 w-4" />
                        Outstanding
                    </div>
                    <p className="mt-2 text-2xl font-bold text-amber-700">
                        {formatCents(totalOutstanding)}
                    </p>
                </div>
            </div>

            {/* Payment history table */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                {/* Table header with filters */}
                <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-base font-semibold text-[#1a365d]">Payment History</h3>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="search"
                                placeholder="Search payments…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-9 w-48 rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]/30"
                            />
                        </div>
                    </div>
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1 border-b border-gray-100 px-5">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={cn(
                                'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                                activeTab === t.key
                                    ? 'border-[#2b6cb0] text-[#1a365d]'
                                    : 'border-transparent text-gray-500 hover:text-gray-700',
                            )}
                        >
                            {t.label}
                            <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                                {t.count}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Table */}
                {loading ? (
                    <div className="space-y-3 p-5">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
                        ))}
                    </div>
                ) : filteredPayments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <DollarSign className="h-10 w-10 text-gray-300" />
                        <p className="text-sm text-gray-400">
                            {searchQuery ? 'No payments match your search' : 'No payments found'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100">
                            <thead>
                                <tr className="bg-gray-50/60">
                                    {['Client', 'Description', 'Amount', 'Status', 'Date', ''].map((col) => (
                                        <th
                                            key={col || 'actions'}
                                            className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                                        >
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredPayments.map((p) => {
                                    const style = STATUS_STYLES[p.status] ?? STATUS_STYLES.pending;
                                    const clientName = clientNameMap.get(p.clientId) ?? 'Unknown Client';

                                    return (
                                        <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="whitespace-nowrap px-5 py-3.5 text-sm font-medium text-gray-900">
                                                <button
                                                    onClick={() => navigate(`/clients/${p.clientId}`)}
                                                    className="text-[#2b6cb0] hover:underline font-medium text-left"
                                                >
                                                    {clientName}
                                                </button>
                                            </td>
                                            <td className="px-5 py-3.5 text-sm text-gray-600">
                                                {p.description || '—'}
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3.5 text-sm font-semibold text-gray-900">
                                                {formatCents(p.amount)}
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3.5">
                                                <span
                                                    className={cn(
                                                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                                                        style.bg,
                                                        style.text,
                                                    )}
                                                >
                                                    {p.status === 'paid' ? (
                                                        <CheckCircle2 className="h-3 w-3" />
                                                    ) : p.status === 'overdue' ? (
                                                        <AlertTriangle className="h-3 w-3" />
                                                    ) : (
                                                        <Clock className="h-3 w-3" />
                                                    )}
                                                    {style.label}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3.5 text-sm text-gray-500">
                                                {formatDate(p.paidAt ?? p.createdAt)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-3.5 text-right">
                                                <button
                                                    onClick={() => setConfirmDeletePayment(p)}
                                                    disabled={deletingId === p.id}
                                                    className="rounded-md p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                    title="Delete payment"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Send Payment Dialog */}
            <SendPaymentDialog
                open={showSendDialog}
                onClose={() => setShowSendDialog(false)}
                firmId={firmId}
                clients={allClients as (Client & { id: string })[]}
            />

            {/* Record Payment Dialog */}
            <RecordPaymentDialog
                open={showRecordDialog}
                onClose={() => setShowRecordDialog(false)}
                firmId={firmId}
                clients={allClients as (Client & { id: string })[]}
            />

            {/* Confirm Delete Dialog */}
            <Dialog open={!!confirmDeletePayment} onOpenChange={(v) => !v && setConfirmDeletePayment(null)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-red-600">Delete Payment Record</DialogTitle>
                        <DialogDescription className="text-sm text-gray-500">
                            Are you sure you want to delete this payment record
                            {confirmDeletePayment ? ` for ${formatCents(confirmDeletePayment.amount)}` : ''}?
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDeletePayment(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!!deletingId}
                            onClick={() => confirmDeletePayment && handleDeletePayment(confirmDeletePayment)}
                        >
                            {deletingId ? 'Deleting…' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

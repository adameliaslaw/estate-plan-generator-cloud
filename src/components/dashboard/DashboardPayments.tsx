/**
 * DashboardPayments.tsx
 *
 * Cross-client payments monitoring panel for the main dashboard.
 * Uses a collection group query on "payments" filtered by firmId.
 *
 * Features:
 *  - Summary: Total Received / Total Outstanding
 *  - Status filter tabs: All | Paid | Pending | Overdue
 *  - Scrollable payment history log with client name lookup
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    DollarSign,
    CheckCircle2,
    Clock,
    AlertTriangle,
} from 'lucide-react';
import { where, orderBy, limit } from 'firebase/firestore';

import { useCollectionGroup } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Payment, Client } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(cents / 100);
}

// The figure to show on a row so it reconciles with the summary cards:
// paid rows count toward "Received" via amountPaid; pending/overdue rows count
// toward "Outstanding" via balanceDue. For fully-paid / not-yet-paid records
// these equal `amount`, so only partially-paid records change.
function statusAmountCents(p: Payment): number {
    if (p.status === 'paid') return p.amountPaid || p.amount || 0;
    if (p.status === 'pending' || p.status === 'overdue') return p.balanceDue || p.amount || 0;
    return p.amount || 0;
}

// Cap on the cross-client collection-group query. If the firm ever exceeds it,
// the summary totals would silently undercount, so we surface a note instead.
const RECENT_PAYMENTS_LIMIT = 200;

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

// ── Props ────────────────────────────────────────────────────────────────────

interface DashboardPaymentsProps {
    clients?: (Client & { id: string })[];
}

// ── Component ────────────────────────────────────────────────────────────────

export function DashboardPayments({ clients = [] }: DashboardPaymentsProps) {
    const navigate = useNavigate();
    const { userProfile } = useAuth();
    const firmId = userProfile?.firmId ?? '';

    const [activeTab, setActiveTab] = useState<FilterTab>('all');

    // Collection-group query: all payments for this firm
    const { data: allPayments, loading } = useCollectionGroup<Payment>(
        firmId ? 'payments' : null,
        useMemo(
            () => [
                where('firmId', '==', firmId),
                orderBy('createdAt', 'desc'),
                limit(RECENT_PAYMENTS_LIMIT),
            ],
            [firmId],
        ),
    );

    const totalsCapped = allPayments.length >= RECENT_PAYMENTS_LIMIT;

    // Build clientId → name lookup
    const clientNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of clients) {
            const pi = c.personalInfo;
            const name = pi
                ? `${pi.lastName ?? ''}${pi.firstName ? ', ' + pi.firstName : ''}`.trim()
                : c.id;
            map.set(c.id, name || c.id);
        }
        return map;
    }, [clients]);

    // Compute summaries
    const { totalReceived, totalOutstanding, paidCount, pendingCount, overdueCount } =
        useMemo(() => {
            let received = 0;
            let outstanding = 0;
            let paid = 0;
            let pending = 0;
            let overdue = 0;

            for (const p of allPayments) {
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
            return { totalReceived: received, totalOutstanding: outstanding, paidCount: paid, pendingCount: pending, overdueCount: overdue };
        }, [allPayments]);

    // Filter
    const filteredPayments = useMemo(() => {
        if (activeTab === 'all') return allPayments;
        return allPayments.filter((p) => p.status === activeTab);
    }, [allPayments, activeTab]);

    const tabs: { key: FilterTab; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: allPayments.length },
        { key: 'paid', label: 'Paid', count: paidCount },
        { key: 'pending', label: 'Pending', count: pendingCount },
        { key: 'overdue', label: 'Overdue', count: overdueCount },
    ];

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="space-y-4 p-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
                ))}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 px-4 pt-4 pb-3">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Received
                    </div>
                    <p className="mt-1 text-lg font-bold text-emerald-700">
                        {formatCents(totalReceived)}
                    </p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-amber-600">
                        <Clock className="h-3.5 w-3.5" />
                        Outstanding
                    </div>
                    <p className="mt-1 text-lg font-bold text-amber-700">
                        {formatCents(totalOutstanding)}
                    </p>
                </div>
            </div>

            {totalsCapped && (
                <p className="px-4 pb-2 text-xs text-amber-600">
                    Showing the most recent {RECENT_PAYMENTS_LIMIT} payments — totals may exclude older records.
                </p>
            )}

            {/* Filter tabs */}
            <div className="flex gap-1 border-b border-gray-100 px-4 pb-0">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={cn(
                            'px-3 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2',
                            activeTab === t.key
                                ? 'border-[#2b6cb0] text-[#1a365d] bg-blue-50/40'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                        )}
                    >
                        {t.label}
                        <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                            {t.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Payment history log */}
            <div className="flex-1 overflow-y-auto">
                {filteredPayments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <DollarSign className="h-8 w-8 text-gray-300" />
                        <p className="text-sm text-gray-400">No payments found</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {filteredPayments.map((p) => {
                            const style = STATUS_STYLES[p.status] ?? STATUS_STYLES.pending;
                            const clientName = clientNameMap.get(p.clientId) ?? 'Unknown Client';

                            return (
                                <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                                    <div
                                        className={cn(
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                                            p.status === 'paid' ? 'bg-emerald-100' : p.status === 'overdue' ? 'bg-red-100' : 'bg-amber-100',
                                        )}
                                    >
                                        {p.status === 'paid' ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                        ) : p.status === 'overdue' ? (
                                            <AlertTriangle className="h-4 w-4 text-red-600" />
                                        ) : (
                                            <Clock className="h-4 w-4 text-amber-600" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); navigate(`/clients/${p.clientId}`); }}
                                                className="truncate text-sm font-medium text-[#2b6cb0] hover:underline text-left"
                                            >
                                                {clientName}
                                            </button>
                                            <span className="shrink-0 text-sm font-semibold text-gray-900">
                                                {formatCents(statusAmountCents(p))}
                                            </span>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                                            <span>{p.description || 'Payment'}</span>
                                            <span className="text-gray-300">•</span>
                                            <span>{formatDate(p.paidAt ?? p.createdAt)}</span>
                                            <span
                                                className={cn(
                                                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                                    style.bg,
                                                    style.text,
                                                )}
                                            >
                                                {style.label}
                                            </span>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

/**
 * RecordPaymentDialog.tsx â€” extracted from PaymentsPage.tsx
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/useAuth';
import { sanitizeInput } from '@/utils/sanitize';
import { logSystemActivity } from '@/utils/activity-logger';
import type { Client, PaymentMethod } from '@/types';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createDoc } from '@/hooks/useFirestore';

const PAYMENT_METHODS: PaymentMethod[] = ['Credit Card', 'Debit Card', 'Check', 'Cash', 'ACH / Bank Transfer', 'Wire Transfer', 'Other'];

export function RecordPaymentDialog({
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
                clientId: selectedClientId,
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
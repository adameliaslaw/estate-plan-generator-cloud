/**
 * RecordPaymentDialog.tsx — extracted from PaymentsPage.tsx
 */

import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/useAuth';
import { sanitizeInput } from '@/utils/sanitize';
import { logSystemActivity } from '@/utils/activity-logger';
import type { Client, PaymentMethod } from '@/types';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createDoc } from '@/hooks/useFirestore';

const PAYMENT_METHODS: PaymentMethod[] = ['Credit Card', 'Debit Card', 'Check', 'Cash', 'ACH / Bank Transfer', 'Wire Transfer', 'Other'];

const recordPaymentSchema = z.object({
    selectedClientId: z.string().min(1, 'Please select a client.'),
    description: z.string().trim().min(1, 'Description is required.'),
    amountDollars: z.string().refine(
        (v) => { const n = parseFloat(v); return !Number.isNaN(n) && n > 0; },
        'Please enter a valid amount greater than $0.',
    ),
    method: z.string().min(1, 'Please select a payment method.'),
    checkNumber: z.string().optional(),
    date: z.string(),
    notes: z.string().optional(),
});

type RecordFormValues = z.infer<typeof recordPaymentSchema>;

export function RecordPaymentDialog({
    open,
    onClose,
    firmId,
    clients,
    clientId,
    clientName,
}: {
    open: boolean;
    onClose: () => void;
    firmId: string;
    // Selector mode (PaymentsPage): pass `clients`. Fixed-client mode
    // (PaymentsTab): pass `clientId` (+ `clientName` for the activity log) and
    // the client selector is hidden.
    clients?: (Client & { id: string })[];
    clientId?: string;
    clientName?: string;
}) {
    const { userProfile } = useAuth();

    const {
        register,
        handleSubmit,
        control,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<RecordFormValues>({
        resolver: zodResolver(recordPaymentSchema),
        defaultValues: {
            selectedClientId: clientId ?? '',
            description: '',
            amountDollars: '',
            method: '',
            checkNumber: '',
            date: new Date().toISOString().slice(0, 10),
            notes: '',
        },
    });

    function handleClose() {
        reset();
        onClose();
    }

    const clientDisplayName = (c: Client & { id: string }) => {
        const pi = c.personalInfo;
        return pi
            ? `${pi.firstName ?? ''} ${pi.lastName ?? ''}`.trim() || c.id
            : c.id;
    };

    const selectedMethod = useWatch({ control, name: 'method' });

    async function onSubmit(values: RecordFormValues) {
        const cleanDescription = sanitizeInput(values.description.trim());
        const cleanNotes = sanitizeInput((values.notes ?? '').trim());
        const amountCents = Math.round(parseFloat(values.amountDollars) * 100);
        const selected = clients?.find((c) => c.id === values.selectedClientId);
        const cName = selected ? clientDisplayName(selected) : (clientName ?? '');

        try {
            const payload: Record<string, unknown> = {
                firmId,
                clientId: values.selectedClientId,
                description: cleanDescription,
                amount: amountCents,
                amountPaid: amountCents,
                balanceDue: 0,
                paymentMethod: values.method,
                status: 'paid',
                accountDesignation: 'operating',
                checkNumber: values.method === 'Check' ? sanitizeInput((values.checkNumber ?? '').trim()) : undefined,
                dueDate: values.date || '',
                notes: cleanNotes || '',
                createdBy: userProfile?.uid ?? '',
                updatedBy: userProfile?.uid ?? '',
            };

            const clean = Object.fromEntries(
                Object.entries(payload).filter(([, v]) => v !== undefined),
            );

            await createDoc(`firms/${firmId}/clients/${values.selectedClientId}/payments`, clean);

            await logSystemActivity(firmId, userProfile, 'logging payment', {
                clientId: values.selectedClientId,
                clientName: cName,
                paymentAmount: `$${values.amountDollars}`,
            });

            toast.success('Payment recorded successfully.');
            handleClose();
        } catch (err) {
            console.error('[RecordPaymentDialog] save error:', err);
            toast.error('Failed to record payment. Please try again.');
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

                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="space-y-4 py-1">
                        {/* Client Selector — only in selector mode */}
                        {clients && (
                            <div className="space-y-1.5">
                                <Label htmlFor="rp2-client">Client <span className="text-red-500">*</span></Label>
                                <Controller
                                    control={control}
                                    name="selectedClientId"
                                    render={({ field }) => (
                                        <Combobox
                                            id="rp2-client"
                                            placeholder="Select a client…"
                                            emptyText="No matching client."
                                            value={field.value}
                                            onChange={field.onChange}
                                            aria-invalid={!!errors.selectedClientId}
                                            options={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
                                        />
                                    )}
                                />
                                {errors.selectedClientId && <p className="text-xs text-red-500">{errors.selectedClientId.message}</p>}
                            </div>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label htmlFor="rp2-description">Description <span className="text-red-500">*</span></Label>
                            <Input
                                id="rp2-description"
                                placeholder="e.g. Retainer — Estate Planning Package"
                                maxLength={200}
                                {...register('description')}
                            />
                            {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
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
                                    {...register('amountDollars')}
                                />
                            </div>
                            {errors.amountDollars && <p className="text-xs text-red-500">{errors.amountDollars.message}</p>}
                        </div>

                        {/* Payment Method */}
                        <div className="space-y-1.5">
                            <Label htmlFor="rp2-method">Payment Method <span className="text-red-500">*</span></Label>
                            <Controller
                                control={control}
                                name="method"
                                render={({ field }) => (
                                    <Select value={field.value} onValueChange={field.onChange}>
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
                                )}
                            />
                            {errors.method && <p className="text-xs text-red-500">{errors.method.message}</p>}
                        </div>

                        {/* Check # — conditional */}
                        {selectedMethod === 'Check' && (
                            <div className="space-y-1.5">
                                <Label htmlFor="rp2-check">Check Number</Label>
                                <Input
                                    id="rp2-check"
                                    placeholder="e.g. 1042"
                                    maxLength={20}
                                    {...register('checkNumber')}
                                />
                            </div>
                        )}

                        {/* Date */}
                        <div className="space-y-1.5">
                            <Label htmlFor="rp2-date">Date</Label>
                            <Input
                                id="rp2-date"
                                type="date"
                                {...register('date')}
                            />
                        </div>

                        {/* Notes */}
                        <div className="space-y-1.5">
                            <Label htmlFor="rp2-notes">Notes</Label>
                            <Textarea
                                id="rp2-notes"
                                placeholder="Optional internal notes…"
                                rows={3}
                                maxLength={1000}
                                {...register('notes')}
                            />
                        </div>
                    </div>

                    <DialogFooter className="mt-4">
                        <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            className="bg-[#1a365d] text-white hover:bg-[#1e407a]"
                        >
                            {isSubmitting ? 'Saving…' : 'Record Payment'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

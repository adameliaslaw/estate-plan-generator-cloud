/**
 * SendPaymentDialog.tsx — extracted from PaymentsPage.tsx
 */

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/useAuth';
import { functions } from '@/config/firebase';
import { sanitizeInput } from '@/utils/sanitize';
import { logSystemActivity } from '@/utils/activity-logger';
import type { Client } from '@/types';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { useCreateClientRedirect } from '@/hooks/useCreateClientRedirect';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

const sendPaymentSchema = z.object({
    selectedClientId: z.string().min(1, 'Please select a client.'),
    description: z.string().trim().min(1, 'Description is required.'),
    amountDollars: z.string().refine(
        (v) => { const n = parseFloat(v); return !Number.isNaN(n) && n > 0; },
        'Please enter a valid amount greater than $0.',
    ),
    dueDate: z.string().optional(),
});

type SendFormValues = z.infer<typeof sendPaymentSchema>;

export function SendPaymentDialog({
    open,
    onClose,
    firmId,
    clients,
    clientId,
    clientName,
    clientEmail,
}: {
    open: boolean;
    onClose: () => void;
    firmId: string;
    // Selector mode (PaymentsPage): pass `clients`. Fixed-client mode
    // (PaymentsTab): pass `clientId` (+ `clientName`/`clientEmail`) and the
    // client selector is hidden.
    clients?: (Client & { id: string })[];
    clientId?: string;
    clientName?: string;
    clientEmail?: string;
}) {
    const { userProfile } = useAuth();
    const [resultUrl, setResultUrl] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        control,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<SendFormValues>({
        resolver: zodResolver(sendPaymentSchema),
        defaultValues: { selectedClientId: clientId ?? '', description: '', amountDollars: '', dueDate: '' },
    });

    function handleClose() {
        reset();
        setResultUrl(null);
        onClose();
    }

    const clientDisplayName = (c: Client & { id: string }) => {
        const pi = c.personalInfo;
        return pi
            ? `${pi.firstName ?? ''} ${pi.lastName ?? ''}`.trim() || c.id
            : c.id;
    };

    const handleCreateClient = useCreateClientRedirect();

    async function onSubmit(values: SendFormValues) {
        const cleanDescription = sanitizeInput(values.description.trim());
        const amountCents = Math.round(parseFloat(values.amountDollars) * 100);
        const selectedClient = clients?.find((c) => c.id === values.selectedClientId);
        const cName = selectedClient ? clientDisplayName(selectedClient) : (clientName ?? '');
        const email = selectedClient?.personalInfo?.email ?? clientEmail ?? '';

        try {
            const result = await callCreatePaymentRequest({
                firmId,
                clientId: values.selectedClientId,
                amount: amountCents,
                description: cleanDescription,
                accountDesignation: 'operating',
                clientEmail: email,
                clientName: cName,
            });

            const { paymentUrl } = result.data;
            setResultUrl(paymentUrl);

            try { await navigator.clipboard.writeText(paymentUrl); } catch { /* ignore */ }
            toast.success('Payment request created! Link copied to clipboard.', { duration: 6000 });

            await logSystemActivity(firmId, userProfile, 'sending payment request', {
                clientId: values.selectedClientId,
                clientName: cName,
                paymentAmount: `$${values.amountDollars}`,
            });
        } catch (err) {
            console.error('[SendPaymentDialog] error:', err);
            toast.error('Failed to create payment request. Please try again.');
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

                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="space-y-4 py-1">
                        {/* Client Selector — only in selector mode */}
                        {clients && (
                            <div className="space-y-1.5">
                                <Label htmlFor="sp-client">Client <span className="text-red-500">*</span></Label>
                                <Controller
                                    control={control}
                                    name="selectedClientId"
                                    render={({ field }) => (
                                        <Combobox
                                            id="sp-client"
                                            placeholder="Select a client…"
                                            emptyText="No matching client."
                                            value={field.value}
                                            onChange={field.onChange}
                                            aria-invalid={!!errors.selectedClientId}
                                            options={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
                                            onCreate={handleCreateClient}
                                            createLabel={(name) => `Create client "${name}"`}
                                        />
                                    )}
                                />
                                {errors.selectedClientId && <p className="text-xs text-red-500">{errors.selectedClientId.message}</p>}
                            </div>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label htmlFor="sp-desc">Description <span className="text-red-500">*</span></Label>
                            <Input
                                id="sp-desc"
                                placeholder="e.g. Estate Plan Balance Due"
                                maxLength={200}
                                {...register('description')}
                            />
                            {errors.description && <p className="text-xs text-red-500">{errors.description.message}</p>}
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
                                    {...register('amountDollars')}
                                />
                            </div>
                            {errors.amountDollars && <p className="text-xs text-red-500">{errors.amountDollars.message}</p>}
                        </div>

                        {/* Due Date */}
                        <div className="space-y-1.5">
                            <Label htmlFor="sp-due">Due Date (optional)</Label>
                            <Input
                                id="sp-due"
                                type="date"
                                {...register('dueDate')}
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

                    <DialogFooter className="mt-4">
                        <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting || !!resultUrl}
                            className="bg-[#2b6cb0] text-white hover:bg-[#2563a8]"
                        >
                            {isSubmitting ? 'Creating…' : 'Create Request'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/**
 * SendPaymentDialog.tsx â€” extracted from PaymentsPage.tsx
 */

import { useState } from 'react';
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
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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

export function SendPaymentDialog({
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
                clientId: selectedClientId,
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
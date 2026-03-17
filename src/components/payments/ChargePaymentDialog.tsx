/**
 * ChargePaymentDialog.tsx
 *
 * Dialog to process a direct payment charge via AffiniPay Hosted Fields.
 * Uses the AffiniPay Hosted Fields JavaScript SDK to securely collect
 * card or bank details, tokenize them client-side, then calls the
 * processDirectCharge Cloud Function to execute the charge.
 *
 * PCI SAQ-A compliant: sensitive payment data never touches our servers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Building2,
  Loader2,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

import { functions } from '@/config/firebase';
import { sanitizeInput } from '@/utils/sanitize';
import type { Client } from '@/types';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChargeResult {
  success: boolean;
  chargeId?: string;
  status?: string;
  paymentDocId?: string;
  errorMessage?: string;
}

/** Global AffiniPay Hosted Fields SDK type declarations */
interface HostedFieldState {
  isReady: boolean;
  isValid: boolean;
  isFocused: boolean;
  isEmpty: boolean;
  cardType?: string;
}

interface HostedFieldsInstance {
  getPaymentToken: (formData: Record<string, string>) => Promise<{ id: string }>;
  getState: () => Record<string, HostedFieldState>;
}

interface HostedFieldConfig {
  publicKey: string;
  input: {
    el: string;
    type: string;
    css?: Record<string, string>;
  }[];
}

declare global {
  interface Window {
    AffiniPay?: {
      HostedFields: {
        initializeFields: (
          config: HostedFieldConfig,
          callback: (state: Record<string, HostedFieldState>) => void,
        ) => HostedFieldsInstance;
        getState: () => Record<string, HostedFieldState>;
      };
    };
  }
}

// ---------------------------------------------------------------------------
// Cloud Function callable
// ---------------------------------------------------------------------------

const callProcessDirectCharge = httpsCallable<
  {
    firmId: string;
    clientId: string;
    amount: number;
    description: string;
    paymentToken: string;
    paymentType: 'card' | 'echeck';
    clientEmail?: string;
    clientName?: string;
  },
  ChargeResult
>(functions, 'processDirectCharge');

// ---------------------------------------------------------------------------
// SDK script loader
// ---------------------------------------------------------------------------

const HOSTED_FIELDS_SDK_URL =
  'https://cdn.affinipay.com/hostedfields/1.5.3/fieldGen_1.5.3.js';

let sdkLoadPromise: Promise<void> | null = null;

function loadHostedFieldsSdk(): Promise<void> {
  if (window.AffiniPay?.HostedFields) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${HOSTED_FIELDS_SDK_URL}"]`,
    );
    if (existing) {
      // Script tag exists but SDK not ready yet — wait for load
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load AffiniPay SDK')),
      );
      return;
    }

    const script = document.createElement('script');
    script.src = HOSTED_FIELDS_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load AffiniPay SDK'));
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

// ---------------------------------------------------------------------------
// Hosted field CSS shared by all iframes
// ---------------------------------------------------------------------------

const HOSTED_FIELD_CSS: Record<string, string> = {
  'font-size': '14px',
  'font-family': 'Inter, system-ui, sans-serif',
  color: '#1a365d',
  padding: '8px 12px',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChargePaymentDialog({
  open,
  onClose,
  firmId,
  lawPayPublicKey,
  // Client selection mode — either a single client (profile) or many (dashboard)
  clientId: fixedClientId,
  clientEmail: fixedClientEmail,
  clientName: fixedClientName,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  firmId: string;
  lawPayPublicKey: string;
  clientId?: string;
  clientEmail?: string;
  clientName?: string;
  clients?: Client[];
}) {
  // Form state
  const [selectedClientId, setSelectedClientId] = useState(fixedClientId ?? '');
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [paymentType, setPaymentType] = useState<'card' | 'echeck'>('card');

  // SDK / processing state
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // References
  const hostedFieldsRef = useRef<HostedFieldsInstance | null>(null);
  const initAttempted = useRef(false);

  // Resolve client info
  const effectiveClientId = fixedClientId ?? selectedClientId;
  const selectedClient = clients?.find((c) => c.id === effectiveClientId);
  const effectiveClientEmail =
    fixedClientEmail ?? selectedClient?.personalInfo?.email ?? '';
  const effectiveClientName =
    fixedClientName ??
    (selectedClient
      ? `${selectedClient.personalInfo?.firstName ?? ''} ${selectedClient.personalInfo?.lastName ?? ''}`.trim()
      : '');

  // ── Initialize Hosted Fields SDK ──────────────────────────────────────

  const initializeHostedFields = useCallback(async () => {
    if (!lawPayPublicKey || !open) return;

    setSdkError(null);
    setSdkReady(false);

    try {
      await loadHostedFieldsSdk();

      if (!window.AffiniPay?.HostedFields) {
        throw new Error('AffiniPay SDK loaded but HostedFields not available');
      }

      // Wait a tick for the DOM elements to be rendered
      await new Promise((r) => setTimeout(r, 100));

      const cardConfig: HostedFieldConfig = {
        publicKey: lawPayPublicKey,
        input: [
          {
            el: '#af-card-number',
            type: 'card_number',
            css: HOSTED_FIELD_CSS,
          },
          {
            el: '#af-card-exp',
            type: 'expiration',
            css: HOSTED_FIELD_CSS,
          },
          {
            el: '#af-card-cvv',
            type: 'cvv',
            css: HOSTED_FIELD_CSS,
          },
        ],
      };

      const bankConfig: HostedFieldConfig = {
        publicKey: lawPayPublicKey,
        input: [
          {
            el: '#af-routing-number',
            type: 'routing_number',
            css: HOSTED_FIELD_CSS,
          },
          {
            el: '#af-account-number',
            type: 'account_number',
            css: HOSTED_FIELD_CSS,
          },
        ],
      };

      const config = paymentType === 'card' ? cardConfig : bankConfig;

      hostedFieldsRef.current =
        window.AffiniPay.HostedFields.initializeFields(config, () => {
          setSdkReady(true);
        });
    } catch (err) {
      console.error('[ChargePaymentDialog] SDK init error:', err);
      setSdkError(
        err instanceof Error ? err.message : 'Failed to load payment form',
      );
    }
  }, [lawPayPublicKey, open, paymentType]);

  useEffect(() => {
    if (!open) {
      initAttempted.current = false;
      return;
    }

    // Small delay to let the dialog DOM render before initializing iframes
    const timer = setTimeout(() => {
      if (!initAttempted.current) {
        initAttempted.current = true;
        initializeHostedFields();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [open, initializeHostedFields]);

  // Re-initialize when payment type changes
  useEffect(() => {
    if (open && initAttempted.current) {
      initAttempted.current = false;
      // Short delay so the new DOM containers render
      const timer = setTimeout(() => {
        initAttempted.current = true;
        initializeHostedFields();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [paymentType, open, initializeHostedFields]);

  // ── Reset on close ────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setDescription('');
    setAmountStr('');
    setPaymentType('card');
    setSelectedClientId(fixedClientId ?? '');
    setShowSuccess(false);
    setSdkReady(false);
    setSdkError(null);
    initAttempted.current = false;
    hostedFieldsRef.current = null;
    onClose();
  }, [fixedClientId, onClose]);

  // ── Submit handler ────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!hostedFieldsRef.current) {
      toast.error('Payment form not ready yet. Please wait.');
      return;
    }

    // Validate
    if (!effectiveClientId) {
      toast.error('Please select a client.');
      return;
    }
    if (!description.trim()) {
      toast.error('Please enter a description.');
      return;
    }
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast.error('Please enter a valid amount.');
      return;
    }

    setProcessing(true);

    try {
      // Step 1: Get the one-time payment token from Hosted Fields
      const tokenResult = await hostedFieldsRef.current.getPaymentToken({
        name: effectiveClientName || 'Client',
      });

      if (!tokenResult?.id) {
        throw new Error(
          'Could not generate payment token. Please check the card/bank details.',
        );
      }

      console.log(
        '[ChargePaymentDialog] Got payment token, calling processDirectCharge…',
      );

      // Step 2: Call the Cloud Function to process the charge
      const result = await callProcessDirectCharge({
        firmId,
        clientId: effectiveClientId,
        amount: amountCents,
        description: sanitizeInput(description.trim()),
        paymentToken: tokenResult.id,
        paymentType,
        clientEmail: effectiveClientEmail,
        clientName: effectiveClientName,
      });

      const chargeResult = result.data;

      if (chargeResult.success) {
        toast.success('Payment processed successfully!');
        setShowSuccess(true);
      } else {
        toast.error(
          chargeResult.errorMessage ??
            'Payment was declined. Please check the details and try again.',
        );
      }
    } catch (err: unknown) {
      console.error('[ChargePaymentDialog] Charge error:', err);
      const message =
        err instanceof Error ? err.message : 'Failed to process payment.';
      toast.error(message);
    } finally {
      setProcessing(false);
    }
  }, [
    effectiveClientId,
    effectiveClientEmail,
    effectiveClientName,
    description,
    amountStr,
    firmId,
    paymentType,
  ]);

  // ── Render ────────────────────────────────────────────────────────────

  // No public key configured
  if (!lawPayPublicKey) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#1a365d]">
              Charge Payment
            </DialogTitle>
            <DialogDescription>
              Process a payment using the client&apos;s card or bank details.
            </DialogDescription>
          </DialogHeader>
          <Alert className="border-red-200 bg-red-50 text-red-800 my-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>LawPay Public Key not configured.</strong> Go to Settings
              → Integrations → LawPay and add your public key to enable direct
              payments.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Success state
  if (showSuccess) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center py-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-[#1a365d]">
              Payment Processed!
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              ${(parseFloat(amountStr) || 0).toFixed(2)} was charged
              successfully to {effectiveClientName || 'the client'}.
            </p>
            <Button className="mt-6" onClick={handleClose}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#1a365d]">Charge Payment</DialogTitle>
          <DialogDescription>
            Securely process a payment using the client&apos;s card or bank
            details. Payment information is handled by AffiniPay and never
            stored on our servers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Client selector (dashboard mode) */}
          {!fixedClientId && clients && clients.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-[#1a365d]">
                Client
              </Label>
              <Select
                value={selectedClientId}
                onValueChange={setSelectedClientId}
              >
                <SelectTrigger id="charge-client-select">
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.personalInfo?.firstName} {c.personalInfo?.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1a365d]">
              Description
            </Label>
            <Input
              id="charge-description"
              placeholder="e.g. Estate Plan — Phase 1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1a365d]">
              Amount ($)
            </Label>
            <Input
              id="charge-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
          </div>

          {/* Payment type toggle */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1a365d]">
              Payment Method
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentType('card')}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all ${
                  paymentType === 'card'
                    ? 'border-[#2b6cb0] bg-[#ebf4ff] text-[#1a365d]'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                Credit Card
              </button>
              <button
                type="button"
                onClick={() => setPaymentType('echeck')}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all ${
                  paymentType === 'echeck'
                    ? 'border-[#2b6cb0] bg-[#ebf4ff] text-[#1a365d]'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <Building2 className="h-4 w-4" />
                eCheck / ACH
              </button>
            </div>
          </div>

          {/* SDK error */}
          {sdkError && (
            <Alert className="border-red-200 bg-red-50 text-red-800">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{sdkError}</AlertDescription>
            </Alert>
          )}

          {/* Hosted Fields containers */}
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
              {paymentType === 'card'
                ? 'Card Details'
                : 'Bank Account Details'}
            </p>

            {paymentType === 'card' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">Card Number</Label>
                  <div
                    id="af-card-number"
                    className="h-10 rounded-md border border-gray-300 bg-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Expiration</Label>
                    <div
                      id="af-card-exp"
                      className="h-10 rounded-md border border-gray-300 bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">CVV</Label>
                    <div
                      id="af-card-cvv"
                      className="h-10 rounded-md border border-gray-300 bg-white"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">
                    Routing Number
                  </Label>
                  <div
                    id="af-routing-number"
                    className="h-10 rounded-md border border-gray-300 bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">
                    Account Number
                  </Label>
                  <div
                    id="af-account-number"
                    className="h-10 rounded-md border border-gray-300 bg-white"
                  />
                </div>
              </>
            )}

            {!sdkReady && !sdkError && (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading secure payment form…
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={processing}>
            Cancel
          </Button>
          <Button
            className="bg-[#2b6cb0] hover:bg-[#1a365d]"
            onClick={handleSubmit}
            disabled={
              processing ||
              !sdkReady ||
              !effectiveClientId ||
              !description.trim() ||
              !amountStr
            }
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Charge $
                {(parseFloat(amountStr) || 0).toFixed(2)}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

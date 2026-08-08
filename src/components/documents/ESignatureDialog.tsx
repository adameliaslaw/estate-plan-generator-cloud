import { useEffect, useState } from 'react';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { Mail, Send, Loader2, AlertCircle, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { documentService } from '@/services/document-service';

export interface ESignatureDialogProps {
    open: boolean;
    onClose: () => void;
    firmId: string;
    clientId: string;
    documentId: string;
    documentName: string;
}

export default function ESignatureDialog({
    open,
    onClose,
    firmId,
    clientId,
    documentId,
    documentName,
}: ESignatureDialogProps) {
    const [signerName, setSignerName] = useState('');
    const [signerEmail, setSignerEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [testMode, setTestMode] = useState(false);
    // #174: whether the NEXT send will be a test-mode (watermarked,
    // non-binding) request. Mirrors the server's default in esign-service.ts —
    // dropboxSignTestMode !== false — so the attorney learns this BEFORE
    // sending, not from the post-send notice. null while loading; a failed
    // read defaults to true, because assuming "binding" on no evidence is the
    // harmful direction.
    const [preSendTestMode, setPreSendTestMode] = useState<boolean | null>(null);

    useEffect(() => {
        if (!open || !firmId) return;
        let cancelled = false;
        getDoc(doc(getFirestore(), `firms/${firmId}`))
            .then((snap) => {
                if (cancelled) return;
                const data = snap.data() ?? {};
                setPreSendTestMode((data as { dropboxSignTestMode?: unknown }).dropboxSignTestMode !== false);
            })
            .catch(() => {
                if (!cancelled) setPreSendTestMode(true);
            });
        return () => {
            cancelled = true;
        };
    }, [open, firmId]);

    const handleSend = async () => {
        if (!signerName.trim() || !signerEmail.trim()) {
            setError('Name and email are required');
            return;
        }
        // Validate email format before hitting the Cloud Function.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim())) {
            setError('Please enter a valid email address');
            return;
        }

        setSending(true);
        setError('');

        try {
            const res = await documentService.sendForSignature({
                firmId,
                clientId,
                documentId,
                signerName: signerName.trim(),
                signerEmail: signerEmail.trim(),
            });
            // Only claim success if the provider actually accepted the request
            // (returns success + a real signatureRequestId).
            if (res?.success && res.signatureRequestId) {
                setTestMode(Boolean(res.testMode));
                setSuccess(true);
            } else {
                setError('The e-signature request could not be sent. Please try again.');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to send document for e-signature');
        } finally {
            setSending(false);
        }
    };

    const handleClose = () => {
        setTimeout(() => {
            setSignerName('');
            setSignerEmail('');
            setError('');
            setSuccess(false);
            setTestMode(false);
        }, 200);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => (!o && handleClose())}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                        <Mail className="h-5 w-5" />
                        Send for E-Signature
                    </DialogTitle>
                    <DialogDescription>
                        Send <strong>{documentName}</strong> directly to the client for electronic signature via Hellosign/DocuSign.
                    </DialogDescription>
                </DialogHeader>

                {success ? (
                    <div className="py-6 text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                            <Send className="h-6 w-6 text-green-600" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">Sent Successfully</h3>
                        <p className="mt-2 text-sm text-gray-500">
                            The signature request has been emailed to {signerEmail}.
                        </p>
                        {testMode && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                Test mode: this is a watermarked, non-binding request. Turn off
                                test mode in Settings → Integrations for legally binding signatures.
                            </p>
                        )}
                        <Button className="mt-6 w-full bg-[#2b6cb0] hover:bg-[#1a365d]" onClick={handleClose}>
                            Done
                        </Button>
                    </div>
                ) : (
                    <div className="grid gap-4 py-4">
                        {preSendTestMode === true && (
                            <Alert className="border-amber-200 bg-amber-50">
                                <FlaskConical className="h-4 w-4 text-amber-600" />
                                <AlertDescription className="text-sm text-amber-800">
                                    <strong>TEST MODE</strong> — this request will be watermarked and
                                    non-binding. Turn off test mode in Settings → Integrations for
                                    legally binding signatures.
                                </AlertDescription>
                            </Alert>
                        )}
                        {error && (
                            <Alert className="border-red-200 bg-red-50">
                                <AlertCircle className="h-4 w-4 text-red-600" />
                                <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
                            </Alert>
                        )}

                        <div className="grid gap-2">
                            <Label htmlFor="name">Signer Name</Label>
                            <Input
                                id="name"
                                value={signerName}
                                onChange={(e) => setSignerName(e.target.value)}
                                placeholder="e.g. John Doe"
                                disabled={sending}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="email">Signer Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={signerEmail}
                                onChange={(e) => setSignerEmail(e.target.value)}
                                placeholder="e.g. john.doe@example.com"
                                disabled={sending}
                            />
                        </div>
                    </div>
                )}

                {!success && (
                    <DialogFooter>
                        <Button variant="outline" onClick={handleClose} disabled={sending}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSend}
                            disabled={sending || !signerName.trim() || !signerEmail.trim()}
                            className="bg-[#2b6cb0] hover:bg-[#1a365d]"
                        >
                            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Send Signature Request
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

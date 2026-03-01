/**
 * SettingsPage — Tabbed firm settings for the NJ Estate Plan Generator.
 *
 * Tabs:
 *   1. Firm Profile   — name, address, contact info, bar number
 *   2. Branding       — logo upload, primary/accent color pickers, live preview
 *   3. Integrations   — OpenAI, LawPay, SendGrid, Google Calendar
 *   4. Security       — session timeout, require MFA, MFA enrollment, data retention
 *   5. Email Templates — questionnaire invitation, payment request, appointment confirmation
 *
 * Data source: Firestore `firms/{firmId}` document via useDocument.
 * Writes: updateDoc helper from useFirestore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Key,
  Lock,
  Mail,
  Palette,
  RefreshCw,
  Save,
  Shield,
  Unplug,
  Upload,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { storage } from '@/config/firebase';
import { COLLECTIONS, FIRM_DEFAULTS } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { updateDoc, useDocument } from '@/hooks/useFirestore';
import { cn } from '@/lib/utils';
import { sanitizeInput } from '@/utils/sanitize';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ---------------------------------------------------------------------------
// Firebase MFA imports — TOTP
// TODO: Uncomment and implement when Firebase Blaze plan is active.
// import { multiFactor, TotpMultiFactorGenerator, TotpSecret } from 'firebase/auth';
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal type — FirmSettings
// ---------------------------------------------------------------------------

interface FirmSettings {
  // Branding
  firmName: string;
  firmAddress: string;
  firmCity: string;
  firmState: string;
  firmZip: string;
  firmPhone: string;
  firmEmail: string;
  firmWebsite: string;
  barNumber: string;
  logoUrl?: string;
  primaryColor: string;
  accentColor: string;

  // API Integrations
  openAiApiKey?: string;
  lawPayApiKey?: string;
  lawPayMerchantId?: string;
  sendGridApiKey?: string;

  // Google Calendar OAuth
  googleCalendar?: {
    connected: boolean;
    email?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
  };

  // Email Templates
  emailTemplates?: {
    questionnaireInvitation?: string;
    paymentRequest?: string;
    appointmentConfirmation?: string;
  };

  // Security
  sessionTimeoutMinutes: number;
  requireMfa: boolean;
  dataRetentionYears: number;

  updatedAt?: unknown;
  updatedBy?: string;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'firm' | 'branding' | 'integrations' | 'security' | 'templates';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'firm', label: 'Firm Profile', icon: <Building2 className="h-4 w-4" /> },
  { id: 'branding', label: 'Branding', icon: <Palette className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Zap className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'templates', label: 'Email Templates', icon: <Mail className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Default email templates
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES = {
  questionnaireInvitation: `Dear {{clientName}},

We're excited to begin your estate planning journey with {{firmName}}.

Please complete your questionnaire using the link below — it should take about 20 minutes:
{{link}}

If you have any questions, don't hesitate to reach out.

Warm regards,
{{firmName}}`,

  paymentRequest: `Dear {{clientName}},

Your estate plan is ready! Please complete your payment of {{amount}} to receive your final documents.

Pay securely here: {{link}}

Thank you for choosing {{firmName}}.

Best regards,
{{firmName}}`,

  appointmentConfirmation: `Dear {{clientName}},

Your appointment with {{firmName}} has been confirmed for {{date}}.

Please reply to this email if you need to reschedule.

We look forward to meeting with you.

Best regards,
{{firmName}}`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive initial tab from window.location.pathname. */
function getInitialTab(): TabId {
  const path = window.location.pathname;
  if (path.includes('/settings/firm')) return 'firm';
  if (path.includes('/settings/users')) return 'firm'; // route → firm tab
  if (path.includes('/settings/billing')) return 'integrations';
  return 'firm';
}

/** Mask an API key showing only the last 4 characters. */
function maskApiKey(key: string | undefined): string {
  if (!key || key.length < 4) return '';
  return `••••••••${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Skeleton placeholder while loading firm data. */
function PageSkeleton() {
  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="hidden w-48 shrink-0 space-y-2 lg:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Masked API key field with eye-toggle. */
function ApiKeyField({
  label,
  storedKey,
  pendingKey,
  onPendingChange,
  onSave,
  saving,
  description,
}: {
  label: string;
  storedKey: string | undefined;
  pendingKey: string;
  onPendingChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  description?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const hasStored = Boolean(storedKey);

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-[#1a365d]">{label}</Label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={revealed ? 'text' : 'password'}
            placeholder={hasStored ? maskApiKey(storedKey) : 'Enter API key…'}
            value={pendingKey}
            onChange={(e) => onPendingChange(e.target.value)}
            className="pr-10 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !pendingKey.trim()}
          className="bg-[#2b6cb0] hover:bg-[#1a365d]"
        >
          {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Update'}
        </Button>
      </div>
      {hasStored && (
        <p className="text-xs text-gray-400">
          Current key: <span className="font-mono">{maskApiKey(storedKey)}</span>
        </p>
      )}
    </div>
  );
}

/** Integration status badge. */
function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="border-gray-300 text-gray-500">
      <XCircle className="mr-1 h-3 w-3" />
      Not configured
    </Badge>
  );
}

/** Color picker row: hex input + color swatch. */
function ColorPickerRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-gray-200 shadow-sm"
        style={{ backgroundColor: value }}
        title="Click to pick color"
        onClick={() => document.getElementById(`cp-${label}`)?.click()}
      />
      <input
        id={`cp-${label}`}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
      <div className="flex-1">
        <Label className="text-xs text-gray-500">{label}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="mt-1 h-8 font-mono text-sm"
          maxLength={7}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const firmPath = firmId ? `${COLLECTIONS.FIRMS}/${firmId}` : null;
  const { data: firmDoc, loading } = useDocument<FirmSettings>(firmPath);

  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);

  // ── Tab 1: Firm Profile ──────────────────────────────────────────────────
  const [firmProfile, setFirmProfile] = useState({
    firmName: '',
    firmAddress: '',
    firmCity: '',
    firmState: '',
    firmZip: '',
    firmPhone: '',
    firmEmail: '',
    firmWebsite: '',
    barNumber: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Tab 2: Branding ──────────────────────────────────────────────────────
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [primaryColor, setPrimaryColor] = useState<string>(FIRM_DEFAULTS.primaryColor);
  const [accentColor, setAccentColor] = useState<string>(FIRM_DEFAULTS.accentColor);
  const [savingBranding, setSavingBranding] = useState(false);
  const logoDropRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Tab 3: Integrations ──────────────────────────────────────────────────
  const [openAiKey, setOpenAiKey] = useState('');
  const [lawPayKey, setLawPayKey] = useState('');
  const [lawPayMerchantId, setLawPayMerchantId] = useState('');
  const [sendGridKey, setSendGridKey] = useState('');
  const [savingOpenAi, setSavingOpenAi] = useState(false);
  const [savingLawPay, setSavingLawPay] = useState(false);
  const [savingSendGrid, setSavingSendGrid] = useState(false);
  const [testingLawPay, setTestingLawPay] = useState(false);
  const [testingSendGrid, setTestingSendGrid] = useState(false);

  // ── Tab 4: Security ──────────────────────────────────────────────────────
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const [requireMfa, setRequireMfa] = useState(false);
  const [dataRetention, setDataRetention] = useState(7);
  const [savingSecurity, setSavingSecurity] = useState(false);
  // MFA enrollment state
  const [mfaStep, setMfaStep] = useState<'idle' | 'qr' | 'verify'>('idle');
  const [totpUri, setTotpUri] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [enrollingMfa, setEnrollingMfa] = useState(false);

  // ── Tab 5: Email Templates ───────────────────────────────────────────────
  const [templates, setTemplates] = useState({
    questionnaireInvitation: DEFAULT_TEMPLATES.questionnaireInvitation,
    paymentRequest: DEFAULT_TEMPLATES.paymentRequest,
    appointmentConfirmation: DEFAULT_TEMPLATES.appointmentConfirmation,
  });
  const [savingTemplates, setSavingTemplates] = useState(false);

  // ── Populate state from Firestore ────────────────────────────────────────

  useEffect(() => {
    if (!firmDoc) return;

    setFirmProfile({
      firmName: firmDoc.firmName ?? FIRM_DEFAULTS.firmName,
      firmAddress: firmDoc.firmAddress ?? '',
      firmCity: firmDoc.firmCity ?? '',
      firmState: firmDoc.firmState ?? '',
      firmZip: firmDoc.firmZip ?? '',
      firmPhone: firmDoc.firmPhone ?? FIRM_DEFAULTS.firmPhone,
      firmEmail: firmDoc.firmEmail ?? FIRM_DEFAULTS.firmEmail,
      firmWebsite: firmDoc.firmWebsite ?? FIRM_DEFAULTS.firmWebsite,
      barNumber: firmDoc.barNumber ?? FIRM_DEFAULTS.barNumber,
    });

    if (firmDoc.logoUrl) setLogoPreview(firmDoc.logoUrl);
    setPrimaryColor(firmDoc.primaryColor ?? FIRM_DEFAULTS.primaryColor);
    setAccentColor(firmDoc.accentColor ?? FIRM_DEFAULTS.accentColor);

    setSessionTimeout(firmDoc.sessionTimeoutMinutes ?? 30);
    setRequireMfa(firmDoc.requireMfa ?? false);
    setDataRetention(firmDoc.dataRetentionYears ?? 7);

    if (firmDoc.emailTemplates) {
      setTemplates({
        questionnaireInvitation:
          firmDoc.emailTemplates.questionnaireInvitation ??
          DEFAULT_TEMPLATES.questionnaireInvitation,
        paymentRequest:
          firmDoc.emailTemplates.paymentRequest ?? DEFAULT_TEMPLATES.paymentRequest,
        appointmentConfirmation:
          firmDoc.emailTemplates.appointmentConfirmation ??
          DEFAULT_TEMPLATES.appointmentConfirmation,
      });
    }
  }, [firmDoc]);

  // ── Save helpers ─────────────────────────────────────────────────────────

  const firmDocPath = firmPath ?? '';

  const handleSaveProfile = useCallback(async () => {
    if (!firmDocPath) return;
    setSavingProfile(true);
    try {
      await updateDoc(firmDocPath, {
        firmName: sanitizeInput(firmProfile.firmName),
        firmAddress: sanitizeInput(firmProfile.firmAddress),
        firmCity: sanitizeInput(firmProfile.firmCity),
        firmState: sanitizeInput(firmProfile.firmState),
        firmZip: sanitizeInput(firmProfile.firmZip),
        firmPhone: sanitizeInput(firmProfile.firmPhone),
        firmEmail: sanitizeInput(firmProfile.firmEmail),
        firmWebsite: sanitizeInput(firmProfile.firmWebsite),
        barNumber: sanitizeInput(firmProfile.barNumber),
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Firm profile saved.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save firm profile.');
    } finally {
      setSavingProfile(false);
    }
  }, [firmDocPath, firmProfile, userProfile]);

  const handleLogoSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo must be under 5 MB.');
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleLogoDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleLogoSelect(file);
    },
    [handleLogoSelect],
  );

  const handleSaveBranding = useCallback(async () => {
    if (!firmDocPath) return;
    setSavingBranding(true);
    try {
      let logoUrl = firmDoc?.logoUrl;

      if (logoFile) {
        setUploadingLogo(true);
        const storageRef = ref(storage, `firms/${firmId}/logo`);
        const snapshot = await uploadBytes(storageRef, logoFile);
        logoUrl = await getDownloadURL(snapshot.ref);
        setUploadingLogo(false);
        setLogoFile(null);
      }

      await updateDoc(firmDocPath, {
        primaryColor,
        accentColor,
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Branding saved.');
    } catch (err) {
      console.error(err);
      setUploadingLogo(false);
      toast.error('Failed to save branding.');
    } finally {
      setSavingBranding(false);
    }
  }, [firmDocPath, firmId, firmDoc, logoFile, primaryColor, accentColor, userProfile]);

  const handleSaveApiKey = useCallback(
    async (
      field: keyof Pick<
        FirmSettings,
        'openAiApiKey' | 'lawPayApiKey' | 'sendGridApiKey' | 'lawPayMerchantId'
      >,
      value: string,
      setLoading: (v: boolean) => void,
      clearField: () => void,
    ) => {
      if (!firmDocPath || !value.trim()) return;
      setLoading(true);
      try {
        await updateDoc(firmDocPath, {
          [field]: value.trim(),
          updatedBy: userProfile?.uid ?? '',
        });
        clearField();
        toast.success('API key updated.');
      } catch (err) {
        console.error(err);
        toast.error('Failed to update API key.');
      } finally {
        setLoading(false);
      }
    },
    [firmDocPath, userProfile],
  );

  const handleTestConnection = useCallback(
    async (service: string, setTesting: (v: boolean) => void) => {
      setTesting(true);
      await new Promise((r) => setTimeout(r, 800));
      setTesting(false);
      toast.info(
        `${service} connection test is a placeholder. Configure credentials and verify in your dashboard.`,
      );
    },
    [],
  );

  const handleSaveLawPay = useCallback(async () => {
    if (!firmDocPath) return;
    setSavingLawPay(true);
    try {
      const updates: Partial<FirmSettings> = { updatedBy: userProfile?.uid ?? '' };
      if (lawPayKey.trim()) updates.lawPayApiKey = lawPayKey.trim();
      if (lawPayMerchantId.trim()) updates.lawPayMerchantId = lawPayMerchantId.trim();
      await updateDoc(firmDocPath, updates);
      setLawPayKey('');
      setLawPayMerchantId('');
      toast.success('LawPay credentials saved.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save LawPay credentials.');
    } finally {
      setSavingLawPay(false);
    }
  }, [firmDocPath, lawPayKey, lawPayMerchantId, userProfile]);

  const handleConnectGoogleCalendar = useCallback(() => {
    toast.info(
      'OAuth flow will redirect to Google. Configure the Google Calendar OAuth client in Firebase Console.',
    );
  }, []);

  const handleDisconnectGoogleCalendar = useCallback(async () => {
    if (!firmDocPath) return;
    try {
      await updateDoc(firmDocPath, {
        googleCalendar: { connected: false },
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Google Calendar disconnected.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to disconnect Google Calendar.');
    }
  }, [firmDocPath, userProfile]);

  const handleSaveSecurity = useCallback(async () => {
    if (!firmDocPath) return;
    setSavingSecurity(true);
    try {
      await updateDoc(firmDocPath, {
        sessionTimeoutMinutes: Math.max(5, Math.min(480, sessionTimeout)),
        requireMfa,
        dataRetentionYears: Math.max(1, Math.min(99, dataRetention)),
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Security settings saved.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save security settings.');
    } finally {
      setSavingSecurity(false);
    }
  }, [firmDocPath, sessionTimeout, requireMfa, dataRetention, userProfile]);

  // MFA enrollment — placeholder flow (Firebase TOTP requires Blaze plan)
  const handleStartMfaEnrollment = useCallback(async () => {
    setEnrollingMfa(true);
    try {
      // TODO: Replace with actual Firebase TOTP enrollment:
      // const multiFactorUser = multiFactor(auth.currentUser!);
      // const session = await multiFactorUser.getSession();
      // const totpSecret = await TotpMultiFactorGenerator.generateSecret(session);
      // const uri = totpSecret.generateQrCodeUrl(auth.currentUser!.email!, 'NJ Estate Plan Generator');
      // setTotpUri(uri);

      // Placeholder:
      const placeholderUri = `otpauth://totp/NJ%20Estate%20Plan%20Generator:${encodeURIComponent(
        userProfile?.email ?? 'user',
      )}?secret=JBSWY3DPEHPK3PXP&issuer=NJ%20Estate%20Plan%20Generator`;
      setTotpUri(placeholderUri);
      setMfaStep('qr');
      if (import.meta.env.DEV) console.info('[MFA TODO] Generate real TOTP secret via Firebase multiFactor API');
    } catch (err) {
      console.error(err);
      toast.error('Failed to start MFA enrollment.');
    } finally {
      setEnrollingMfa(false);
    }
  }, [userProfile]);

  const handleVerifyMfaCode = useCallback(async () => {
    if (!mfaCode.trim() || mfaCode.length < 6) {
      toast.error('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setEnrollingMfa(true);
    try {
      // TODO: Replace with actual Firebase TOTP verification:
      // const multiFactorAssertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, mfaCode);
      // await multiFactor(auth.currentUser!).enroll(multiFactorAssertion, 'Authenticator App');

      if (import.meta.env.DEV) console.info('[MFA TODO] Verify code and enroll via Firebase TotpMultiFactorGenerator');
      await new Promise((r) => setTimeout(r, 500));
      setMfaStep('idle');
      setMfaCode('');
      setTotpUri('');
      toast.success('MFA enrollment complete (placeholder).');
    } catch (err) {
      console.error(err);
      toast.error('Invalid code. Please try again.');
    } finally {
      setEnrollingMfa(false);
    }
  }, [mfaCode]);

  const handleSaveTemplates = useCallback(async () => {
    if (!firmDocPath) return;
    setSavingTemplates(true);
    try {
      await updateDoc(firmDocPath, {
        emailTemplates: {
          questionnaireInvitation: sanitizeInput(templates.questionnaireInvitation),
          paymentRequest: sanitizeInput(templates.paymentRequest),
          appointmentConfirmation: sanitizeInput(templates.appointmentConfirmation),
        },
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Email templates saved.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save email templates.');
    } finally {
      setSavingTemplates(false);
    }
  }, [firmDocPath, templates, userProfile]);

  // ── Drag-over state ───────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!firmId) {
    return (
      <Alert className="border-amber-200 bg-amber-50">
        <AlertDescription className="text-amber-800">
          No firm ID found in your profile. Please contact support.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a365d]">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your firm configuration.</p>
        </div>
        <PageSkeleton />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-[#1a365d]">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your firm profile, branding, integrations, and security.
          </p>
        </div>

        {/* Tab layout */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* ── Sidebar tabs (desktop) / horizontal tabs (mobile) ── */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  'hover:bg-[#ebf4ff] hover:text-[#1a365d]',
                  activeTab === tab.id
                    ? 'bg-[#ebf4ff] text-[#1a365d]'
                    : 'text-gray-600',
                )}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                {activeTab === tab.id && (
                  <ChevronRight className="ml-auto hidden h-3.5 w-3.5 text-[#2b6cb0] lg:block" />
                )}
              </button>
            ))}
          </nav>

          {/* ── Tab content ── */}
          <div className="min-w-0 flex-1">
            {/* ════════════════════════════════════════════════════════════
                TAB 1 — FIRM PROFILE
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'firm' && (
              <Card className="border-gray-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                    <Building2 className="h-5 w-5" />
                    Firm Profile
                  </CardTitle>
                  <CardDescription>
                    Your firm's contact information and bar credentials.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Firm name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="firmName" className="text-[#1a365d]">
                      Firm Name
                    </Label>
                    <Input
                      id="firmName"
                      value={firmProfile.firmName}
                      onChange={(e) =>
                        setFirmProfile((p) => ({ ...p, firmName: e.target.value }))
                      }
                      placeholder="Elias Counsel, LLC"
                    />
                  </div>

                  {/* Address */}
                  <div className="space-y-1.5">
                    <Label htmlFor="firmAddress" className="text-[#1a365d]">
                      Street Address
                    </Label>
                    <Input
                      id="firmAddress"
                      value={firmProfile.firmAddress}
                      onChange={(e) =>
                        setFirmProfile((p) => ({ ...p, firmAddress: e.target.value }))
                      }
                      placeholder="168 Prospect Plains Road"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="col-span-2 space-y-1.5 sm:col-span-1">
                      <Label htmlFor="firmCity" className="text-[#1a365d]">
                        City
                      </Label>
                      <Input
                        id="firmCity"
                        value={firmProfile.firmCity}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmCity: e.target.value }))
                        }
                        placeholder="Monroe Township"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="firmState" className="text-[#1a365d]">
                        State
                      </Label>
                      <Input
                        id="firmState"
                        value={firmProfile.firmState}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmState: e.target.value }))
                        }
                        placeholder="NJ"
                        maxLength={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="firmZip" className="text-[#1a365d]">
                        ZIP
                      </Label>
                      <Input
                        id="firmZip"
                        value={firmProfile.firmZip}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmZip: e.target.value }))
                        }
                        placeholder="08831"
                        maxLength={10}
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Contact */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="firmPhone" className="text-[#1a365d]">
                        Phone
                      </Label>
                      <Input
                        id="firmPhone"
                        type="tel"
                        value={firmProfile.firmPhone}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmPhone: e.target.value }))
                        }
                        placeholder="(609) 655-3200"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="firmEmail" className="text-[#1a365d]">
                        Email
                      </Label>
                      <Input
                        id="firmEmail"
                        type="email"
                        value={firmProfile.firmEmail}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmEmail: e.target.value }))
                        }
                        placeholder="info@adameliaslaw.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="firmWebsite" className="text-[#1a365d]">
                        Website
                      </Label>
                      <Input
                        id="firmWebsite"
                        type="url"
                        value={firmProfile.firmWebsite}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, firmWebsite: e.target.value }))
                        }
                        placeholder="https://www.eliascounsel.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="barNumber" className="text-[#1a365d]">
                        NJ Bar Number
                      </Label>
                      <Input
                        id="barNumber"
                        value={firmProfile.barNumber}
                        onChange={(e) =>
                          setFirmProfile((p) => ({ ...p, barNumber: e.target.value }))
                        }
                        placeholder="050422014"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleSaveProfile}
                      disabled={savingProfile}
                      className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                    >
                      {savingProfile ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save Changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ════════════════════════════════════════════════════════════
                TAB 2 — BRANDING
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'branding' && (
              <div className="space-y-5">
                {/* Logo upload */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                      <ImageIcon className="h-5 w-5" />
                      Firm Logo
                    </CardTitle>
                    <CardDescription>
                      Appears on generated documents. Recommended: 300×100 px, PNG or SVG.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Drop zone */}
                    <div
                      ref={logoDropRef}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        setIsDragging(false);
                        handleLogoDrop(e);
                      }}
                      onClick={() => logoInputRef.current?.click()}
                      className={cn(
                        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors',
                        isDragging
                          ? 'border-[#2b6cb0] bg-[#ebf4ff]'
                          : 'border-gray-200 bg-gray-50 hover:border-[#2b6cb0] hover:bg-[#ebf4ff]',
                      )}
                    >
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleLogoSelect(file);
                        }}
                      />
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="max-h-20 max-w-xs rounded object-contain"
                        />
                      ) : (
                        <Upload className="h-8 w-8 text-gray-400" />
                      )}
                      <div className="text-center">
                        <p className="text-sm font-medium text-[#1a365d]">
                          {logoPreview ? 'Click or drop to replace' : 'Click or drop to upload'}
                        </p>
                        <p className="text-xs text-gray-500">PNG, SVG, JPG · max 5 MB</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Color pickers */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                      <Palette className="h-5 w-5" />
                      Brand Colors
                    </CardTitle>
                    <CardDescription>
                      Used in generated documents and client-facing emails.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ColorPickerRow
                        label="Primary Color"
                        value={primaryColor}
                        onChange={setPrimaryColor}
                      />
                      <ColorPickerRow
                        label="Accent Color"
                        value={accentColor}
                        onChange={setAccentColor}
                      />
                    </div>

                    {/* Live preview */}
                    <div className="mt-2 rounded-xl border border-gray-200 p-4">
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
                        Preview
                      </p>
                      <div
                        className="rounded-lg p-5 text-white"
                        style={{ backgroundColor: primaryColor }}
                      >
                        <p className="text-sm font-semibold">
                          {firmProfile.firmName || 'Your Firm Name'}
                        </p>
                        <p className="mt-1 text-xs opacity-75">Estate Planning</p>
                        <button
                          type="button"
                          className="mt-3 rounded-md px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                          style={{ backgroundColor: accentColor }}
                        >
                          Get Started
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveBranding}
                    disabled={savingBranding || uploadingLogo}
                    className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                  >
                    {savingBranding || uploadingLogo ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {uploadingLogo ? 'Uploading…' : 'Save Branding'}
                  </Button>
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                TAB 3 — INTEGRATIONS
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'integrations' && (
              <div className="space-y-5">
                {/* OpenAI */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                          <Zap className="h-5 w-5" />
                          OpenAI
                        </CardTitle>
                        <CardDescription>
                          Powers AI document drafting and analysis.
                        </CardDescription>
                      </div>
                      <StatusBadge connected={Boolean(firmDoc?.openAiApiKey)} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ApiKeyField
                      label="API Key"
                      storedKey={firmDoc?.openAiApiKey}
                      pendingKey={openAiKey}
                      onPendingChange={setOpenAiKey}
                      onSave={() =>
                        handleSaveApiKey(
                          'openAiApiKey',
                          openAiKey,
                          setSavingOpenAi,
                          () => setOpenAiKey(''),
                        )
                      }
                      saving={savingOpenAi}
                      description="Find your key at platform.openai.com/api-keys"
                    />
                  </CardContent>
                </Card>

                {/* LawPay */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                          <Key className="h-5 w-5" />
                          LawPay / AffiniPay
                        </CardTitle>
                        <CardDescription>
                          Handles client payments and invoicing.
                        </CardDescription>
                      </div>
                      <StatusBadge
                        connected={Boolean(firmDoc?.lawPayApiKey && firmDoc?.lawPayMerchantId)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-[#1a365d]">API Key</Label>
                      <div className="relative">
                        <Input
                          type="password"
                          placeholder={
                            firmDoc?.lawPayApiKey
                              ? maskApiKey(firmDoc.lawPayApiKey)
                              : 'Enter LawPay API key…'
                          }
                          value={lawPayKey}
                          onChange={(e) => setLawPayKey(e.target.value)}
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-[#1a365d]">
                        Merchant ID
                      </Label>
                      <Input
                        value={lawPayMerchantId}
                        onChange={(e) => setLawPayMerchantId(e.target.value)}
                        placeholder={firmDoc?.lawPayMerchantId ?? 'Enter merchant ID…'}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection('LawPay', setTestingLawPay)}
                        disabled={testingLawPay}
                        className="border-[#2b6cb0] text-[#2b6cb0]"
                      >
                        {testingLawPay ? (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Zap className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Test Connection
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveLawPay}
                        disabled={savingLawPay || (!lawPayKey.trim() && !lawPayMerchantId.trim())}
                        className="bg-[#2b6cb0] hover:bg-[#1a365d]"
                      >
                        {savingLawPay ? (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* SendGrid */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                          <Mail className="h-5 w-5" />
                          SendGrid
                        </CardTitle>
                        <CardDescription>
                          Sends transactional emails to clients.
                        </CardDescription>
                      </div>
                      <StatusBadge connected={Boolean(firmDoc?.sendGridApiKey)} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ApiKeyField
                      label="API Key"
                      storedKey={firmDoc?.sendGridApiKey}
                      pendingKey={sendGridKey}
                      onPendingChange={setSendGridKey}
                      onSave={() =>
                        handleSaveApiKey(
                          'sendGridApiKey',
                          sendGridKey,
                          setSavingSendGrid,
                          () => setSendGridKey(''),
                        )
                      }
                      saving={savingSendGrid}
                      description="Find your key at app.sendgrid.com/settings/api_keys"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection('SendGrid', setTestingSendGrid)}
                      disabled={testingSendGrid}
                      className="mt-1 border-[#2b6cb0] text-[#2b6cb0]"
                    >
                      {testingSendGrid ? (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Test Connection
                    </Button>
                  </CardContent>
                </Card>

                {/* Google Calendar */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                          <Calendar className="h-5 w-5" />
                          Google Calendar
                        </CardTitle>
                        <CardDescription>
                          Sync appointments and deadlines with Google Calendar.
                        </CardDescription>
                      </div>
                      <StatusBadge connected={Boolean(firmDoc?.googleCalendar?.connected)} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {firmDoc?.googleCalendar?.connected ? (
                      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-green-800">Connected</p>
                          {firmDoc.googleCalendar.email && (
                            <p className="text-xs text-green-600">
                              as {firmDoc.googleCalendar.email}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDisconnectGoogleCalendar}
                          className="border-red-300 text-red-600 hover:bg-red-50"
                        >
                          <Unplug className="mr-1.5 h-3.5 w-3.5" />
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">
                          Connect your Google account to sync calendar events automatically.
                        </p>
                        <Button
                          onClick={handleConnectGoogleCalendar}
                          className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                        >
                          <Calendar className="h-4 w-4" />
                          Connect Google Calendar
                        </Button>
                        <p className="text-xs text-gray-400">
                          Requires OAuth setup in Firebase Console → Authentication → Sign-in providers.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                TAB 4 — SECURITY
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'security' && (
              <div className="space-y-5">
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                      <Lock className="h-5 w-5" />
                      Session &amp; Access
                    </CardTitle>
                    <CardDescription>
                      Control how long users stay logged in and what authentication is required.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Session timeout */}
                    <div className="space-y-1.5">
                      <Label htmlFor="sessionTimeout" className="text-[#1a365d]">
                        Session Timeout (minutes)
                      </Label>
                      <p className="text-xs text-gray-500">
                        Users will be automatically signed out after this many minutes of inactivity.
                        Min 5, max 480.
                      </p>
                      <Input
                        id="sessionTimeout"
                        type="number"
                        min={5}
                        max={480}
                        value={sessionTimeout}
                        onChange={(e) => setSessionTimeout(Number(e.target.value))}
                        className="w-32"
                      />
                    </div>

                    <Separator />

                    {/* Require MFA */}
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="requireMfa"
                        checked={requireMfa}
                        onCheckedChange={(checked) => setRequireMfa(Boolean(checked))}
                        className="mt-0.5 border-[#2b6cb0] data-[state=checked]:bg-[#2b6cb0]"
                      />
                      <div>
                        <Label htmlFor="requireMfa" className="cursor-pointer text-[#1a365d]">
                          Require MFA for all users
                        </Label>
                        <p className="mt-0.5 text-xs text-gray-500">
                          All firm members must enroll in two-factor authentication before accessing the app.
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {/* Data retention */}
                    <div className="space-y-1.5">
                      <Label htmlFor="dataRetention" className="text-[#1a365d]">
                        Data Retention (years)
                      </Label>
                      <p className="text-xs text-gray-500">
                        Client records and documents are retained for this many years after case closure.
                        NJ ethics rules require minimum 7 years.
                      </p>
                      <Input
                        id="dataRetention"
                        type="number"
                        min={1}
                        max={99}
                        value={dataRetention}
                        onChange={(e) => setDataRetention(Number(e.target.value))}
                        className="w-32"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={handleSaveSecurity}
                        disabled={savingSecurity}
                        className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                      >
                        {savingSecurity ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Security Settings
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* MFA Enrollment */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                      <Shield className="h-5 w-5" />
                      Two-Factor Authentication
                    </CardTitle>
                    <CardDescription>
                      Enroll your account in TOTP-based two-factor authentication.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {mfaStep === 'idle' && (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">
                          Use an authenticator app (Google Authenticator, Authy) for an extra layer of security.
                        </p>
                        <Alert className="border-amber-200 bg-amber-50">
                          <AlertDescription className="text-xs text-amber-700">
                            <strong>Note:</strong> Firebase TOTP MFA requires the Blaze (pay-as-you-go) plan.
                            The enrollment UI is ready; activate it by uncommenting the Firebase MFA calls
                            in <code className="font-mono">SettingsPage.tsx</code>.
                          </AlertDescription>
                        </Alert>
                        <Button
                          onClick={handleStartMfaEnrollment}
                          disabled={enrollingMfa}
                          className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                        >
                          {enrollingMfa ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Shield className="h-4 w-4" />
                          )}
                          Enable Two-Factor Authentication
                        </Button>
                      </div>
                    )}

                    {mfaStep === 'qr' && (
                      <div className="space-y-4">
                        <p className="text-sm font-medium text-[#1a365d]">
                          Step 1 — Scan with your authenticator app
                        </p>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            OTP Auth URI
                          </p>
                          <code className="block break-all rounded bg-white p-3 text-xs text-gray-700 ring-1 ring-gray-200">
                            {totpUri}
                          </code>
                          <p className="mt-2 text-xs text-gray-500">
                            Open your authenticator app, choose "Add account → Scan QR code", then
                            manually enter the URI above if QR scanning isn't available.
                          </p>
                        </div>
                        <Button
                          onClick={() => setMfaStep('verify')}
                          className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                        >
                          I've scanned it → Enter Code
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setMfaStep('idle');
                            setTotpUri('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}

                    {mfaStep === 'verify' && (
                      <div className="space-y-4">
                        <p className="text-sm font-medium text-[#1a365d]">
                          Step 2 — Verify the code from your app
                        </p>
                        <div className="space-y-1.5">
                          <Label htmlFor="mfaCode" className="text-[#1a365d]">
                            6-digit code
                          </Label>
                          <Input
                            id="mfaCode"
                            value={mfaCode}
                            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-32 text-center font-mono text-lg tracking-widest"
                            maxLength={6}
                            inputMode="numeric"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleVerifyMfaCode}
                            disabled={enrollingMfa || mfaCode.length < 6}
                            className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                          >
                            {enrollingMfa ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            Verify &amp; Enroll
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setMfaStep('idle');
                              setMfaCode('');
                              setTotpUri('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════
                TAB 5 — EMAIL TEMPLATES
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'templates' && (
              <Card className="border-gray-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                    <Mail className="h-5 w-5" />
                    Email Templates
                  </CardTitle>
                  <CardDescription>
                    Customize the emails sent to clients. Use the placeholders below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Variable reference */}
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-gray-500">Available variables:</span>
                    {[
                      '{{clientName}}',
                      '{{firmName}}',
                      '{{link}}',
                      '{{amount}}',
                      '{{date}}',
                    ].map((v) => (
                      <Tooltip key={v}>
                        <TooltipTrigger asChild>
                          <code className="cursor-default rounded bg-[#ebf4ff] px-2 py-0.5 text-xs font-mono text-[#2b6cb0]">
                            {v}
                          </code>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Will be replaced at send time</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>

                  <Separator />

                  {/* Questionnaire Invitation */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[#1a365d]">
                        Questionnaire Invitation
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-gray-500 hover:text-[#2b6cb0]"
                        onClick={() =>
                          setTemplates((t) => ({
                            ...t,
                            questionnaireInvitation: DEFAULT_TEMPLATES.questionnaireInvitation,
                          }))
                        }
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        Reset to default
                      </Button>
                    </div>
                    <Textarea
                      rows={10}
                      value={templates.questionnaireInvitation}
                      onChange={(e) =>
                        setTemplates((t) => ({
                          ...t,
                          questionnaireInvitation: e.target.value,
                        }))
                      }
                      className="resize-y font-mono text-sm"
                    />
                  </div>

                  <Separator />

                  {/* Payment Request */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[#1a365d]">
                        Payment Request
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-gray-500 hover:text-[#2b6cb0]"
                        onClick={() =>
                          setTemplates((t) => ({
                            ...t,
                            paymentRequest: DEFAULT_TEMPLATES.paymentRequest,
                          }))
                        }
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        Reset to default
                      </Button>
                    </div>
                    <Textarea
                      rows={10}
                      value={templates.paymentRequest}
                      onChange={(e) =>
                        setTemplates((t) => ({
                          ...t,
                          paymentRequest: e.target.value,
                        }))
                      }
                      className="resize-y font-mono text-sm"
                    />
                  </div>

                  <Separator />

                  {/* Appointment Confirmation */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[#1a365d]">
                        Appointment Confirmation
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-gray-500 hover:text-[#2b6cb0]"
                        onClick={() =>
                          setTemplates((t) => ({
                            ...t,
                            appointmentConfirmation: DEFAULT_TEMPLATES.appointmentConfirmation,
                          }))
                        }
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        Reset to default
                      </Button>
                    </div>
                    <Textarea
                      rows={10}
                      value={templates.appointmentConfirmation}
                      onChange={(e) =>
                        setTemplates((t) => ({
                          ...t,
                          appointmentConfirmation: e.target.value,
                        }))
                      }
                      className="resize-y font-mono text-sm"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleSaveTemplates}
                      disabled={savingTemplates}
                      className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                    >
                      {savingTemplates ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save Templates
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

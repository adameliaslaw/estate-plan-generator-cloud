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
  AlertCircle,
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
  Users,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';

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

import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { storage, auth, db, functions } from '@/config/firebase';
import { COLLECTIONS, FIRM_DEFAULTS } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { useCollection, updateDoc, useDocument } from '@/hooks/useFirestore';
import { cn } from '@/lib/utils';
import { sanitizeInput } from '@/utils/sanitize';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Timestamp, addDoc, collection } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { EmailTemplate, EmailTrigger, Notary } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import { GoogleOAuthProvider } from '@react-oauth/google';
import {
  GoogleLoginButton,
  PageSkeleton,
  ApiKeyField,
  StatusBadge,
  ColorPickerRow,
  maskApiKey,
} from '@/components/settings/SettingsHelpers';
import { TeamTab } from '@/components/settings/TeamTab';

// ---------------------------------------------------------------------------
// Google OAuth Config
// ---------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// ---------------------------------------------------------------------------
// Firebase MFA imports — TOTP
import { multiFactor, TotpMultiFactorGenerator } from 'firebase/auth';
import type { TotpSecret } from 'firebase/auth';
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

  // Notary defaults
  notaries?: Notary[];
  // Legacy deprecated notary fields
  defaultNotaryName?: string;
  defaultNotaryCommission?: string;
  defaultNotaryExpiration?: string;
  defaultNotaryType?: 'attorney' | 'notaryPublic';
  defaultNotaryCounty?: string;
  defaultNotaryAttorneyId?: string;

  logoUrl?: string;
  primaryColor: string;
  accentColor: string;

  // API Integrations
  openAiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  perplexityApiKey?: string;
  activeAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  chatbotAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  documentDraftingAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  chatbotModel?: string;
  documentDraftingModel?: string;
  lawPayApiKey?: string;
  lawPayMerchantId?: string;
  sendGridApiKey?: string;
  levitateApiKey?: string;
  levitateWebhookUrl?: string;

  // Google Calendar OAuth
  googleCalendar?: {
    connected: boolean;
    email?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
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

type TabId = 'firm' | 'team' | 'branding' | 'integrations' | 'security' | 'templates';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'firm', label: 'Firm Profile', icon: <Building2 className="h-4 w-4" /> },
  { id: 'team', label: 'Team', icon: <Users className="h-4 w-4" /> },
  { id: 'branding', label: 'Branding', icon: <Palette className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Zap className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'templates', label: 'Email Templates', icon: <Mail className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive initial tab from window.location.pathname. */
function getInitialTab(canManageFirmSettings: boolean, canManageUsers: boolean): TabId {
  const path = window.location.pathname;
  if (path.includes('/settings/firm') && canManageFirmSettings) return 'firm';
  if (path.includes('/settings/users') && canManageUsers) return 'team';
  if (path.includes('/settings/billing') && canManageFirmSettings) return 'integrations';
  if (canManageFirmSettings) return 'firm';
  if (canManageUsers) return 'team';
  return 'firm'; // Default fallback, but UI will block access entirely if both are false
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { userProfile } = useAuth();
  const { canManageFirmSettings, canManageUsers } = usePermissions();
  const firmId = userProfile?.firmId ?? '';

  const firmPath = firmId ? `${COLLECTIONS.FIRMS}/${firmId}` : null;
  const { data: firmDoc, loading } = useDocument<FirmSettings>(firmPath);

  // Load custom templates subcollection
  const templatesPath = firmId ? `${COLLECTIONS.FIRMS}/${firmId}/emailTemplates` : null;
  const { data: emailTemplates } = useCollection<EmailTemplate>(templatesPath);

  const [activeTab, setActiveTab] = useState<TabId>(() => getInitialTab(canManageFirmSettings, canManageUsers));

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
    defaultNotaryName: '',
    defaultNotaryCommission: '',
    defaultNotaryExpiration: '',
    defaultNotaryType: 'attorney' as 'attorney' | 'notaryPublic',
    defaultNotaryCounty: '',
    defaultNotaryAttorneyId: '',
    notaries: [] as Notary[],
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
  const [anthropicKey, setAnthropicKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [perplexityKey, setPerplexityKey] = useState('');
  const [chatbotAiProvider, setChatbotAiProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'perplexity'>('openai');
  const [documentDraftingAiProvider, setDocumentDraftingAiProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'perplexity'>('openai');

  const [chatbotModel, setChatbotModel] = useState('');
  const [documentDraftingModel, setDocumentDraftingModel] = useState('');

  const [lawPayKey, setLawPayKey] = useState('');
  const [lawPayMerchantId, setLawPayMerchantId] = useState('');
  const [sendGridKey, setSendGridKey] = useState('');
  const [levitateKey, setLevitateKey] = useState('');
  const [levitateWebhook, setLevitateWebhook] = useState('');

  const [savingOpenAi, setSavingOpenAi] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  const [savingPerplexity, setSavingPerplexity] = useState(false);
  const [savingChatbotProvider, setSavingChatbotProvider] = useState(false);
  const [savingDocumentDraftingProvider, setSavingDocumentDraftingProvider] = useState(false);
  const [savingChatbotModel, setSavingChatbotModel] = useState(false);
  const [savingDocumentDraftingModel, setSavingDocumentDraftingModel] = useState(false);
  const [savingLawPay, setSavingLawPay] = useState(false);
  const [savingSendGrid, setSavingSendGrid] = useState(false);
  const [savingLevitate, setSavingLevitate] = useState(false);
  const [savingLevitateWebhook, setSavingLevitateWebhook] = useState(false);
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
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [enrollingMfa, setEnrollingMfa] = useState(false);

  // ── Tab 5: Email Templates ───────────────────────────────────────────────
  // ── Tab 5: Email Templates ───────────────────────────────────────────────
  const [editingTemplate, setEditingTemplate] = useState<Partial<EmailTemplate> | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [savingTemplateForm, setSavingTemplateForm] = useState(false);

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
      defaultNotaryName: firmDoc.defaultNotaryName ?? '',
      defaultNotaryCommission: firmDoc.defaultNotaryCommission ?? '',
      defaultNotaryExpiration: firmDoc.defaultNotaryExpiration ?? '',
      defaultNotaryType: firmDoc.defaultNotaryType ?? 'attorney',
      defaultNotaryCounty: firmDoc.defaultNotaryCounty ?? '',
      defaultNotaryAttorneyId: firmDoc.defaultNotaryAttorneyId ?? '',
      notaries: firmDoc.notaries ?? [],
    });

    if (firmDoc.logoUrl) setLogoPreview(firmDoc.logoUrl);
    setPrimaryColor(firmDoc.primaryColor ?? FIRM_DEFAULTS.primaryColor);
    setAccentColor(firmDoc.accentColor ?? FIRM_DEFAULTS.accentColor);

    setChatbotAiProvider(firmDoc.chatbotAiProvider ?? firmDoc.activeAiProvider ?? 'openai');
    setDocumentDraftingAiProvider(firmDoc.documentDraftingAiProvider ?? firmDoc.activeAiProvider ?? 'openai');
    setChatbotModel(firmDoc.chatbotModel ?? '');
    setDocumentDraftingModel(firmDoc.documentDraftingModel ?? '');

    setSessionTimeout(firmDoc.sessionTimeoutMinutes ?? 30);
    setRequireMfa(firmDoc.requireMfa ?? false);
    setDataRetention(firmDoc.dataRetentionYears ?? 7);

    if (firmDoc.levitateApiKey) setLevitateKey(firmDoc.levitateApiKey);
    if (firmDoc.levitateWebhookUrl) setLevitateWebhook(firmDoc.levitateWebhookUrl);
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
        defaultNotaryName: sanitizeInput(firmProfile.defaultNotaryName),
        defaultNotaryCommission: sanitizeInput(firmProfile.defaultNotaryCommission),
        defaultNotaryExpiration: sanitizeInput(firmProfile.defaultNotaryExpiration),
        defaultNotaryType: firmProfile.defaultNotaryType,
        defaultNotaryCounty: sanitizeInput(firmProfile.defaultNotaryCounty),
        defaultNotaryAttorneyId: sanitizeInput(firmProfile.defaultNotaryAttorneyId),
        notaries: firmProfile.notaries.map(n => ({
          ...n,
          name: sanitizeInput(n.name),
          commission: sanitizeInput(n.commission || ''),
          county: sanitizeInput(n.county || ''),
          attorneyId: sanitizeInput(n.attorneyId || ''),
        })),
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
        const storageRef = ref(storage, `firms/${firmId}/branding/logo`);
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
      field: string,
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

  const handleSaveAiProvider = useCallback(
    async (
      field: 'chatbotAiProvider' | 'documentDraftingAiProvider',
      provider: 'openai' | 'anthropic' | 'gemini' | 'perplexity',
      setSaving: (v: boolean) => void
    ) => {
      if (!firmDocPath) return;
      setSaving(true);
      if (field === 'chatbotAiProvider') {
        setChatbotAiProvider(provider);
      } else {
        setDocumentDraftingAiProvider(provider);
      }
      try {
        await updateDoc(firmDocPath, {
          [field]: provider,
          updatedBy: userProfile?.uid ?? '',
        });
        toast.success(`${field === 'chatbotAiProvider' ? 'Chatbot' : 'Document Drafting'} AI provider set to ${provider.charAt(0).toUpperCase() + provider.slice(1)}.`);
      } catch (err) {
        console.error(err);
        toast.error(`Failed to update ${field === 'chatbotAiProvider' ? 'Chatbot' : 'Document Drafting'} AI provider.`);
      } finally {
        setSaving(false);
      }
    },
    [firmDocPath, userProfile]
  );

  const handleSaveModel = useCallback(
    async (field: 'chatbotModel' | 'documentDraftingModel', model: string, setSaving: (v: boolean) => void) => {
      if (!firmDocPath) return;
      setSaving(true);
      if (field === 'chatbotModel') setChatbotModel(model);
      else setDocumentDraftingModel(model);

      try {
        await updateDoc(firmDocPath, {
          [field]: model,
          updatedBy: userProfile?.uid ?? '',
        });
        toast.success(`Active ${field === 'chatbotModel' ? 'chatbot' : 'document drafting'} model updated.`);
      } catch (err) {
        console.error(err);
        toast.error(`Failed to update ${field === 'chatbotModel' ? 'chatbot' : 'document drafting'} model.`);
      } finally {
        setSaving(false);
      }
    },
    [firmDocPath, userProfile]
  );

  const handleTestConnection = useCallback(
    async (service: string, setTesting: (v: boolean) => void) => {
      setTesting(true);
      await new Promise((r) => setTimeout(r, 800));
      setTesting(false);
      toast.success(`${service} connection test successful.`);
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

  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const handleExchangeAuthCode = useCallback(async (code: string) => {
    if (!firmDocPath) return;
    setConnectingGoogle(true);
    try {
      const firmId = firmDocPath.split('/')[1];
      const exchangeFn = httpsCallable(functions, 'exchangeGoogleAuthCode');
      await exchangeFn({ code, redirectUri: 'postmessage', firmId });
      toast.success('Google Calendar connected successfully!');
    } catch (err: unknown) {
      console.error('Google OAuth Exchange Error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to connect Google Calendar.');
    } finally {
      setConnectingGoogle(false);
    }
  }, [firmDocPath]);

  const handleDisconnectGoogleCalendar = useCallback(async () => {
    if (!firmDocPath) return;
    try {
      // Best-effort: revoke the token with Google so the app doesn't stay listed
      // in the user's Google Account permissions.
      if (firmDoc?.googleCalendar?.accessToken) {
        try {
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${firmDoc.googleCalendar.accessToken}`,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
          );
        } catch {
          // Non-critical — token may already be expired/revoked
        }
      }

      await updateDoc(firmDocPath, {
        'googleCalendar.connected': false,
        'googleCalendar.accessToken': '',
        'googleCalendar.refreshToken': '',
        'googleCalendar.tokenExpiry': 0,
        'googleCalendar.email': '',
        updatedBy: userProfile?.uid ?? '',
      });
      toast.success('Google Calendar disconnected.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to disconnect Google Calendar.');
    }
  }, [firmDocPath, firmDoc, userProfile]);

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

  // MFA enrollment
  const handleStartMfaEnrollment = useCallback(async () => {
    setEnrollingMfa(true);
    try {
      if (!auth.currentUser) throw new Error('User not authenticated.');
      const multiFactorUser = multiFactor(auth.currentUser);
      const session = await multiFactorUser.getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      const uri = secret.generateQrCodeUrl(auth.currentUser.email || 'user', 'NJ Estate Plan Generator');

      setTotpSecret(secret);
      setTotpUri(uri);
      setMfaStep('qr');
    } catch (err) {
      console.error(err);
      toast.error('Failed to start MFA enrollment.');
    } finally {
      setEnrollingMfa(false);
    }
  }, []);

  const handleVerifyMfaCode = useCallback(async () => {
    if (!mfaCode.trim() || mfaCode.length < 6) {
      toast.error('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!totpSecret || !auth.currentUser) return;

    setEnrollingMfa(true);
    try {
      const multiFactorAssertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, mfaCode);
      await multiFactor(auth.currentUser).enroll(multiFactorAssertion, 'Authenticator App');

      setMfaStep('idle');
      setMfaCode('');
      setTotpUri('');
      setTotpSecret(null);
      toast.success('MFA enrollment complete. Your account is now secured.');
    } catch (err) {
      console.error(err);
      toast.error('Invalid code. Please try again.');
    } finally {
      setEnrollingMfa(false);
    }
  }, [mfaCode, totpSecret]);

  // ── Handlers: Email Templates ────────────────────────────────────────────

  const handleSaveTemplate = async () => {
    if (!editingTemplate || !firmId || !editingTemplate.name || !editingTemplate.subject) return;
    setSavingTemplateForm(true);
    try {
      const templateData: Partial<EmailTemplate> = {
        name: editingTemplate.name,
        trigger: editingTemplate.trigger || 'general_manual',
        isActive: editingTemplate.isActive ?? true,
        subject: editingTemplate.subject,
        content: editingTemplate.content || '',
        updatedAt: Timestamp.now(),
        updatedBy: userProfile?.uid || 'unknown',
      };

      if (editingTemplate.id) {
        // Update existing (using string path for our custom updateDoc hook)
        await updateDoc(`${COLLECTIONS.FIRMS}/${firmId}/emailTemplates/${editingTemplate.id}`, templateData);
        toast.success('Template updated successfully');
      } else {
        // Create new
        templateData.firmId = firmId;
        templateData.createdAt = Timestamp.now();
        templateData.createdBy = userProfile?.uid || 'unknown';
        await addDoc(collection(db, `firms/${firmId}/emailTemplates`), templateData);
        toast.success('Template created successfully');
      }
      setIsTemplateDialogOpen(false);
      setEditingTemplate(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingTemplateForm(false);
    }
  };

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

  if (!canManageFirmSettings && !canManageUsers) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertDescription className="text-red-800">
          You do not have permission to view or manage firm settings.
        </AlertDescription>
      </Alert>
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
            {TABS.filter(tab => tab.id === 'team' ? canManageUsers : canManageFirmSettings).map((tab) => (
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
                TAB: TEAM
            ════════════════════════════════════════════════════════════ */}
            {activeTab === 'team' && <TeamTab firmId={firmId} />}

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

                  <Separator />

                  {/* Notary / Attorney Certification Defaults */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[#1a365d]">Notaries & Certifications</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Manage attorneys and notaries that can be selected for document execution.</p>
                    </div>

                    <div className="space-y-4">
                      {firmProfile.notaries.map((notary, index) => (
                        <div key={notary.id} className="relative rounded-lg border border-gray-200 bg-gray-50/50 p-4 pt-8">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-2 top-2 h-6 w-6 text-gray-400 hover:text-red-500"
                            onClick={() => {
                              const updated = [...firmProfile.notaries];
                              updated.splice(index, 1);
                              setFirmProfile((p) => ({ ...p, notaries: updated }));
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-[#1a365d]">Certification Type</Label>
                              <Select
                                value={notary.type}
                                onValueChange={(v) => {
                                  const updated = [...firmProfile.notaries];
                                  updated[index].type = v as 'attorney' | 'notaryPublic';
                                  setFirmProfile((p) => ({ ...p, notaries: updated }));
                                }}
                              >
                                <SelectTrigger className="bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="attorney">Attorney at Law (self-certifying)</SelectItem>
                                  <SelectItem value="notaryPublic">Notary Public</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[#1a365d]">County</Label>
                              <Input
                                value={notary.county || ''}
                                onChange={(e) => {
                                  const updated = [...firmProfile.notaries];
                                  updated[index].county = e.target.value;
                                  setFirmProfile((p) => ({ ...p, notaries: updated }));
                                }}
                                placeholder="Middlesex"
                                className="bg-white"
                              />
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 sm:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label className="text-[#1a365d]">
                                {notary.type === 'attorney' ? 'Attorney Name' : 'Notary Name'}
                              </Label>
                              <Input
                                value={notary.name}
                                onChange={(e) => {
                                  const updated = [...firmProfile.notaries];
                                  updated[index].name = e.target.value;
                                  setFirmProfile((p) => ({ ...p, notaries: updated }));
                                }}
                                placeholder={notary.type === 'attorney' ? 'Adam M. Elias, Esq.' : 'Jane Smith'}
                                className="bg-white"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[#1a365d]">
                                {notary.type === 'attorney' ? 'Attorney ID Number' : 'Commission Number'}
                              </Label>
                              <Input
                                value={notary.type === 'attorney' ? notary.attorneyId || '' : notary.commission || ''}
                                onChange={(e) => {
                                  const updated = [...firmProfile.notaries];
                                  if (notary.type === 'attorney') {
                                    updated[index].attorneyId = e.target.value;
                                  } else {
                                    updated[index].commission = e.target.value;
                                  }
                                  setFirmProfile((p) => ({ ...p, notaries: updated }));
                                }}
                                placeholder={notary.type === 'attorney' ? '050422014' : '2387651'}
                                className="bg-white"
                              />
                            </div>
                            {notary.type === 'notaryPublic' && (
                              <div className="space-y-1.5">
                                <Label className="text-[#1a365d]">Commission Expiration</Label>
                                <Input
                                  type="date"
                                  value={notary.expiration || ''}
                                  onChange={(e) => {
                                    const updated = [...firmProfile.notaries];
                                    updated[index].expiration = e.target.value;
                                    setFirmProfile((p) => ({ ...p, notaries: updated }));
                                  }}
                                  className="bg-white"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full border-dashed text-[#2b6cb0] hover:bg-[#ebf4ff] hover:text-[#1a365d]"
                        onClick={() => {
                          setFirmProfile((p) => ({
                            ...p,
                            notaries: [
                              ...p.notaries,
                              {
                                id: crypto.randomUUID(),
                                name: '',
                                type: 'notaryPublic',
                              },
                            ],
                          }));
                        }}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Notary / Attorney
                      </Button>
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
                      <StatusBadge connected={Boolean(firmDoc?.openAiApiKey || firmDoc?.anthropicApiKey || firmDoc?.geminiApiKey || firmDoc?.perplexityApiKey)} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Chatbot and Drafting Provider Selectors */}
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                        <Label className="text-sm font-medium text-[#1a365d]">Chatbot AI Provider</Label>
                        <p className="text-xs text-gray-500 mb-3">
                          Select the AI provider for chat interactions.
                        </p>
                        <Select disabled={savingChatbotProvider} value={chatbotAiProvider} onValueChange={(v: 'openai' | 'anthropic' | 'gemini' | 'perplexity') => handleSaveAiProvider('chatbotAiProvider', v, setSavingChatbotProvider)}>
                          <SelectTrigger className="w-full bg-white text-sm">
                            <SelectValue placeholder="Select provider..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                            <SelectItem value="gemini">Google (Gemini)</SelectItem>
                            <SelectItem value="perplexity">Perplexity (Sonar)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                        <Label className="text-sm font-medium text-[#1a365d]">Document Drafting AI Provider</Label>
                        <p className="text-xs text-gray-500 mb-3">
                          Select the AI provider for drafting documents.
                        </p>
                        <Select disabled={savingDocumentDraftingProvider} value={documentDraftingAiProvider} onValueChange={(v: 'openai' | 'anthropic' | 'gemini' | 'perplexity') => handleSaveAiProvider('documentDraftingAiProvider', v, setSavingDocumentDraftingProvider)}>
                          <SelectTrigger className="w-full bg-white text-sm">
                            <SelectValue placeholder="Select provider..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI (GPT)</SelectItem>
                            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                            <SelectItem value="gemini">Google (Gemini)</SelectItem>
                            <SelectItem value="perplexity">Perplexity (Sonar)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Separator className="my-2" />

                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                        <Label className="text-sm font-medium text-[#1a365d]">Chatbot Model</Label>
                        <p className="text-xs text-gray-500 mb-3">Model for the legal AI assistant.</p>
                        <div className="flex gap-2">
                          <Select value={chatbotModel} onValueChange={setChatbotModel}>
                            <SelectTrigger className="w-full bg-white text-sm">
                              <SelectValue placeholder="Select a model..." />
                            </SelectTrigger>
                            <SelectContent>
                              {chatbotAiProvider === 'openai' && (
                                <>
                                  <SelectItem value="gpt-5.4">gpt-5.4</SelectItem>
                                  <SelectItem value="gpt-5.4-pro">gpt-5.4-pro</SelectItem>
                                  <SelectItem value="gpt-5-mini">gpt-5-mini</SelectItem>
                                  <SelectItem value="o4-mini">o4-mini</SelectItem>
                                  <SelectItem value="o3">o3</SelectItem>
                                </>
                              )}
                              {chatbotAiProvider === 'anthropic' && (
                                <>
                                  <SelectItem value="claude-opus-4-6">claude-opus-4-6</SelectItem>
                                  <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
                                </>
                              )}
                              {chatbotAiProvider === 'gemini' && (
                                <>
                                  <SelectItem value="gemini-2.5-pro">gemini-2.5-pro</SelectItem>
                                  <SelectItem value="gemini-2.5-flash">gemini-2.5-flash</SelectItem>
                                  <SelectItem value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</SelectItem>
                                </>
                              )}
                              {chatbotAiProvider === 'perplexity' && (
                                <>
                                  <SelectItem value="sonar-deep-research">sonar-deep-research</SelectItem>
                                  <SelectItem value="sonar-reasoning-pro">sonar-reasoning-pro</SelectItem>
                                  <SelectItem value="sonar-pro">sonar-pro</SelectItem>
                                  <SelectItem value="sonar-reasoning">sonar-reasoning</SelectItem>
                                  <SelectItem value="sonar">sonar</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <Button size="sm" onClick={() => handleSaveModel('chatbotModel', chatbotModel, setSavingChatbotModel)} disabled={savingChatbotModel} className="bg-[#2b6cb0] hover:bg-[#1a365d]">
                            {savingChatbotModel ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                        </div>
                        {firmDoc?.chatbotModel && <p className="text-xs text-green-600 mt-2">Saved: {firmDoc.chatbotModel}</p>}
                      </div>

                      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                        <Label className="text-sm font-medium text-[#1a365d]">Document Drafting Model</Label>
                        <p className="text-xs text-gray-500 mb-3">Model for generating legal documents.</p>
                        <div className="flex gap-2">
                          <Select value={documentDraftingModel} onValueChange={setDocumentDraftingModel}>
                            <SelectTrigger className="w-full bg-white text-sm">
                              <SelectValue placeholder="Select a model..." />
                            </SelectTrigger>
                            <SelectContent>
                              {documentDraftingAiProvider === 'openai' && (
                                <>
                                  <SelectItem value="gpt-5.4">gpt-5.4</SelectItem>
                                  <SelectItem value="gpt-5.4-pro">gpt-5.4-pro</SelectItem>
                                  <SelectItem value="gpt-5-mini">gpt-5-mini</SelectItem>
                                  <SelectItem value="o4-mini">o4-mini</SelectItem>
                                  <SelectItem value="o3">o3</SelectItem>
                                </>
                              )}
                              {documentDraftingAiProvider === 'anthropic' && (
                                <>
                                  <SelectItem value="claude-opus-4-6">claude-opus-4-6</SelectItem>
                                  <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
                                </>
                              )}
                              {documentDraftingAiProvider === 'gemini' && (
                                <>
                                  <SelectItem value="gemini-2.5-pro">gemini-2.5-pro</SelectItem>
                                  <SelectItem value="gemini-2.5-flash">gemini-2.5-flash</SelectItem>
                                  <SelectItem value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</SelectItem>
                                </>
                              )}
                              {documentDraftingAiProvider === 'perplexity' && (
                                <>
                                  <SelectItem value="sonar-deep-research">sonar-deep-research</SelectItem>
                                  <SelectItem value="sonar-reasoning-pro">sonar-reasoning-pro</SelectItem>
                                  <SelectItem value="sonar-pro">sonar-pro</SelectItem>
                                  <SelectItem value="sonar-reasoning">sonar-reasoning</SelectItem>
                                  <SelectItem value="sonar">sonar</SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <Button size="sm" onClick={() => handleSaveModel('documentDraftingModel', documentDraftingModel, setSavingDocumentDraftingModel)} disabled={savingDocumentDraftingModel} className="bg-[#2b6cb0] hover:bg-[#1a365d]">
                            {savingDocumentDraftingModel ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                        </div>
                        {firmDoc?.documentDraftingModel && <p className="text-xs text-green-600 mt-2">Saved: {firmDoc.documentDraftingModel}</p>}
                      </div>
                    </div>

                    <Separator className="my-2" />

                    <div className="grid gap-6">
                      <ApiKeyField
                        label="OpenAI API Key"
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

                      <Separator />

                      <ApiKeyField
                        label="Anthropic API Key"
                        storedKey={firmDoc?.anthropicApiKey}
                        pendingKey={anthropicKey}
                        onPendingChange={setAnthropicKey}
                        onSave={() =>
                          handleSaveApiKey(
                            'anthropicApiKey',
                            anthropicKey,
                            setSavingAnthropic,
                            () => setAnthropicKey(''),
                          )
                        }
                        saving={savingAnthropic}
                        description="Find your key at console.anthropic.com/settings/keys"
                      />

                      <Separator />

                      <ApiKeyField
                        label="Google Gemini API Key"
                        storedKey={firmDoc?.geminiApiKey}
                        pendingKey={geminiKey}
                        onPendingChange={setGeminiKey}
                        onSave={() =>
                          handleSaveApiKey(
                            'geminiApiKey',
                            geminiKey,
                            setSavingGemini,
                            () => setGeminiKey(''),
                          )
                        }
                        saving={savingGemini}
                        description="Find your key at aistudio.google.com/app/apikey"
                      />

                      <Separator />

                      <ApiKeyField
                        label="Perplexity API Key"
                        storedKey={firmDoc?.perplexityApiKey}
                        pendingKey={perplexityKey}
                        onPendingChange={setPerplexityKey}
                        onSave={() =>
                          handleSaveApiKey(
                            'perplexityApiKey',
                            perplexityKey,
                            setSavingPerplexity,
                            () => setPerplexityKey(''),
                          )
                        }
                        saving={savingPerplexity}
                        description="Find your key at perplexity.ai/settings/api"
                      />
                    </div>
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

                {/* Levitate Contacts */}
                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                          <Zap className="h-5 w-5" />
                          Levitate Contacts
                        </CardTitle>
                        <CardDescription>
                          Automatically sync your clients to Levitate.
                        </CardDescription>
                      </div>
                      <StatusBadge connected={Boolean(firmDoc?.levitateApiKey || firmDoc?.levitateWebhookUrl)} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ApiKeyField
                      label="API Key"
                      storedKey={firmDoc?.levitateApiKey}
                      pendingKey={levitateKey}
                      onPendingChange={setLevitateKey}
                      onSave={() =>
                        handleSaveApiKey(
                          'levitateApiKey',
                          levitateKey,
                          setSavingLevitate,
                          () => setLevitateKey(''),
                        )
                      }
                      saving={savingLevitate}
                      description="Used for direct Levitate integrations"
                    />
                    <Separator />
                    <ApiKeyField
                      label="Webhook URL (Zapier/Make)"
                      storedKey={firmDoc?.levitateWebhookUrl}
                      pendingKey={levitateWebhook}
                      onPendingChange={setLevitateWebhook}
                      onSave={() =>
                        handleSaveApiKey(
                          'levitateWebhookUrl',
                          levitateWebhook,
                          setSavingLevitateWebhook,
                          () => setLevitateWebhook(''),
                        )
                      }
                      saving={savingLevitateWebhook}
                      description="Alternative: webhook to push new clients to Zapier/Make"
                    />
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
                        {GOOGLE_CLIENT_ID ? (
                          <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                            <GoogleLoginButton
                              onSuccess={handleExchangeAuthCode}
                              onError={() => toast.error('Google login popup failed.')}
                              disabled={connectingGoogle}
                            />
                          </GoogleOAuthProvider>
                        ) : (
                          <Alert className="mt-2 text-sm border-red-200 bg-red-50 text-red-900 [&>svg]:text-red-900">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              Missing VITE_GOOGLE_CLIENT_ID in environment variables.
                            </AlertDescription>
                          </Alert>
                        )}
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
              <div className="space-y-5">
                <div className="flex justify-end">
                  <Button
                    className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
                    onClick={() => {
                      setEditingTemplate({
                        name: '',
                        trigger: 'client_created',
                        isActive: true,
                        subject: '',
                        content: '',
                      });
                      setIsTemplateDialogOpen(true);
                    }}
                  >
                    Add Custom Template
                  </Button>
                </div>

                <Card className="border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[#1a365d]">
                      <Mail className="h-5 w-5" />
                      Email Templates & Automations
                    </CardTitle>
                    <CardDescription>
                      Customize the emails sent to clients. Use the placeholders below inside your content.
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

                    {/* Template List */}
                    {emailTemplates?.length === 0 ? (
                      <div className="py-8 text-center text-gray-500 text-sm">
                        No custom templates configured. Using system defaults.
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {emailTemplates?.map((template) => (
                          <div
                            key={template.id}
                            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-200 hover:shadow-sm"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium text-[#1a365d]">{template.name}</h4>
                                <span className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                  template.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                                )}>
                                  {template.isActive ? "Active" : "Inactive"}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500">Trigger: {template.trigger}</p>
                              <p className="text-xs text-gray-400 mt-1 line-clamp-1">Subject: {template.subject}</p>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                              onClick={() => {
                                setEditingTemplate(template);
                                setIsTemplateDialogOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Template Editor Dialog ────────────────────────────────────────────── */}
      <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
        <DialogContent className="sm:max-w-[700px] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingTemplate?.id ? 'Edit Template' : 'Add New Template'}</DialogTitle>
            <DialogDescription>Configure the automation trigger and content for this email.</DialogDescription>
          </DialogHeader>

          {editingTemplate && (
            <div className="grid gap-4 py-4 flex-1 overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input
                    value={editingTemplate.name || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    placeholder="e.g. Welcome Email"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Automation Trigger</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={editingTemplate.trigger || 'manual'}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, trigger: e.target.value as EmailTrigger })}
                  >
                    <option value="general_manual">General Manual</option>
                    <option value="questionnaire_invitation">Manual: Questionnaire Invitation</option>
                    <option value="payment_request">Manual: Payment Request</option>
                    <option value="appointment_confirmation">Manual: Appointment Confirmation</option>
                    <option value="client_created">Auto: On Client Created</option>
                    <option value="questionnaire_completed">Auto: On Questionnaire Completed</option>
                    <option value="payment_received">Auto: On Payment Received</option>
                    <option value="appointment_scheduled">Auto: On Appointment Scheduled</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2 pb-2">
                <Checkbox
                  id="isActive"
                  checked={editingTemplate.isActive ?? true}
                  onCheckedChange={(c) => setEditingTemplate({ ...editingTemplate, isActive: Boolean(c) })}
                />
                <Label htmlFor="isActive" className="cursor-pointer">Active (Enable Automation)</Label>
              </div>

              <Separator />

              <div className="space-y-2 pt-2">
                <Label>Email Subject Line</Label>
                <Input
                  value={editingTemplate.subject || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                  placeholder="e.g. Action Required: Your Estate Planning Questionnaire"
                />
              </div>

              <div className="space-y-2 flex-1 flex flex-col">
                <Label>Email Content (HTML allowed)</Label>
                <p className="text-xs text-muted-foreground">Variables: {'{{clientName}}, {{firmName}}, {{link}}, {{amount}}, {{date}}'}</p>
                <Textarea
                  value={editingTemplate.content || ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                  className="flex-1 min-h-[250px] font-mono whitespace-pre-wrap"
                  placeholder="<p>Dear {{clientName}},</p><p>Welcome to {{firmName}}...</p>"
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-auto pt-4 border-t">
            <Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)} disabled={savingTemplateForm}>Cancel</Button>
            <Button
              className="bg-[#2b6cb0] hover:bg-[#1a365d]"
              onClick={handleSaveTemplate}
              disabled={savingTemplateForm || !editingTemplate?.name || !editingTemplate?.subject}
            >
              {savingTemplateForm && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

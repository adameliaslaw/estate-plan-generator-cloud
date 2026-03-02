/**
 * ClientDashboardPage.tsx
 *
 * Full client matter management page with:
 *   - Client summary header (name, package, questionnaire status, documents status, balance)
 *   - Five tabs: Client Information | Document Vault | Notes | Payments | Calendar
 *
 * Data is fetched in real-time from:
 *   /firms/{firmId}/clients/{clientId}
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { documentService } from '@/services/document-service';
import {
  ArrowLeft,
  User,
  Users,
  FileText,
  MessageSquare,
  FileEdit,
  DollarSign,
  CalendarDays,
  Sparkles,
  Mail,
  CalendarPlus,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Building2,
  MapPin,
  Phone,
  Briefcase,
  Heart,
  Baby,
  LayoutDashboard,
  Mic,
  Printer,
  UploadCloud,
} from 'lucide-react';
import { collection, setDoc, serverTimestamp, doc } from 'firebase/firestore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

import { useDocument } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { type Client } from '@/types';
import { cn } from '@/lib/utils';

import DocumentVault from '@/components/documents/DocumentVault';
import GenerateDocumentsButton from '@/components/documents/GenerateDocumentsButton';
import NotesTab from '@/components/dashboard/NotesTab';
import PaymentsTab from '@/components/dashboard/PaymentsTab';
import CalendarTab from '@/components/dashboard/CalendarTab';
import { TasksList } from '@/components/dashboard/TasksList';
import { AudioRecorderModal } from '@/components/ui/audio-recorder-modal';
import { UploadScanModal } from '@/components/ui/upload-scan-modal';
import { db } from '@/config/firebase';
import { uploadAudioToStorage, requestTranscription } from '@/utils/audio-helpers';

// ── Package badge helpers ─────────────────────────────────────────────────────

const PACKAGE_BADGE: Record<string, string> = {
  foundation: 'border-slate-300 bg-slate-50 text-slate-700',
  guardian: 'border-blue-300 bg-blue-50 text-blue-700',
  fortress: 'border-indigo-300 bg-indigo-50 text-indigo-700',
};

const PACKAGE_LABEL: Record<string, string> = {
  foundation: 'Foundation',
  guardian: 'Guardian',
  fortress: 'Fortress',
};

// ── Questionnaire status helpers ─────────────────────────────────────────────

const Q_STATUS_CONFIG = {
  not_started: { label: 'Not Started', icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
  completed: { label: 'Complete', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(cents: number | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

// ── Info row component ────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline">
      <dt className="w-44 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="text-sm text-gray-700">{value ?? <span className="text-gray-300">—</span>}</dd>
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────

function InfoCard({
  title,
  icon: Icon,
  iconColor,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#1a365d]">
          <Icon className={cn('h-4 w-4', iconColor)} />
          {title}
        </CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="px-5 py-4">
        <dl className="space-y-3">{children}</dl>
      </CardContent>
    </Card>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function ClientDashboardPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [activeTab, setActiveTab] = useState('info');
  const [autoOpenNewNote, setAutoOpenNewNote] = useState(false);
  const [autoOpenNewEvent, setAutoOpenNewEvent] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [isUploadScanOpen, setIsUploadScanOpen] = useState(false);

  const clientPath = clientId && firmId
    ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}`
    : null;

  const { data: client, loading, error } = useDocument<Client>(clientPath);

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-7 w-7 animate-spin text-[#2b6cb0]" />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800">
          Failed to load client: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  // ── 404 state ────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-24 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
          <User className="h-7 w-7 text-gray-400" />
        </div>
        <h2 className="text-lg font-semibold text-gray-700">Client Not Found</h2>
        <p className="mt-1 text-sm text-gray-400">
          No client with ID <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{clientId}</code> exists.
        </p>
        <Button
          variant="outline"
          className="mt-6 gap-2"
          onClick={() => navigate(ROUTES.CLIENTS)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Button>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const info = client.personalInfo;
  const spouse = client.spouseInfo;
  const pkg = client.packageDetails;
  const qProgress = client.questionnaireProgress;
  const isQuestionnaireComplete = qProgress?.status === 'completed';

  const clientFullName = [info?.firstName, info?.middleName, info?.lastName, info?.suffix]
    .filter(Boolean)
    .join(' ');

  const spouseFullName = spouse
    ? [spouse.firstName, spouse.middleName, spouse.lastName, spouse.suffix]
      .filter(Boolean)
      .join(' ')
    : null;

  const displayHeading = spouseFullName
    ? `${clientFullName} & ${spouseFullName}`
    : clientFullName || 'Client';

  const packageType = pkg?.packageType ?? 'foundation';
  const qStatusCfg = Q_STATUS_CONFIG[qProgress?.status ?? 'not_started'];
  const QIcon = qStatusCfg.icon;

  const handleSaveAudioNote = async (data: any) => {
    if (!userProfile?.uid || !firmId || !clientId) return;
    setIsSavingRecord(true);
    try {
      const collPath = COLLECTIONS.NOTES(firmId, clientId);
      const docRef = doc(collection(db, collPath));
      const activeNoteId = docRef.id;

      let audioUrl = null;
      let storagePath = null;
      let status = null;

      if (data.audioBlob) {
        const upload = await uploadAudioToStorage(data.audioBlob, firmId, clientId, activeNoteId);
        audioUrl = upload.url;
        storagePath = upload.fullPath;
        status = 'processing';
      }

      const newNote = {
        title: data.title || (data.audioBlob ? 'Audio Note' : 'Manual Note'),
        noteType: data.noteType,
        content: data.content,
        isPinned: false,
        isPrivate: false,
        audioUrl,
        audioStoragePath: storagePath,
        audioFileName: data.audioFileName,
        audioDurationSeconds: data.durationSeconds || undefined,
        transcriptionStatus: status,
        firmId,
        clientId,
        source: 'manual',
        createdBy: userProfile.uid,
        updatedBy: userProfile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(docRef, newNote);

      if (storagePath) {
        requestTranscription(firmId, clientId, activeNoteId, storagePath);
        toast.success('Note saved. Audio uploading and transcription started.');
      } else {
        toast.success('Note saved successfully.');
      }
    } catch (err) {
      console.error('Failed to save audio note', err);
      toast.error('Failed to save note.');
    } finally {
      setIsSavingRecord(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Back nav ──────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate(ROUTES.CLIENTS)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1a365d] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All Clients
      </button>

      {/* ── Client summary header ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          {/* Left: identity + meta */}
          <div className="flex gap-4">
            {/* Avatar */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ebf4ff] text-xl font-bold text-[#1a365d]">
              {clientFullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-[#1a365d]">{displayHeading}</h1>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs font-semibold capitalize',
                    PACKAGE_BADGE[packageType],
                  )}
                >
                  {PACKAGE_LABEL[packageType]} Package
                </Badge>
              </div>

              {/* Sub-info row */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                {info?.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    {info.email}
                  </span>
                )}
                {info?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {info.phone}
                  </span>
                )}
                {info?.city && info?.state && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {info.city}, {info.state}
                  </span>
                )}
              </div>

              {/* Status badges row */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Questionnaire status */}
                <div
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
                    qStatusCfg.bg,
                    qStatusCfg.color,
                  )}
                >
                  <QIcon className="h-3.5 w-3.5" />
                  Questionnaire: {qStatusCfg.label}
                </div>

                {/* Questionnaire % (if in progress) */}
                {qProgress?.status === 'in_progress' && qProgress.percentComplete > 0 && (
                  <div className="flex items-center gap-2">
                    <Progress
                      value={qProgress.percentComplete}
                      className="h-1.5 w-24"
                    />
                    <span className="text-xs text-gray-400">{qProgress.percentComplete}%</span>
                  </div>
                )}

                {/* Balance */}
                {pkg?.balanceDue != null && pkg.balanceDue > 0 && (
                  <div className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    <DollarSign className="h-3.5 w-3.5" />
                    Balance: {formatCurrency(pkg.balanceDue)}
                  </div>
                )}
                {(pkg?.balanceDue == null || pkg.balanceDue === 0) && (
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Paid in Full
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4 lg:mt-0">
            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
              disabled={isSending || !info?.email}
              onClick={async () => {
                if (!clientId || !firmId || !info?.email) {
                  toast.error('Client email is missing.');
                  return;
                }

                setIsSending(true);
                try {
                  const url = `${window.location.origin}/questionnaire/${firmId}/${clientId}`;
                  await documentService.sendQuestionnaireInvitation({
                    firmId,
                    clientId,
                    clientEmail: info.email,
                    clientName: displayHeading,
                    questionnaireUrl: url,
                  });
                  toast.success('Questionnaire invitation sent to the client.');
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Failed to send invitation.');
                } finally {
                  setIsSending(false);
                }
              }}
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send Questionnaire
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50"
              onClick={() => {
                if (!firmId || !clientId) return;
                navigate(`/questionnaire/${firmId}/${clientId}`);
              }}
            >
              <FileEdit className="h-4 w-4" />
              {qProgress?.status === 'completed'
                ? 'View Questionnaire'
                : qProgress?.status === 'in_progress'
                  ? 'Continue Questionnaire'
                  : 'Start Questionnaire'}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-gray-600"
              onClick={() => {
                if (!firmId || !clientId) return;
                window.open(`/questionnaire/${firmId}/${clientId}/print`, '_blank');
              }}
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
              onClick={() => setIsUploadScanOpen(true)}
            >
              <UploadCloud className="h-4 w-4" />
              Upload Scan
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
              onClick={() => setIsRecordModalOpen(true)}
            >
              <Mic className="h-4 w-4" />
              Record Note
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-gray-600"
              onClick={() => {
                setAutoOpenNewNote(true);
                setActiveTab('notes');
              }}
            >
              <StickyNote className="h-4 w-4" />
              New Note
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-2 text-gray-600"
              onClick={() => {
                setAutoOpenNewEvent(true);
                setActiveTab('calendar');
              }}
            >
              <CalendarPlus className="h-4 w-4" />
              Schedule
            </Button>

            <Button
              size="sm"
              className="gap-2 bg-[#1a365d] hover:bg-[#1e407a] text-white"
              onClick={() => setActiveTab('documents')}
            >
              <FileText className="h-4 w-4" />
              Documents
            </Button>
          </div>
        </div>

        {/* Generate docs prompt if questionnaire complete but no docs generated yet */}
        {isQuestionnaireComplete && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <GenerateDocumentsButton
                  firmId={firmId}
                  clientId={clientId ?? ''}
                  packageType={packageType}
                  trustTypes={client.trusts?.map((t) => t.trustType)}
                  clientName={displayHeading}
                  disabled={!isQuestionnaireComplete}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Five-tab content ───────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-1 rounded-xl bg-gray-100/80 p-1">
          <TabsTrigger
            value="info"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <LayoutDashboard className="h-4 w-4" />
            Client Information
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <FileText className="h-4 w-4" />
            Document Vault
          </TabsTrigger>
          <TabsTrigger
            value="notes"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <MessageSquare className="h-4 w-4" />
            Notes
          </TabsTrigger>
          <TabsTrigger
            value="payments"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <DollarSign className="h-4 w-4" />
            Payments
          </TabsTrigger>
          <TabsTrigger
            value="calendar"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </TabsTrigger>
          <TabsTrigger
            value="tasks"
            className="gap-2 data-[state=active]:bg-white data-[state=active]:text-[#1a365d] data-[state=active]:shadow-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            Tasks
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Client Information ──────────────────────────────────── */}
        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Personal info */}
            <InfoCard title="Personal Information" icon={User} iconColor="text-[#2b6cb0]">
              <InfoRow label="Full Name" value={clientFullName} />
              <InfoRow label="Date of Birth" value={formatDate(info?.dob)} />
              <InfoRow label="Email" value={info?.email} />
              <InfoRow label="Phone" value={info?.phone} />
              {info?.alternatePhone && (
                <InfoRow label="Alt. Phone" value={info.alternatePhone} />
              )}
              <InfoRow label="Address" value={info ? `${info.address}, ${info.city}, ${info.state} ${info.zip}` : undefined} />
              <InfoRow label="County" value={info?.county} />
              <InfoRow label="Marital Status" value={info?.maritalStatus} />
              <InfoRow label="Citizenship" value={info?.citizenship} />
              {info?.occupation && <InfoRow label="Occupation" value={info.occupation} />}
              {info?.employer && <InfoRow label="Employer" value={info.employer} />}
            </InfoCard>

            {/* Spouse info */}
            {spouse && (
              <InfoCard title="Spouse / Partner" icon={Users} iconColor="text-purple-500">
                <InfoRow
                  label="Full Name"
                  value={[spouse.firstName, spouse.middleName, spouse.lastName, spouse.suffix]
                    .filter(Boolean)
                    .join(' ')}
                />
                <InfoRow label="Date of Birth" value={formatDate(spouse.dob)} />
                <InfoRow label="Email" value={spouse.email} />
                <InfoRow label="Phone" value={spouse.phone} />
                <InfoRow label="Address" value={`${spouse.address}, ${spouse.city}, ${spouse.state} ${spouse.zip}`} />
                <InfoRow label="Citizenship" value={spouse.citizenship} />
                {spouse.separateRepresentation && (
                  <InfoRow label="Representation" value="Separate counsel" />
                )}
              </InfoCard>
            )}

            {/* Children */}
            {client.children && client.children.length > 0 && (
              <InfoCard
                title={`Children (${client.children.length})`}
                icon={Baby}
                iconColor="text-teal-500"
              >
                {client.children.map((child) => (
                  <div key={child.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">{child.name}</span>
                      {child.isMinor && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Minor
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                      <div>DOB: {formatDate(child.dob)}</div>
                      <div>Relationship: {child.relationship}</div>
                      {child.guardian && <div>Guardian: {child.guardian}</div>}
                      {child.specialNeeds && (
                        <div className="text-amber-600">Special needs — see notes</div>
                      )}
                    </div>
                  </div>
                ))}
              </InfoCard>
            )}

            {/* Package details */}
            <InfoCard title="Package & Matter" icon={Briefcase} iconColor="text-[#1a365d]">
              <InfoRow label="Package" value={PACKAGE_LABEL[packageType]} />
              <InfoRow label="Engagement Date" value={formatDate(pkg?.engagementDate)} />
              <InfoRow label="Estimated Fee" value={formatCurrency(pkg?.estimatedFee)} />
              <InfoRow label="Retainer Paid" value={formatCurrency(pkg?.retainerPaid)} />
              <InfoRow label="Balance Due" value={formatCurrency(pkg?.balanceDue)} />
              <InfoRow
                label="Documents"
                value={
                  pkg?.documentsIncluded?.length
                    ? `${pkg.documentsIncluded.length} documents`
                    : undefined
                }
              />
            </InfoCard>

            {/* Fiduciaries */}
            {client.fiduciaries && (
              <InfoCard title="Fiduciary Appointments" icon={Heart} iconColor="text-rose-400">
                {client.fiduciaries.executor && (
                  <>
                    <InfoRow
                      label="Executor"
                      value={client.fiduciaries.executor.primary?.name}
                    />
                    {client.fiduciaries.executor.alternate && (
                      <InfoRow
                        label="Alt. Executor"
                        value={client.fiduciaries.executor.alternate.name}
                      />
                    )}
                  </>
                )}
                {client.fiduciaries.powerOfAttorney && (
                  <InfoRow
                    label="POA Agent"
                    value={client.fiduciaries.powerOfAttorney.agent?.name}
                  />
                )}
                {client.fiduciaries.healthcareProxy && (
                  <InfoRow
                    label="HC Proxy"
                    value={client.fiduciaries.healthcareProxy.agent?.name}
                  />
                )}
                {client.fiduciaries.trustee && (
                  <InfoRow
                    label="Trustee"
                    value={client.fiduciaries.trustee.primary?.name}
                  />
                )}
                {client.fiduciaries.guardian && (
                  <InfoRow
                    label="Guardian"
                    value={client.fiduciaries.guardian.primary?.name}
                  />
                )}
              </InfoCard>
            )}

            {/* Trusts */}
            {client.trusts && client.trusts.length > 0 && (
              <InfoCard
                title={`Trusts (${client.trusts.length})`}
                icon={Building2}
                iconColor="text-indigo-500"
              >
                {client.trusts.map((trust) => (
                  <div key={trust.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-700">{trust.trustName}</p>
                    <p className="text-xs text-gray-500">{trust.trustType}</p>
                    {trust.trustees?.primary && (
                      <p className="mt-1 text-xs text-gray-500">
                        Trustee: {trust.trustees.primary.name}
                      </p>
                    )}
                  </div>
                ))}
              </InfoCard>
            )}

            {/* Questionnaire progress */}
            <InfoCard title="Questionnaire Progress" icon={Sparkles} iconColor="text-[#2b6cb0]">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
                      qStatusCfg.bg,
                      qStatusCfg.color,
                    )}
                  >
                    <QIcon className="h-3.5 w-3.5" />
                    {qStatusCfg.label}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">
                    {qProgress?.percentComplete ?? 0}%
                  </span>
                </div>
                <Progress value={qProgress?.percentComplete ?? 0} className="h-2" />
                {qProgress?.sectionsCompleted?.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-500">
                      Sections completed ({qProgress.sectionsCompleted.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {qProgress.sectionsCompleted.map((section) => (
                        <span
                          key={section}
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        >
                          {section}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </InfoCard>
          </div>

          {/* Special considerations callout */}
          {client.specialConsiderations && (
            (() => {
              const sc = client.specialConsiderations;
              const flags = [
                sc.hasSpecialNeedsChild && 'Special Needs Child',
                sc.hasBlendedFamily && 'Blended Family',
                sc.hasMedicaidPlanning && 'Medicaid Planning',
                sc.hasCharitableGoals && 'Charitable Goals',
                sc.hasPetProvision && 'Pet Provision',
                sc.hasInternationalAssets && 'International Assets',
                sc.hasBusinessSuccession && 'Business Succession',
              ].filter(Boolean);

              return flags.length > 0 ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-sm text-amber-800">
                    <span className="font-semibold">Special Considerations: </span>
                    {flags.join(' · ')}
                  </AlertDescription>
                </Alert>
              ) : null;
            })()
          )}
        </TabsContent>

        {/* ── Tab 2: Document Vault ──────────────────────────────────────── */}
        <TabsContent value="documents">
          <DocumentVault
            firmId={firmId}
            clientId={clientId ?? ''}
            clientName={displayHeading}
            packageType={packageType}
            trustTypes={client.trusts?.map((t) => t.trustType)}
            questionnaireComplete={isQuestionnaireComplete}
          />
        </TabsContent>

        {/* ── Tab 3: Notes ──────────────────────────────────────────────── */}
        <TabsContent value="notes">
          <NotesTab
            firmId={firmId}
            clientId={clientId ?? ''}
            autoOpenNewNote={autoOpenNewNote}
          />
        </TabsContent>

        {/* ── Tab 4: Payments ───────────────────────────────────────────── */}
        <TabsContent value="payments">
          <PaymentsTab
            firmId={firmId}
            clientId={clientId ?? ''}
            clientEmail={info?.email}
            clientName={displayHeading}
          />
        </TabsContent>

        {/* ── Tab 5: Calendar ───────────────────────────────────────────── */}
        <TabsContent value="calendar">
          <CalendarTab
            firmId={firmId}
            clientId={clientId ?? ''}
            clientName={displayHeading}
            autoOpenNewEvent={autoOpenNewEvent}
          />
        </TabsContent>

        {/* ── Tab 6: Tasks ──────────────────────────────────────────────── */}
        <TabsContent value="tasks">
          <TasksList
            clientId={clientId ?? ''}
            clientName={displayHeading}
          />
        </TabsContent>
      </Tabs>

      <AudioRecorderModal
        open={isRecordModalOpen}
        onOpenChange={setIsRecordModalOpen}
        onSave={handleSaveAudioNote}
        isSaving={isSavingRecord}
        defaultClientId={clientId}
      />

      <UploadScanModal
        open={isUploadScanOpen}
        onOpenChange={setIsUploadScanOpen}
        firmId={firmId || ''}
        clientId={clientId || ''}
      />
    </div>
  );
}

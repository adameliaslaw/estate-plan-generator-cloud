/**
 * QuestionnaireShell
 *
 * Main questionnaire container layout.
 *
 * Three-phase flow:
 *   1. questionnaire — all QUESTIONNAIRE_STEPS (with skip logic)
 *   2. package       — PackageSelector (after last step is completed)
 *   3. complete      — QuestionnaireComplete (after package selection)
 *
 * Per-phase:
 * - Progress bar at top with section name and percentage
 * - Estimated time remaining below progress
 * - Section transition header when entering a new section
 * - Current step rendered by StepRenderer
 * - Back / Next navigation buttons
 * - Keyboard support (Enter to advance, Escape to go back)
 * - Smooth fade transition between steps
 * - Mobile responsive
 * - Auto-save indicator
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Save,
  CheckCircle2,
  Pencil,
  User,
  Users,
  Building2,
  Shield,
  Info,
  Circle,
} from 'lucide-react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { documentService } from '@/services/document-service';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

import { useQuestionnaire } from '@/contexts/QuestionnaireContext';
import { SECTION_META } from '@/types/questionnaire';
import { StepRenderer } from './StepRenderer';
import { PackageSelector } from './PackageSelector';
import { QuestionnaireComplete } from './QuestionnaireComplete';
import { QuestionnaireUploader } from './QuestionnaireUploader';
import { cn } from '@/lib/utils';
import type { PackageType } from '@/types';
import { logSystemActivity } from '@/utils/activity-logger';

// ============================================================================
// Phase type
// ============================================================================

type Phase = 'questionnaire' | 'package' | 'complete';

// ============================================================================
// Edit-mode banner + navigator
// ============================================================================

interface EditModeBannerProps {
  onSaveAndClose: () => void;
  isSaving: boolean;
  showNav: boolean;
  onToggleNav: () => void;
}

function EditModeBanner({ onSaveAndClose, isSaving, showNav, onToggleNav }: EditModeBannerProps) {
  return (
    <div className="sticky top-0 z-20 bg-amber-50 border-b-2 border-amber-400">
      <div className="mx-auto max-w-4xl px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Pencil className="h-4 w-4 text-amber-700 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            Edit Mode — you are editing a completed questionnaire
          </p>
          <button
            onClick={onToggleNav}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200', showNav && 'rotate-90')} />
            {showNav ? 'Hide Navigator' : 'Jump to Section'}
          </button>
        </div>
        <button
          onClick={onSaveAndClose}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-60 shrink-0"
        >
          {isSaving ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save & Close
        </button>
      </div>
    </div>
  );
}

// Section-icon map for the navigator
const SECTION_ICON_COMPONENTS: Record<string, React.ComponentType<{ className?: string }>> = {
  User,
  Heart: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Users,
  Building: Building2,
  CreditCard: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  Shield,
  Gift: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  ),
  HeartPulse: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l1.5-3 2 6 1.5-3 .5 2h5.78" />
    </svg>
  ),
  Info,
};

interface EditModeNavigatorProps {
  visibleSteps: ReturnType<typeof useQuestionnaire>['visibleSteps'];
  currentStep: number;
  isStepComplete: (id: string) => boolean;
  goToStep: (index: number) => void;
}

function EditModeNavigator({ visibleSteps, currentStep, isStepComplete, goToStep }: EditModeNavigatorProps) {
  const [openSection, setOpenSection] = useState<string | null>(
    // Default: expand the section containing the current step
    visibleSteps[currentStep]?.section ?? null,
  );

  const sections = SECTION_META.filter((s) => visibleSteps.some((vs) => vs.section === s.id));

  return (
    <div className="bg-white border-b border-amber-200 shadow-sm">
      <div className="mx-auto max-w-4xl px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {sections.map((section) => {
            const sectionSteps = visibleSteps
              .map((step, idx) => ({ step, idx }))
              .filter(({ step }) => step.section === section.id);
            const completedCount = sectionSteps.filter(({ step }) => isStepComplete(step.id)).length;
            const isCurrentSection = sectionSteps.some(({ idx }) => idx === currentStep);
            const IconComp = SECTION_ICON_COMPONENTS[section.icon] ?? Info;
            const isOpen = openSection === section.id;

            return (
              <div key={section.id} className="flex flex-col">
                {/* Section header button */}
                <button
                  onClick={() => setOpenSection(isOpen ? null : section.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-all',
                    isCurrentSection
                      ? 'border-[#1a365d] bg-[#ebf4ff] text-[#1a365d]'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100',
                  )}
                >
                  <IconComp className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate leading-tight">{section.title}</span>
                  <span className={cn(
                    'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    completedCount === sectionSteps.length
                      ? 'bg-emerald-100 text-emerald-700'
                      : isCurrentSection
                        ? 'bg-[#1a365d]/10 text-[#1a365d]'
                        : 'bg-gray-200 text-gray-500',
                  )}>
                    {completedCount}/{sectionSteps.length}
                  </span>
                </button>

                {/* Step list (expanded) */}
                {isOpen && (
                  <div className="mt-1 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {sectionSteps.map(({ step, idx }) => {
                      const isCurrent = idx === currentStep;
                      const isDone = isStepComplete(step.id);
                      return (
                        <button
                          key={step.id}
                          onClick={() => goToStep(idx)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-all',
                            isCurrent
                              ? 'border-[#1a365d] bg-[#1a365d] text-white font-semibold'
                              : isDone
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                : 'border-gray-100 bg-white text-gray-600 hover:bg-gray-50',
                          )}
                        >
                          {isDone && !isCurrent ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                          ) : (
                            <Circle className="h-3 w-3 shrink-0 opacity-40" />
                          )}
                          <span className="leading-tight">{step.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// Progress bar component
// ============================================================================

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full bg-[#1a365d] rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.max(2, value)}%` }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ============================================================================
// Section transition banner
// ============================================================================

function SectionBanner({ section }: { section: typeof SECTION_META[number] }) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    // If section changes, remount animation by clearing and resetting
    const t = setTimeout(() => setShow(false), 2500);
    return () => clearTimeout(t);
  }, [section.id]);

  if (!show) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-[#1a365d]/20 bg-[#ebf4ff] px-5 py-4 mb-6',
        'animate-in fade-in slide-in-from-top-2 duration-300',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a365d] text-white">
        <span className="text-sm font-semibold">{section.estimatedMinutes}m</span>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-[#1a365d]/60">
          New section
        </p>
        <p className="text-base font-semibold text-[#1a365d]">{section.title}</p>
        <p className="text-sm text-[#1a365d]/70">{section.description}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Section dots / step indicator
// ============================================================================

function StepDots() {
  const { visibleSteps, currentStep, isStepComplete, goToStep } = useQuestionnaire();

  // Group by section and show section progress dots (max 9 dots for sections)
  const sections = SECTION_META.filter((s) =>
    visibleSteps.some((vs) => vs.section === s.id),
  );

  return (
    <div className="flex items-center gap-1.5 justify-center flex-wrap">
      {sections.map((section) => {
        const sectionSteps = visibleSteps.filter((s) => s.section === section.id);
        const firstIdx = visibleSteps.findIndex((s) => s.section === section.id);
        const isCurrent = sectionSteps.some(
          (_, i) => firstIdx + i === currentStep,
        );
        const isCompleted = sectionSteps.every((s) => isStepComplete(s.id));

        return (
          <button
            key={section.id}
            onClick={() => goToStep(firstIdx)}
            className={cn(
              'h-2 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d]',
              isCurrent ? 'w-8 bg-[#1a365d]' : isCompleted ? 'w-2 bg-[#1a365d]/50' : 'w-2 bg-gray-300',
            )}
            aria-label={`Jump to ${section.title}`}
            title={section.title}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Thank-you / submitted state
// ============================================================================

function ThankYouScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-[#1a365d]">
          Successfully Submitted!
        </h2>
        <p className="text-gray-600">
          Thank you for completing your estate planning questionnaire. Your attorney will review
          your information and reach out to schedule your next appointment.
        </p>
        <p className="text-sm text-gray-400">
          You may close this window at any time.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main shell
// ============================================================================

interface QuestionnaireShellProps {
  isEditMode?: boolean;
}

export function QuestionnaireShell({ isEditMode = false }: QuestionnaireShellProps) {
  const {
    currentStepDef,
    currentStep,
    totalSteps,
    progress,
    estimatedMinutesRemaining,
    currentSection,
    isLoading,
    isSaving,
    canProceed,
    goNext,
    goBack,
    goToStep,
    saveProgress,
    visibleSteps,
    isStepComplete,
    data,
  } = useQuestionnaire();

  const { firmId, clientId } = useParams<{ firmId: string; clientId: string }>();
  const { userProfile } = useAuth();
  const navigate = useNavigate();

  // ── Phase state ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('questionnaire');
  const [showNav, setShowNav] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<PackageType | null>(null);
  const [selectedTrustType, setSelectedTrustType] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);

  // ── Edit-mode: snapshot initial data to detect which sections changed ─────
  // Captured once after loading completes so we have a baseline to diff against.
  const initialDataSnapshot = useRef<string | null>(null);
  useEffect(() => {
    if (isEditMode && !isLoading && initialDataSnapshot.current === null) {
      initialDataSnapshot.current = JSON.stringify(data);
    }
  }, [isEditMode, isLoading, data]);

  const prevSectionRef = useRef<string | null>(null);
  const [showSectionBanner, setShowSectionBanner] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);

  const currentSectionMeta = SECTION_META.find((s) => s.id === currentSection) ?? SECTION_META[0];

  useEffect(() => {
    if (prevSectionRef.current && prevSectionRef.current !== currentSection) {
      setShowSectionBanner(true);
    }
    prevSectionRef.current = currentSection;
    setFadeKey((k) => k + 1);
  }, [currentStep, currentSection]);

  // ── Detect questionnaire completion ───────────────────────────────────────
  // When all steps are done (currentStepDef is null after loading), advance to package phase
  // In edit mode, skip this transition so staff can navigate all steps freely.
  const allStepsDone = !isEditMode && !isLoading && !currentStepDef && phase === 'questionnaire';

  useEffect(() => {
    if (allStepsDone) {
      setPhase('package');
    }
  }, [allStepsDone]);

  // ── Keyboard navigation (only during questionnaire phase) ─────────────────
  useEffect(() => {
    if (phase !== 'questionnaire') return;

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isTextArea = tag === 'textarea';
      const isEditable = (e.target as HTMLElement)?.isContentEditable;

      if (e.key === 'Enter' && !isTextArea && !isEditable) {
        e.preventDefault();
        if (canProceed) goNext();
      }
      if (e.key === 'Escape') {
        goBack();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, canProceed, goNext, goBack]);

  // ── Handle "Next" on last step ────────────────────────────────────────────
  // Override goNext on the last step to also call save and transition phase
  const isLastStep = currentStep === totalSteps - 1;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      goNext(); // marks the last step as complete
      setPhase('package'); // explicitly transition to the next phase
    } else {
      goNext();
    }
  }, [goNext, isLastStep]);

  // ── Package selection → complete phase ────────────────────────────────────
  function handlePackageContinue(pkg: PackageType, trustType?: string) {
    setSelectedPackage(pkg);
    setSelectedTrustType(trustType);
    setPhase('complete');
  }

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit() {
    try {
      if (!firmId || !clientId) throw new Error('Missing route params');

      // Save final state to Firestore with completed status and selected package
      await saveProgress();

      const updaterName = userProfile?.role === 'client'
        ? 'Client'
        : `Admin (${userProfile?.displayName || userProfile?.email || 'Unknown'})`;

      // Update progress explicitly to completed
      const docRef = doc(db, `firms/${firmId}/clients/${clientId}`);
      await updateDoc(docRef, {
        'questionnaireProgress.status': 'completed',
        'questionnaireProgress.lastUpdatedBy': updaterName,
        'questionnaireProgress.lastUpdatedAt': serverTimestamp(),
      });

      // Send the firm notification (wrap in try/catch to prevent blocking if email fails)
      const clientName = `${data.personalInfo?.firstName || 'Client'} ${data.personalInfo?.lastName || ''}`.trim() || 'A Client';

      try {
        const attorneyEmail = userProfile?.role === 'attorney'
          ? userProfile.email
          : 'info@adameliaslaw.com'; // fallback to firm email

        await documentService.sendQuestionnaireCompleteNotification({
          firmId,
          clientId,
          clientName,
          attorneyEmail,
        });
      } catch (notifyErr) {
        console.warn('Failed to send complete notification, but questionnaire was saved.', notifyErr);
        // We still want to show the success screen even if the email notification fails.
      }

      try {
        await logSystemActivity(firmId, userProfile, 'completing questionnaire', {
          clientName
        });
      } catch (logErr) {
        console.warn('Failed to log activity, but questionnaire was saved.', logErr);
      }

      setSubmitted(true);
      toast.success('Questionnaire submitted successfully');
    } catch (err) {
      console.error('Submit error:', err);
      toast.error('Failed to submit questionnaire');
    }
  }

  // ── Edit-mode save & close ────────────────────────────────────────────────
  // After saving, explicitly re-stamp status as 'completed' since performSave
  // always writes 'in_progress'. No client notifications fire here —
  // sendQuestionnaireCompleteNotification is only called from handleSubmit.
  async function handleSaveAndClose() {
    try {
      if (!firmId || !clientId) throw new Error('Missing route params');
      await saveProgress();

      const updaterName = `Admin (${userProfile?.displayName || userProfile?.email || 'Unknown'})`;
      await updateDoc(doc(db, `firms/${firmId}/clients/${clientId}`), {
        'questionnaireProgress.status': 'completed',
        'questionnaireProgress.lastUpdatedBy': updaterName,
        'questionnaireProgress.lastUpdatedAt': serverTimestamp(),
      });

      try {
        const clientName = data.personalInfo
          ? `${data.personalInfo.firstName ?? ''} ${data.personalInfo.lastName ?? ''}`.trim()
          : 'Unknown';

        // Map section titles → the QuestionnaireData fields they own,
        // so we can diff the snapshot and report exactly what changed.
        const SECTION_FIELDS: Record<string, string[]> = {
          'About You':              ['personalInfo', 'isFemale', 'referralSource'],
          'Spouse / Partner':       ['spouseInfo'],
          'Children & Dependents':  ['hasChildren', 'numberOfChildren', 'children', 'hasOtherDependents', 'otherDependents', 'guardianPrimary', 'guardianAlternate'],
          'Assets':                 ['assets'],
          'Liabilities':            ['liabilities'],
          'Fiduciaries':            ['fiduciaries'],
          'Wishes':                 ['distributionPlan', 'distribution'],
          'Healthcare Preferences': ['healthcarePreferences', 'burialPreference', 'burialDetails'],
          'Additional Information': ['additionalNotes', 'hasExistingDocuments', 'existingDocumentsDetails', 'existingDocumentsDate', 'hasPendingLegalMatters', 'pendingLegalDetails'],
        };

        const changedSections: string[] = [];
        if (initialDataSnapshot.current) {
          const before = JSON.parse(initialDataSnapshot.current) as Record<string, unknown>;
          const after = data as unknown as Record<string, unknown>;
          for (const [sectionTitle, fields] of Object.entries(SECTION_FIELDS)) {
            if (fields.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]))) {
              changedSections.push(sectionTitle);
            }
          }
        }

        const action = changedSections.length > 0
          ? `editing questionnaire — changed: ${changedSections.join(', ')}`
          : 'editing questionnaire';

        await logSystemActivity(firmId, userProfile, action, {
          clientId,
          clientName: clientName || 'Unknown',
          changedSections,
        });
      } catch {
        // Non-fatal — save still succeeded
      }

      toast.success('Questionnaire changes saved.');
      navigate(-1);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save changes.');
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#1a365d] border-t-transparent" />
          <p className="text-sm text-gray-500">Loading your questionnaire…</p>
        </div>
      </div>
    );
  }

  // ── Submitted ─────────────────────────────────────────────────────────────
  // In edit mode, staff never see the thank-you screen.

  if (submitted && !isEditMode) {
    return <ThankYouScreen />;
  }

  // ── Package phase ─────────────────────────────────────────────────────────

  if (phase === 'package') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <PackageSelector onContinue={handlePackageContinue} />
        </div>
      </div>
    );
  }

  // ── Complete / review phase ───────────────────────────────────────────────

  if (phase === 'complete' && selectedPackage) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <QuestionnaireComplete
            selectedPackage={selectedPackage}
            selectedTrustType={selectedTrustType}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    );
  }

  // ── Questionnaire phase ───────────────────────────────────────────────────

  // If currentStepDef is null here (phase is still 'questionnaire' but steps
  // are exhausted before the effect fires), show a brief loading state.
  if (!currentStepDef) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[#1a365d] border-t-transparent" />
      </div>
    );
  }

  const isFirstStep = currentStep === 0;
  const stepNumber = currentStep + 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {isEditMode && (
        <>
          <EditModeBanner
            onSaveAndClose={() => void handleSaveAndClose()}
            isSaving={isSaving}
            showNav={showNav}
            onToggleNav={() => setShowNav((v) => !v)}
          />
          {showNav && (
            <EditModeNavigator
              visibleSteps={visibleSteps}
              currentStep={currentStep}
              isStepComplete={isStepComplete}
              goToStep={goToStep}
            />
          )}
        </>
      )}
      {/* ── Top header: progress + meta ────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {/* Section name + step counter */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1a365d]">
                {currentSectionMeta.title}
              </span>
            </div>
            <div className="flex w-full sm:w-auto items-center justify-between sm:justify-end gap-3">
              {/* File Uploader */}
              <div className="mr-0 sm:mr-2">
                <QuestionnaireUploader />
              </div>
              <div className="flex items-center gap-3">
                {/* Auto-save indicator */}
                {isSaving ? (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Save className="h-3 w-3 animate-pulse" />
                    <span className="hidden sm:inline">Saving…</span>
                  </span>
                ) : (
                  <button
                    onClick={() => void saveProgress()}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#1a365d] transition-colors"
                    title="Save progress"
                  >
                    <Save className="h-3 w-3" />
                    <span className="hidden sm:inline">Saved</span>
                  </button>
                )}
                <span className="text-xs text-gray-400 rounded-full bg-gray-100 px-2 py-0.5 whitespace-nowrap">
                  {stepNumber} / {totalSteps}
                </span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <ProgressBar value={progress} />

          {/* Time remaining */}
          {estimatedMinutesRemaining > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3 w-3" />
              <span>
                About {estimatedMinutesRemaining} minute
                {estimatedMinutesRemaining !== 1 ? 's' : ''} remaining
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Section transition banner */}
        {showSectionBanner && <SectionBanner section={currentSectionMeta} />}

        {/* Step content — fades on step change */}
        <div
          key={fadeKey}
          className="animate-in fade-in duration-200"
        >
          {/* Step header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#1a365d] leading-tight sm:text-3xl">
              {currentStepDef.title}
            </h1>
            {currentStepDef.subtitle && (
              <p className="mt-2 text-base text-gray-500 leading-relaxed">
                {currentStepDef.subtitle}
              </p>
            )}
          </div>

          {/* Fields */}
          <StepRenderer step={currentStepDef} />
        </div>

        {/* ── Navigation buttons ─────────────────────────────────────── */}
        <div className="mt-10 flex items-center justify-between gap-4">
          <button
            onClick={goBack}
            disabled={isFirstStep}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700',
              'transition-all hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d]',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {/* Step dots */}
          <div className="flex-1">
            <StepDots />
          </div>

          <button
            onClick={handleNext}
            disabled={!canProceed}
            className={cn(
              'flex items-center gap-2 rounded-lg bg-[#1a365d] px-6 py-3 text-sm font-semibold text-white',
              'transition-all hover:bg-[#2b4a7a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
              'disabled:pointer-events-none disabled:opacity-50',
              'shadow-sm',
            )}
          >
            {isLastStep ? 'Review Plan' : 'Next'}
            {!isLastStep && <ChevronRight className="h-4 w-4" />}
            {isLastStep && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="mt-4 text-center text-xs text-gray-400">
          Press <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd> to continue
        </p>
      </div>
    </div>
  );
}

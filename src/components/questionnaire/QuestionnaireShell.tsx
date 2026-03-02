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
import { useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Save,
  CheckCircle2,
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

// ============================================================================
// Phase type
// ============================================================================

type Phase = 'questionnaire' | 'package' | 'complete';

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

export function QuestionnaireShell() {
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
    saveProgress,
    data,
  } = useQuestionnaire();

  const { firmId, clientId } = useParams<{ firmId: string; clientId: string }>();
  const { userProfile } = useAuth();

  // ── Phase state ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('questionnaire');
  const [selectedPackage, setSelectedPackage] = useState<PackageType | null>(null);
  const [selectedTrustType, setSelectedTrustType] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);

  // ── Section banner / fade ─────────────────────────────────────────────────
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
  const allStepsDone = !isLoading && !currentStepDef && phase === 'questionnaire';

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

      // Send the firm notification
      const attorneyEmail = userProfile?.role === 'attorney'
        ? userProfile.email
        : 'admin@firm.com'; // fallback if no specific attorney mapping exists yet

      const clientName = `${data.personalInfo?.firstName || 'Client'} ${data.personalInfo?.lastName || ''}`.trim() || 'A Client';

      await documentService.sendQuestionnaireCompleteNotification({
        firmId,
        clientId,
        clientName,
        attorneyEmail,
      });

      setSubmitted(true);
      toast.success('Questionnaire submitted successfully');
    } catch (err) {
      console.error('Submit error:', err);
      toast.error('Failed to submit questionnaire');
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

  if (submitted) {
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

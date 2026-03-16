/**
 * QuestionnaireContext
 *
 * Provides full state management for the multi-step questionnaire flow.
 * - useReducer for predictable state transitions
 * - Debounced auto-save to Firestore (2 second delay)
 * - Skip logic: recompute visibleSteps whenever data changes
 * - Progress calculation: completed steps / total visible steps
 * - Section progress per section
 * - Estimated time remaining
 * - Dot-path field updates (e.g. "personalInfo.firstName")
 * - Resume from Firestore on mount
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { doc, getDoc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import {
  QUESTIONNAIRE_STEPS,
  SECTION_META,
  createEmptyQuestionnaireData,
} from '@/types/questionnaire';
import type {
  QuestionnaireData,
  QuestionnaireSection,
  QuestionnaireStep,
  StepCondition,
} from '@/types/questionnaire';

// ============================================================================
// Utility: dot-path get / set
// ============================================================================

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.');
  const result = { ...obj };
  let cursor: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] =
      next != null && typeof next === 'object' && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1]] = value;
  return result;
}

// ============================================================================
// Condition evaluation (skip logic)
// ============================================================================

export function evaluateCondition(
  condition: StepCondition,
  data: QuestionnaireData,
): boolean {
  const value = getNestedValue(data as unknown as Record<string, unknown>, condition.field);

  switch (condition.operator) {
    case 'equals':
      return value === condition.value;
    case 'notEquals':
      return value !== condition.value;
    case 'includes':
      if (Array.isArray(condition.value)) {
        return condition.value.includes(value);
      }
      if (Array.isArray(value)) {
        return value.includes(condition.value);
      }
      return false;
    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value > condition.value
        : false;
    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number'
        ? value < condition.value
        : false;
    case 'exists':
      return value != null && value !== '' && value !== false;
    case 'notExists':
      return value == null || value === '' || value === false;
    default:
      return true;
  }
}

// ============================================================================
// Reducer
// ============================================================================

interface QuestionnaireState {
  data: QuestionnaireData;
  currentStep: number;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

type QuestionnaireAction =
  | { type: 'SET_DATA'; payload: Partial<QuestionnaireData> }
  | { type: 'UPDATE_FIELD'; path: string; value: unknown }
  | { type: 'UPDATE_FIELDS'; updates: Record<string, unknown> }
  | { type: 'SET_STEP'; index: number }
  | { type: 'SET_SAVING'; value: boolean }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SET_ERROR'; message: string | null };

function questionnaireReducer(
  state: QuestionnaireState,
  action: QuestionnaireAction,
): QuestionnaireState {
  switch (action.type) {
    case 'SET_DATA':
      return { ...state, data: { ...state.data, ...action.payload } };

    case 'UPDATE_FIELD': {
      const updated = setNestedValue(
        state.data as unknown as Record<string, unknown>,
        action.path,
        action.value,
      ) as unknown as QuestionnaireData;
      return { ...state, data: updated };
    }

    case 'UPDATE_FIELDS': {
      let data = state.data as unknown as Record<string, unknown>;
      for (const [path, value] of Object.entries(action.updates)) {
        data = setNestedValue(data, path, value);
      }
      return { ...state, data: data as unknown as QuestionnaireData };
    }

    case 'SET_STEP':
      return { ...state, currentStep: action.index };

    case 'SET_SAVING':
      return { ...state, isSaving: action.value };

    case 'SET_LOADING':
      return { ...state, isLoading: action.value };

    case 'SET_ERROR':
      return { ...state, error: action.message };

    default:
      return state;
  }
}

// ============================================================================
// Context type
// ============================================================================

interface QuestionnaireContextValue {
  // Data
  data: QuestionnaireData;
  // Navigation
  currentStep: number;
  visibleSteps: QuestionnaireStep[];
  totalSteps: number;
  currentStepDef: QuestionnaireStep | null;
  currentSection: QuestionnaireSection;
  // Progress
  progress: number;
  estimatedMinutesRemaining: number;
  sectionProgress: Record<QuestionnaireSection, number>;
  // Status
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  canProceed: boolean;
  // Field operations
  updateField: (path: string, value: unknown) => void;
  updateFields: (updates: Record<string, unknown>) => void;
  // Navigation
  goToStep: (index: number) => void;
  goNext: () => void;
  goBack: () => void;
  // Step helpers
  isStepComplete: (stepId: string) => boolean;
  // Save
  saveProgress: () => Promise<void>;
}

const QuestionnaireContext = createContext<QuestionnaireContextValue | null>(null);

// ============================================================================
// Provider props
// ============================================================================

interface QuestionnaireProviderProps {
  firmId: string;
  clientId: string;
  children: React.ReactNode;
}

// ============================================================================
// Provider
// ============================================================================

export function QuestionnaireProvider({
  firmId,
  clientId,
  children,
}: QuestionnaireProviderProps) {
  const { userProfile } = useAuth();

  const [state, dispatch] = useReducer(questionnaireReducer, {
    data: createEmptyQuestionnaireData(),
    currentStep: 0,
    isLoading: true,
    isSaving: false,
    error: null,
  });

  // Ref to hold the debounce timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track if there's a pending save so we can flush on unmount
  const pendingSaveRef = useRef(false);
  // Firestore document path
  const docPath = `firms/${firmId}/clients/${clientId}`;

  // ── Load existing data on mount ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      dispatch({ type: 'SET_LOADING', value: true });
      try {
        const snap = await getDoc(doc(db, docPath));
        if (cancelled) return;

        if (snap.exists()) {
          const raw = snap.data();
          // Merge questionnaire-specific fields from the client document
          const partial: Partial<QuestionnaireData> = {};

          const qFields: (keyof QuestionnaireData)[] = [
            'personalInfo',
            'spouseInfo',
            'hasChildren',
            'numberOfChildren',
            'children',
            'hasOtherDependents',
            'otherDependents',
            'guardianPrimary',
            'guardianAlternate',
            'assets',
            'liabilities',
            'fiduciaries',
            'distributionPlan',
            'distribution',
            'healthcarePreferences',
            'isFemale',
            'burialPreference',
            'burialDetails',
            'hasExistingDocuments',
            'existingDocumentsDetails',
            'existingDocumentsDate',
            'hasPendingLegalMatters',
            'pendingLegalDetails',
            'additionalNotes',
            'referralSource',
            'uploads',
            'currentStepIndex',
            'completedSteps',
            'sectionProgress',
          ];

          for (const field of qFields) {
            if (field in raw) {
              (partial as Record<string, unknown>)[field] = raw[field];
            }
          }

          const savedIndex =
            typeof raw['currentStepIndex'] === 'number' ? raw['currentStepIndex'] : 0;

          dispatch({ type: 'SET_DATA', payload: partial });
          dispatch({ type: 'SET_STEP', index: savedIndex });
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load questionnaire';
          dispatch({ type: 'SET_ERROR', message });
        }
      } finally {
        if (!cancelled) dispatch({ type: 'SET_LOADING', value: false });
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  // ── Save to Firestore ────────────────────────────────────────────────────

  const performSave = useCallback(
    async (data: QuestionnaireData, stepIndex: number) => {
      dispatch({ type: 'SET_SAVING', value: true });
      try {
        await setDoc(doc(db, docPath), {
          personalInfo: data.personalInfo,
          spouseInfo: data.spouseInfo ?? null,
          hasChildren: data.hasChildren,
          numberOfChildren: data.numberOfChildren ?? null,
          children: data.children,
          hasOtherDependents: data.hasOtherDependents,
          otherDependents: data.otherDependents,
          guardianPrimary: data.guardianPrimary ?? null,
          guardianAlternate: data.guardianAlternate ?? null,
          assets: data.assets,
          liabilities: data.liabilities,
          fiduciaries: data.fiduciaries,
          distributionPlan: data.distributionPlan,
          distribution: data.distribution,
          healthcarePreferences: data.healthcarePreferences,
          isFemale: data.isFemale ?? null,
          burialPreference: data.burialPreference ?? null,
          burialDetails: data.burialDetails ?? null,
          hasExistingDocuments: data.hasExistingDocuments,
          existingDocumentsDetails: data.existingDocumentsDetails ?? null,
          existingDocumentsDate: data.existingDocumentsDate ?? null,
          hasPendingLegalMatters: data.hasPendingLegalMatters,
          pendingLegalDetails: data.pendingLegalDetails ?? null,
          additionalNotes: data.additionalNotes ?? null,
          referralSource: data.referralSource ?? null,
          uploads: data.uploads ?? [],
          currentStepIndex: stepIndex,
          completedSteps: data.completedSteps,
          sectionProgress: data.sectionProgress,
          updatedAt: serverTimestamp(),
        }, { merge: true }); // Use merge in case the document is strictly a questionnaire stub

        // Also update the questionnaireProgress tracker specifically
        const updaterName = userProfile?.role === 'client'
          ? 'Client'
          : `Admin (${userProfile?.displayName || userProfile?.email || 'Unknown'})`;

        // Retry with exponential backoff for transient Firestore/network errors
        const MAX_RETRIES = 3;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            // Compute progress fields for dashboard display
            const visibleStepCount = QUESTIONNAIRE_STEPS.filter((step) => {
              if (!step.condition) return true;
              return evaluateCondition(step.condition, data);
            }).length;
            const percentComplete = visibleStepCount > 0
              ? Math.round((data.completedSteps.length / visibleStepCount) * 100)
              : 0;

            // Determine which sections have all visible steps completed
            const sectionsCompleted: string[] = [];
            for (const section of SECTION_META) {
              const sectionSteps = QUESTIONNAIRE_STEPS.filter((s) => {
                if (s.section !== section.id) return false;
                if (!s.condition) return true;
                return evaluateCondition(s.condition, data);
              });
              if (sectionSteps.length > 0 && sectionSteps.every((s) => data.completedSteps.includes(s.id))) {
                sectionsCompleted.push(section.id);
              }
            }

            // Determine the current visible step info for dashboard display
            const visibleSteps = QUESTIONNAIRE_STEPS.filter((step) => {
              if (!step.condition) return true;
              return evaluateCondition(step.condition, data);
            });
            const currentVisibleStep = visibleSteps[stepIndex] ?? null;
            const currentSectionMeta = currentVisibleStep
              ? SECTION_META.find((s) => s.id === currentVisibleStep.section)
              : null;

            // Clients move status to 'in_progress'; staff edits preserve 'completed'
            // so the questionnaire never reverts during an edit session.
            const saveStatus = userProfile?.role === 'client' ? 'in_progress' : 'completed';

            await updateDoc(doc(db, docPath), {
              'questionnaireProgress.status': saveStatus,
              'questionnaireProgress.percentComplete': percentComplete,
              'questionnaireProgress.sectionsCompleted': sectionsCompleted,
              'questionnaireProgress.currentStepIndex': stepIndex,
              'questionnaireProgress.currentStepTitle': currentVisibleStep?.title ?? '',
              'questionnaireProgress.currentSectionId': currentVisibleStep?.section ?? '',
              'questionnaireProgress.currentSectionTitle': currentSectionMeta?.title ?? '',
              'questionnaireProgress.totalSteps': visibleSteps.length,
              'questionnaireProgress.lastUpdatedBy': updaterName,
              'questionnaireProgress.lastUpdatedAt': serverTimestamp(),
            });

            pendingSaveRef.current = false;
            lastError = null;
            break; // Success — exit retry loop
          } catch (retryErr) {
            lastError = retryErr;
            if (attempt < MAX_RETRIES - 1) {
              // Exponential backoff: 1s, 2s, 4s
              await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
          }
        }
        if (lastError) {
          const message = lastError instanceof Error ? lastError.message : 'Failed to save progress after retries';
          dispatch({ type: 'SET_ERROR', message });
        }
      } finally {
        dispatch({ type: 'SET_SAVING', value: false });
      }
    },
    [docPath, userProfile],
  );

  // ── Manual save ──────────────────────────────────────────────────────────

  const saveProgress = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await performSave(state.data, state.currentStep);
  }, [performSave, state.data, state.currentStep]);

  // ── Flush on unmount ─────────────────────────────────────────────────────

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void performSave(stateRef.current.data, stateRef.current.currentStep);
      }
    };
  }, [performSave]);

  // ── Field update with debounced auto-save ────────────────────────────────

  const scheduleAutoSave = useCallback(() => {
    pendingSaveRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void performSave(stateRef.current.data, stateRef.current.currentStep);
    }, 2000);
  }, [performSave]);

  const updateField = useCallback(
    (path: string, value: unknown) => {
      dispatch({ type: 'UPDATE_FIELD', path, value });
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const updateFields = useCallback(
    (updates: Record<string, unknown>) => {
      dispatch({ type: 'UPDATE_FIELDS', updates });
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  // ── Computed: visible steps (skip logic) ─────────────────────────────────

  const visibleSteps = useMemo<QuestionnaireStep[]>(() => {
    return QUESTIONNAIRE_STEPS.filter((step) => {
      if (!step.condition) return true;
      return evaluateCondition(step.condition, state.data);
    });
  }, [state.data]);

  const totalSteps = visibleSteps.length;

  const currentStepDef: QuestionnaireStep | null = visibleSteps[state.currentStep] ?? null;

  const currentSection: QuestionnaireSection =
    currentStepDef?.section ?? 'aboutYou';

  // ── Computed: progress ───────────────────────────────────────────────────

  const progress = useMemo(() => {
    if (totalSteps === 0) return 0;
    return Math.round((state.data.completedSteps.length / totalSteps) * 100);
  }, [state.data.completedSteps.length, totalSteps]);

  // ── Computed: section progress ───────────────────────────────────────────

  const sectionProgress = useMemo<Record<QuestionnaireSection, number>>(() => {
    const result = { ...state.data.sectionProgress };
    for (const section of SECTION_META) {
      const sectionSteps = visibleSteps.filter((s) => s.section === section.id);
      if (sectionSteps.length === 0) {
        result[section.id] = 100;
        continue;
      }
      const completed = sectionSteps.filter((s) =>
        state.data.completedSteps.includes(s.id),
      ).length;
      result[section.id] = Math.round((completed / sectionSteps.length) * 100);
    }
    return result;
  }, [visibleSteps, state.data.completedSteps, state.data.sectionProgress]);

  // ── Computed: estimated minutes remaining ────────────────────────────────

  const estimatedMinutesRemaining = useMemo(() => {
    const remainingSteps = visibleSteps.slice(state.currentStep);
    return remainingSteps.reduce((sum, step) => sum + (step.estimatedMinutes ?? 1), 0);
  }, [visibleSteps, state.currentStep]);

  // ── Step helpers ─────────────────────────────────────────────────────────

  const isStepComplete = useCallback(
    (stepId: string) => state.data.completedSteps.includes(stepId),
    [state.data.completedSteps],
  );

  // canProceed: basic check — true unless step has required fields missing
  const canProceed = useMemo(() => {
    if (!currentStepDef) return true;
    const requiredFields = currentStepDef.fields.filter(
      (f) => f.required && f.type !== 'heading' && f.type !== 'info',
    );
    return requiredFields.every((field) => {
      const val = getNestedValue(
        state.data as unknown as Record<string, unknown>,
        field.name,
      );
      return val != null && val !== '';
    });
  }, [currentStepDef, state.data]);

  // ── Navigation ───────────────────────────────────────────────────────────

  const markCurrentComplete = useCallback(
    (stepId: string) => {
      if (!state.data.completedSteps.includes(stepId)) {
        dispatch({
          type: 'UPDATE_FIELD',
          path: 'completedSteps',
          value: [...state.data.completedSteps, stepId],
        });
      }
    },
    [state.data.completedSteps],
  );

  const goToStep = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, totalSteps - 1));
      dispatch({ type: 'SET_STEP', index: clamped });
      dispatch({ type: 'UPDATE_FIELD', path: 'currentStepIndex', value: clamped });
      scheduleAutoSave();
    },
    [totalSteps, scheduleAutoSave],
  );

  const goNext = useCallback(() => {
    if (currentStepDef) {
      markCurrentComplete(currentStepDef.id);
    }
    if (state.currentStep < totalSteps - 1) {
      goToStep(state.currentStep + 1);
    }
  }, [currentStepDef, markCurrentComplete, state.currentStep, totalSteps, goToStep]);

  const goBack = useCallback(() => {
    if (state.currentStep > 0) {
      goToStep(state.currentStep - 1);
    }
  }, [state.currentStep, goToStep]);

  // ── Context value ────────────────────────────────────────────────────────

  const value = useMemo<QuestionnaireContextValue>(
    () => ({
      data: state.data,
      currentStep: state.currentStep,
      visibleSteps,
      totalSteps,
      currentStepDef,
      currentSection,
      progress,
      estimatedMinutesRemaining,
      sectionProgress,
      isLoading: state.isLoading,
      isSaving: state.isSaving,
      error: state.error,
      canProceed,
      updateField,
      updateFields,
      goToStep,
      goNext,
      goBack,
      isStepComplete,
      saveProgress,
    }),
    [
      state.data,
      state.currentStep,
      state.isLoading,
      state.isSaving,
      state.error,
      visibleSteps,
      totalSteps,
      currentStepDef,
      currentSection,
      progress,
      estimatedMinutesRemaining,
      sectionProgress,
      canProceed,
      updateField,
      updateFields,
      goToStep,
      goNext,
      goBack,
      isStepComplete,
      saveProgress,
    ],
  );

  return (
    <QuestionnaireContext.Provider value={value}>
      {children}
    </QuestionnaireContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useQuestionnaire(): QuestionnaireContextValue {
  const ctx = useContext(QuestionnaireContext);
  if (!ctx) {
    throw new Error('useQuestionnaire must be used within a QuestionnaireProvider');
  }
  return ctx;
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

// Layouts (always loaded)
import { AppLayout } from '@/components/layout/AppLayout';
import { ClientLayout } from '@/components/layout/ClientLayout';

// Auth pages (always loaded — small)
import LoginPage from '@/pages/auth/LoginPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import UnauthorizedPage from '@/pages/auth/UnauthorizedPage';

// Lazy-loaded pages (code-split)
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage'));
const ClientListPage = lazy(() => import('@/pages/admin/ClientListPage'));
const ClientDashboardPage = lazy(() => import('@/pages/admin/ClientDashboardPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const DocumentEditorPage = lazy(() => import('@/pages/admin/DocumentEditorPage'));
const QuestionnairePage = lazy(() => import('@/pages/client/QuestionnairePage'));
const PrintableQuestionnaire = lazy(() => import('@/components/questionnaire/PrintableQuestionnaire'));
const PrintableQuestionnairePage = lazy(() => import('@/pages/client/PrintableQuestionnairePage'));
const TermsOfServicePage = lazy(() => import('@/pages/legal/TermsOfServicePage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/legal/PrivacyPolicyPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const CalendarPage = lazy(() => import('@/pages/admin/CalendarPage'));
const PaymentsPage = lazy(() => import('@/pages/admin/PaymentsPage'));
const NewClientPage = lazy(() => import('@/pages/admin/NewClientPage'));
const KnowledgeBasePage = lazy(() => import('@/pages/admin/KnowledgeBasePage'));
const PendingTranscriptsPage = lazy(() => import('@/pages/admin/PendingTranscriptsPage'));
const ClientPortalPage = lazy(() => import('@/pages/client/ClientPortalPage'));
const NameSplitsReview = lazy(() => import('@/pages/admin/NameSplitsReview'));
const QuestionnaireRegisterPage = lazy(() => import('@/pages/client/QuestionnaireRegisterPage'));



// Constants
import { ROUTES } from '@/config/constants';

// Role sets
const STAFF_ROLES = ['admin', 'attorney', 'paralegal'] as const;

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        {/* Sonner toast notifications — positioned top-right */}
        <Toaster
          position="top-right"
          toastOptions={{
            classNames: {
              toast:
                'rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg text-sm font-medium',
              success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
              error: 'border-red-200 bg-red-50 text-red-900',
              warning: 'border-amber-200 bg-amber-50 text-amber-900',
            },
          }}
        />
        <Suspense fallback={<LoadingSpinner fullScreen />}>
          <Routes>
            {/* ── Root redirect ── */}
            <Route path="/" element={<Navigate to={ROUTES.DASHBOARD} replace />} />



            {/* ── Public auth routes ── */}
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path={ROUTES.UNAUTHORIZED} element={<UnauthorizedPage />} />

            {/* ── Protected staff routes (AppLayout) ── */}
            <Route
              path={ROUTES.DASHBOARD}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <DashboardPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.CLIENTS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <ClientListPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.CLIENT_NEW}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <NewClientPage />
                </AppLayout>
              }
            />
            <Route
              path="/clients/:clientId"
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <ClientDashboardPage />
                </AppLayout>
              }
            />
            <Route
              path="/clients/:clientId/questionnaire"
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <QuestionnairePage />
                </AppLayout>
              }
            />
            <Route
              path="/clients/:clientId/documents"
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <ClientDashboardPage />
                </AppLayout>
              }
            />
            <Route
              path="/clients/:clientId/documents/:documentId/edit"
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]} fullWidth>
                  <DocumentEditorPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.SETTINGS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <SettingsPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.SETTINGS_FIRM}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <SettingsPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.SETTINGS_USERS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <SettingsPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.SETTINGS_BILLING}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <SettingsPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.CALENDAR}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <CalendarPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.PAYMENTS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <PaymentsPage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.KNOWLEDGE_BASE}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <KnowledgeBasePage />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.ADMIN_NAME_SPLITS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <NameSplitsReview />
                </AppLayout>
              }
            />
            <Route
              path={ROUTES.PENDING_TRANSCRIPTS}
              element={
                <AppLayout allowedRoles={[...STAFF_ROLES]}>
                  <PendingTranscriptsPage />
                </AppLayout>
              }
            />

            {/* ── Client-facing routes (ClientLayout) ── */}

            {/* Generic questionnaire link — no per-client invite needed */}
            <Route path="/questionnaire/:firmId/register" element={<QuestionnaireRegisterPage />} />

            <Route
              path="/questionnaire/:firmId/:clientId"
              element={
                <ClientLayout>
                  <QuestionnairePage />
                </ClientLayout>
              }
            />
            <Route
              path="/portal/:firmId/:clientId"
              element={
                <ClientLayout>
                  <ClientPortalPage />
                </ClientLayout>
              }
            />

            {/* ── Printable questionnaire (no AppLayout — renders standalone for clean print) ── */}
            <Route path="/questionnaire/print" element={<PrintableQuestionnaire />} />
            <Route path="/questionnaire/:firmId/:clientId/print" element={<PrintableQuestionnairePage />} />

            {/* ── Legal pages (public) ── */}
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />

            {/* ── 404 ── */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

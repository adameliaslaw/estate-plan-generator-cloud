/**
 * QuestionnaireRegisterPage.tsx
 *
 * Public landing page for the generic questionnaire link that attorneys
 * can copy from the dashboard and send directly to clients (e.g. via
 * text, email, or any messaging app) when SendGrid is unavailable.
 *
 * Route: /questionnaire/:firmId/register
 *
 * Flow:
 *  1. Client arrives at this page with no prior session.
 *  2. Fills in First Name, Last Name, and Email.
 *  3. The page signs in anonymously with Firebase Auth.
 *  4. registerClientFromLink Cloud Function finds or creates the client
 *     record and stores linkedUserId = anonymousUid on the document.
 *  5. Client is redirected to /questionnaire/:firmId/:clientId.
 *     ClientLayout sees the anonymous auth session and skips the login
 *     redirect; Firestore allows the anonymous session to read/write
 *     the client record via the linkedUserId rule.
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { signInAnonymously } from 'firebase/auth';
import { functions, auth } from '@/config/firebase';
import { Scale, Lock } from 'lucide-react';
import { FIRM_DEFAULTS } from '@/config/constants';
import { sanitizeNameField } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegisterRequest {
  firmId: string;
  email: string;
  firstName: string;
  lastName: string;
  anonymousUid: string;
}

interface RegisterResponse {
  clientId: string;
  isNew: boolean;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validate(values: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!values.firstName.trim()) errors.firstName = 'First name is required.';
  if (!values.lastName.trim()) errors.lastName = 'Last name is required.';
  if (!values.email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!validateEmail(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }
  return errors;
}

// ── Input component ───────────────────────────────────────────────────────────

const inputBase =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-[#1a365d] focus:outline-none focus:ring-1 focus:ring-[#1a365d] disabled:bg-gray-50 disabled:text-gray-400';

const inputError = 'border-red-400 focus:border-red-500 focus:ring-red-500';

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label} <span className="text-red-500">*</span>
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function QuestionnaireRegisterPage() {
  const { firmId } = useParams<{ firmId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({ firstName: '', lastName: '', email: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  if (!firmId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#ebf4ff] p-4">
        <p className="text-center text-red-600">Invalid link — no firm identifier found.</p>
      </div>
    );
  }

  const handleChange = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: sanitizeNameField(field, e.target.value) }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (serverError) setServerError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    setServerError('');

    try {
      // Sign in anonymously so the client gets a Firebase session. This UID is
      // stored as linkedUserId on the client document, which lets the session
      // read/write the Firestore record without a full login.
      const anonCred = await signInAnonymously(auth);
      const anonymousUid = anonCred.user.uid;

      const fn = httpsCallable<RegisterRequest, RegisterResponse>(
        functions,
        'registerClientFromLink',
      );
      const result = await fn({
        firmId,
        email: form.email.trim().toLowerCase(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        anonymousUid,
      });
      navigate(`/questionnaire/${firmId}/${result.data.clientId}`, { replace: true });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#ebf4ff]">
      {/* Header */}
      <header className="border-b border-[#2b6cb0]/20 bg-white shadow-sm px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a365d]">
            <Scale className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-base font-semibold text-[#1a365d]">{FIRM_DEFAULTS.firmName}</p>
            <p className="text-xs text-gray-500">Estate Planning Questionnaire</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="mb-1 text-xl font-bold text-[#1a365d]">Get Started</h1>
            <p className="mb-6 text-sm text-gray-500">
              Please enter your information to access the estate planning questionnaire.
            </p>

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field id="firstName" label="First Name" error={errors.firstName}>
                  <input
                    id="firstName"
                    type="text"
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={handleChange('firstName')}
                    disabled={submitting}
                    className={`${inputBase} ${errors.firstName ? inputError : ''}`}
                    placeholder="Jane"
                  />
                </Field>
                <Field id="lastName" label="Last Name" error={errors.lastName}>
                  <input
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={handleChange('lastName')}
                    disabled={submitting}
                    className={`${inputBase} ${errors.lastName ? inputError : ''}`}
                    placeholder="Smith"
                  />
                </Field>
              </div>

              <Field id="email" label="Email Address" error={errors.email}>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  disabled={submitting}
                  className={`${inputBase} ${errors.email ? inputError : ''}`}
                  placeholder="jane.smith@example.com"
                />
              </Field>

              {serverError && (
                <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600" role="alert">
                  {serverError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full rounded-lg bg-[#2b6cb0] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1e407a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'One moment…' : 'Continue to Questionnaire'}
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2b6cb0]/15 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2b6cb0]" />
              <span>
                <span className="font-semibold text-gray-700">Attorney-Client Privilege Notice:</span>{' '}
                The information you provide is confidential and protected by the attorney-client
                privilege. It will only be used to prepare your estate planning documents.
              </span>
            </div>
            <div className="shrink-0 text-right text-xs text-gray-400">
              <p className="font-medium text-gray-500">{FIRM_DEFAULTS.firmName}</p>
              <p>{FIRM_DEFAULTS.firmPhone}</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * NewClientPage.tsx
 *
 * Form page for creating a new client record (route: /clients/new).
 *
 * Creates a Firestore document at firms/{firmId}/clients/{auto-id} with
 * initial status 'prospect', then navigates to the new client's dashboard.
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import PrivilegeNotice from '@/components/common/PrivilegeNotice';
import { UserPlus, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { logSystemActivity } from '@/utils/activity-logger';
import { sanitizeNameField } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────────

type PackageType = 'foundation' | 'guardian' | 'fortress';

interface FormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  packageType: PackageType | '';
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

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.firstName.trim()) {
    errors.firstName = 'First name is required.';
  }
  if (!values.lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }
  if (!values.email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!validateEmail(values.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  return errors;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ id, label, required, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
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

const inputBase =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-[#1a365d] focus:outline-none focus:ring-1 focus:ring-[#1a365d] disabled:bg-gray-50 disabled:text-gray-500';

const inputError =
  'border-red-400 focus:border-red-500 focus:ring-red-500';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewClientPage() {
  const { userProfile } = useAuth();
  const navigate = useNavigate();

  const firmId = userProfile?.firmId ?? '';

  const [values, setValues] = useState<FormValues>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    packageType: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: sanitizeNameField(name, value) }));
    // Clear the individual field error on change
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validationErrors = validate(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (!firmId) {
      toast.error('Unable to determine firm. Please sign out and sign back in.');
      return;
    }

    setSubmitting(true);

    try {
      const colRef = collection(db, COLLECTIONS.CLIENTS(firmId));

      const docRef = await addDoc(colRef, {
        firmId,
        status: 'prospect',
        packageType: values.packageType || null,
        personalInfo: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: values.email.trim().toLowerCase(),
          phone: values.phone.trim() || null,
        },
        questionnaire: {
          status: 'not_started',
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userProfile?.uid ?? null,
      });

      toast.success(
        `Client ${values.firstName} ${values.lastName} created successfully.`,
      );

      // Log activity
      await logSystemActivity(firmId, userProfile, 'adding client', {
        clientName: `${values.firstName} ${values.lastName}`.trim(),
      });

      // Navigate to the new client's dashboard
      navigate(ROUTES.CLIENT_DETAIL(docRef.id));
    } catch (err) {
      console.error('[NewClientPage] Firestore addDoc error:', err);
      toast.error('Failed to create client. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Attorney-client privilege notice */}
      <PrivilegeNotice />

      {/* Page header */}
      <div className="space-y-1">
        <Link
          to={ROUTES.CLIENTS}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-[#1a365d] transition-colors mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Clients
        </Link>
        <div className="flex items-center gap-3">
          <UserPlus className="h-6 w-6 text-[#1a365d]" strokeWidth={1.75} />
          <h1 className="text-2xl font-bold text-[#1a365d]">New Client</h1>
        </div>
        <p className="text-sm text-gray-500">
          Create a new client record. You can add full details from the client
          dashboard after creation.
        </p>
      </div>

      {/* Form card */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <form onSubmit={handleSubmit} noValidate>

          <div className="px-6 py-5 space-y-5">

            {/* Name row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field
                id="firstName"
                label="First Name"
                required
                error={errors.firstName}
              >
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Jane"
                  value={values.firstName}
                  onChange={handleChange}
                  disabled={submitting}
                  className={cn(inputBase, errors.firstName && inputError)}
                />
              </Field>

              <Field
                id="lastName"
                label="Last Name"
                required
                error={errors.lastName}
              >
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Smith"
                  value={values.lastName}
                  onChange={handleChange}
                  disabled={submitting}
                  className={cn(inputBase, errors.lastName && inputError)}
                />
              </Field>
            </div>

            {/* Email */}
            <Field
              id="email"
              label="Email Address"
              required
              error={errors.email}
            >
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="jane.smith@example.com"
                value={values.email}
                onChange={handleChange}
                disabled={submitting}
                className={cn(inputBase, errors.email && inputError)}
              />
            </Field>

            {/* Phone */}
            <Field id="phone" label="Phone Number">
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="(609) 555-0100"
                value={values.phone}
                onChange={handleChange}
                disabled={submitting}
                className={inputBase}
              />
            </Field>

            {/* Package Type */}
            <Field id="packageType" label="Estate Plan Package">
              <select
                id="packageType"
                name="packageType"
                title="Estate Plan Package"
                value={values.packageType}
                onChange={handleChange}
                disabled={submitting}
                className={cn(inputBase, 'cursor-pointer')}
              >
                <option value="">— Select a package (optional) —</option>
                <option value="foundation">Basic Estate Plan Package — Will, POA, Living Will</option>
                <option value="guardian">Revocable Trust Package — Trust-centered estate plan</option>
                <option value="fortress">Irrevocable Trust Package — Advanced asset protection</option>
              </select>
            </Field>

          </div>

          {/* Form footer */}
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 rounded-b-xl">
            <Link
              to={ROUTES.CLIENTS}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#1a365d] focus:ring-offset-2"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !firmId}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1a365d] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#2d4a7a] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1a365d] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating…
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Create Client
                </>
              )}
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}

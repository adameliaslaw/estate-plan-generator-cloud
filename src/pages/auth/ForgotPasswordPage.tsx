import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Scale, AlertCircle, CheckCircle, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES, FIRM_DEFAULTS } from '@/config/constants';

const forgotSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
});

type ForgotFormValues = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotSchema),
  });

  async function onSubmit(values: ForgotFormValues) {
    setErrorMessage(null);
    try {
      await resetPassword(values.email);
      setSuccessEmail(values.email);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to send reset link. Please try again.',
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ebf4ff] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-blue-100 bg-white px-8 py-10 shadow-lg">
          {/* Branding */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1a365d] shadow-md">
              <Scale className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1a365d]">Reset Password</h1>
            <p className="mt-1 text-sm text-gray-500">{FIRM_DEFAULTS.firmName}</p>
          </div>

          {successEmail ? (
            /* Success state */
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-5 text-center">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Reset link sent</p>
                  <p className="mt-1 text-xs text-green-700">
                    We sent a password reset link to{' '}
                    <span className="font-medium">{successEmail}</span>. Check your inbox and
                    follow the instructions.
                  </p>
                </div>
              </div>
              <p className="text-center text-xs text-gray-500">
                Didn&apos;t receive it? Check your spam folder or{' '}
                <button
                  type="button"
                  onClick={() => setSuccessEmail(null)}
                  className="font-medium text-[#2b6cb0] hover:underline"
                >
                  try again
                </button>
                .
              </p>
            </div>
          ) : (
            /* Form state */
            <>
              <p className="mb-5 text-sm text-gray-600 text-center">
                Enter the email address associated with your account and we will send you a link
                to reset your password.
              </p>

              {errorMessage && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    disabled={isSubmitting}
                    {...register('email')}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20 disabled:cursor-not-allowed disabled:bg-gray-50"
                  />
                  {errors.email && (
                    <p className="text-xs text-red-600">{errors.email.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>
            </>
          )}

          {/* Back to login */}
          <div className="mt-6 flex items-center justify-center">
            <Link
              to={ROUTES.LOGIN}
              className="flex items-center gap-1.5 text-sm font-medium text-[#2b6cb0] hover:text-[#1a365d] hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} {FIRM_DEFAULTS.firmName}. All rights reserved.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Scale, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES, FIRM_DEFAULTS } from '@/config/constants';

// ── Form schema ──────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Google icon SVG ──────────────────────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { signInWithEmail, signInWithGoogle, user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? ROUTES.DASHBOARD;

  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-redirect if user gets fully logged in and AuthContext updates with profile
  useEffect(() => {
    if (user && userProfile) {
      navigate(decodeURIComponent(redirectTo), { replace: true });
    }
  }, [user, userProfile, navigate, redirectTo]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginFormValues) {
    setErrorMessage(null);
    try {
      await signInWithEmail(values.email, values.password);
      // Navigation handled by useEffect on user state change
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // Navigation handled by useEffect on user state change
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  }

  const isLoading = isSubmitting || googleLoading;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ebf4ff] px-4 py-12">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-blue-100 bg-white px-8 py-10 shadow-lg">
          {/* Branding */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1a365d] shadow-md">
              <Scale className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1a365d]">
              {FIRM_DEFAULTS.firmName}
            </h1>
            <p className="mt-1 text-sm text-gray-500">Estate Planning Portal</p>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Email/password form */}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                disabled={isLoading}
                {...register('email')}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link
                  to={ROUTES.LOGIN.replace('/login', '/forgot-password')}
                  className="text-xs font-medium text-[#2b6cb0] hover:text-[#1a365d] hover:underline"
                  tabIndex={-1}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={isLoading}
                  {...register('password')}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20 disabled:cursor-not-allowed disabled:bg-gray-50"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>

            {/* Sign In button */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-gray-400">or continue with</span>
            </div>
          </div>

          {/* Google sign-in */}
          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            {googleLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon className="h-4 w-4" />
            )}
            Sign in with Google
          </button>

          {/* Contact notice */}
          <p className="mt-6 text-center text-xs text-gray-500">
            Don&apos;t have an account?{' '}
            <a
              href={`mailto:${FIRM_DEFAULTS.firmEmail}`}
              className="font-medium text-[#2b6cb0] hover:underline"
            >
              Contact our office
            </a>
          </p>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} {FIRM_DEFAULTS.firmName}. All rights reserved.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Scale, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';
import { ROUTES, FIRM_DEFAULTS, COLLECTIONS } from '@/config/constants';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';

const authSchema = z.object({
  mode: z.enum(['sign-in', 'sign-up']),
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'sign-up') {
    if (!data.firstName || data.firstName.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstName'],
        message: 'First name is required for sign up',
      });
    }
    if (!data.lastName || data.lastName.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lastName'],
        message: 'Last name is required for sign up',
      });
    }
  }
});

type AuthFormValues = {
  mode: 'sign-in' | 'sign-up';
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
};

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
  const { signInWithEmail, signUp, signInWithGoogle, user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? ROUTES.DASHBOARD;

  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-redirect if user gets fully logged in and AuthContext updates with profile
  useEffect(() => {
    async function handleRouting() {
      if (!user || !userProfile) return;

      // If user is staff (admin/attorney/paralegal), go to dashboard (or requested route)
      if (userProfile.role !== 'client') {
        navigate(decodeURIComponent(redirectTo), { replace: true });
        return;
      }

      // User is a client. We must find their client document to route them to their questionnaire.
      try {
        const firmId = userProfile.firmId || 'elias-counsel'; // Fallback to default

        // Link the client first to ensure they have the proper claims and the DB is updated
        try {
          const linkClientFn = httpsCallable(functions, 'linkClient');
          const result = await linkClientFn({ firmId });
          const data = result.data as { success: boolean; clientId?: string };

          if (data.success && data.clientId) {
            // If linking was successful, we can use the returned clientId directly!
            navigate(`/questionnaire/${firmId}/${data.clientId}`, { replace: true });
            return; // We are done!
          }
        } catch (linkErr) {
          console.warn('Failed to auto-link client via Cloud Function, falling back to manual query:', linkErr);
        }

        const clientsRef = collection(db, COLLECTIONS.CLIENTS(firmId));

        // 1. First, check if there's a client document explicitly linked by auth UID
        const qByUid = query(clientsRef, where('linkedUserId', '==', user.uid));
        let snap = await getDocs(qByUid);

        // 2. If not found by UID, try finding by email address
        if (snap.empty && user.email) {
          const qByEmail = query(clientsRef, where('personalInfo.email', '==', user.email));
          snap = await getDocs(qByEmail);
        }

        if (!snap.empty) {
          const clientId = snap.docs[0].id;
          navigate(`/questionnaire/${firmId}/${clientId}`, { replace: true });
        } else {
          // Client has no associated record yet, send them to unauthorized or dashboard
          // where they will see the default generic access denied message until linked
          navigate(ROUTES.UNAUTHORIZED, { replace: true });
        }
      } catch (err) {
        console.error('Failed to route client:', err);
        navigate(ROUTES.UNAUTHORIZED, { replace: true });
      }
    }

    void handleRouting();
  }, [user, userProfile, navigate, redirectTo]);

  const [firmLogoUrl, setFirmLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLogo() {
      try {
        const getBranding = httpsCallable(functions, 'getFirmBranding');
        const result = await getBranding();
        const data = result.data as { logoUrl: string | null; firmName: string | null };
        if (data && data.logoUrl) {
          setFirmLogoUrl(data.logoUrl);
        }
      } catch (e) {
        console.error('Failed to fetch firm logo for login page:', e);
      }
    }
    void fetchLogo();
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      mode: 'sign-in',
      email: '',
      password: '',
      firstName: '',
      lastName: '',
    }
  });

  // When switching modes, clear errors
  const toggleMode = (newMode: 'sign-in' | 'sign-up') => {
    setMode(newMode);
    setValue('mode', newMode);
    clearErrors();
    setErrorMessage(null);
  };

  async function onSubmit(values: AuthFormValues) {
    setErrorMessage(null);
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(values.email, values.password);
      } else {
        const displayName = `${values.firstName?.trim()} ${values.lastName?.trim()}`;
        await signUp(values.email, values.password, displayName);
        // After signing up successfully, the onAuthStateChanged in AuthContext will trigger
        // the client linking flow since it sees a new user but no profile.
        // We will call the linkClient function here just to be safe before routing triggers.
        const firmId = 'elias-counsel'; // Fallback
        const linkClientFn = httpsCallable(functions, 'linkClient');
        await linkClientFn({ firmId });
      }
      // Navigation handled by useEffect on user state change
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : `${mode === 'sign-in' ? 'Sign in' : 'Sign up'} failed. Please try again.`);
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
            {firmLogoUrl ? (
              <img src={firmLogoUrl} alt="Logo" className="mb-4 max-h-16 max-w-[200px] object-contain" />
            ) : (
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1a365d] shadow-md">
                <Scale className="h-8 w-8 text-white" />
              </div>
            )}
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

          {/* Mode Tabs */}
          <div className="mb-6 flex rounded-lg bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => toggleMode('sign-in')}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'sign-in' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => toggleMode('sign-up')}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'sign-up' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              Sign Up
            </button>
          </div>

          {/* Email/password form */}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {mode === 'sign-up' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                    First Name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    placeholder="Jane"
                    disabled={isLoading}
                    {...register('firstName')}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  {errors.firstName && (
                    <p className="text-xs text-red-600">{errors.firstName.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                    Last Name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    placeholder="Doe"
                    disabled={isLoading}
                    {...register('lastName')}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                  />
                  {errors.lastName && (
                    <p className="text-xs text-red-600">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
            )}
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
                {mode === 'sign-in' && (
                  <Link
                    to={ROUTES.LOGIN.replace('/login', '/forgot-password')}
                    className="text-xs font-medium text-[#2b6cb0] hover:text-[#1a365d] hover:underline"
                    tabIndex={-1}
                  >
                    Forgot password?
                  </Link>
                )}
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

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === 'sign-in' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : (
                mode === 'sign-in' ? 'Sign In' : 'Create Account'
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
            {mode === 'sign-in' ? 'Sign in' : 'Sign up'} with Google
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

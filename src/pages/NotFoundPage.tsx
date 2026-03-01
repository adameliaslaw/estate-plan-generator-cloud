import { useNavigate } from 'react-router-dom';
import { MapPin, Home, ArrowLeft } from 'lucide-react';
import { ROUTES, FIRM_DEFAULTS } from '@/config/constants';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ebf4ff] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-blue-100 bg-white px-8 py-12 text-center shadow-lg">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#ebf4ff]">
          <MapPin className="h-10 w-10 text-[#1a365d]" />
        </div>

        {/* Status */}
        <p className="text-5xl font-black tracking-tight text-[#1a365d]">404</p>
        <h1 className="mt-2 text-xl font-bold text-gray-800">Page Not Found</h1>
        <p className="mt-3 text-sm text-gray-500">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>

        {/* Actions */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => navigate(ROUTES.DASHBOARD)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e407a] transition-colors"
          >
            <Home className="h-4 w-4" />
            Go to Dashboard
          </button>
          <button
            onClick={() => navigate(-1)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        &copy; {new Date().getFullYear()} {FIRM_DEFAULTS.firmName}
      </p>
    </div>
  );
}

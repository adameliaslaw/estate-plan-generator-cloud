/**
 * SettingsHelpers.tsx — Small sub-components extracted from SettingsPage.tsx
 */

import { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  HardDrive,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { useGoogleLogin } from '@react-oauth/google';

// ---------------------------------------------------------------------------
// Google Login Button
// ---------------------------------------------------------------------------

export function GoogleLoginButton({
  onSuccess,
  onError,
  disabled,
}: {
  onSuccess: (code: string) => void;
  onError?: (error: unknown) => void;
  disabled?: boolean;
}) {
  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/calendar',
    onSuccess: (codeResponse) => onSuccess(codeResponse.code),
    onError: (error) => onError?.(error),
  });

  return (
    <Button
      onClick={() => login()}
      disabled={disabled}
      className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
    >
      {disabled ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
      Connect Google Calendar
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Google Drive Login Button (drive.file scope)
// ---------------------------------------------------------------------------

export function GoogleDriveLoginButton({
  onSuccess,
  onError,
  disabled,
}: {
  onSuccess: (code: string) => void;
  onError?: (error: unknown) => void;
  disabled?: boolean;
}) {
  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: 'https://www.googleapis.com/auth/drive',
    onSuccess: (codeResponse) => onSuccess(codeResponse.code),
    onError: (error) => onError?.(error),
  });

  return (
    <Button
      onClick={() => login()}
      disabled={disabled}
      className="gap-2 bg-[#2b6cb0] hover:bg-[#1a365d]"
    >
      {disabled ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
      Connect Google Drive
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Page Skeleton
// ---------------------------------------------------------------------------

export function PageSkeleton() {
  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="hidden w-48 shrink-0 space-y-2 lg:block">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Api Key Field
// ---------------------------------------------------------------------------

export function ApiKeyField({
  label,
  storedKey,
  pendingKey,
  onPendingChange,
  onSave,
  saving,
  description,
}: {
  label: string;
  storedKey: string | undefined;
  pendingKey: string;
  onPendingChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  description?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const hasStored = Boolean(storedKey);

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-[#1a365d]">{label}</Label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={revealed ? 'text' : 'password'}
            placeholder={hasStored ? maskApiKey(storedKey) : 'Enter API key…'}
            value={pendingKey}
            onChange={(e) => onPendingChange(e.target.value)}
            className="pr-10 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !pendingKey.trim()}
          className="bg-[#2b6cb0] hover:bg-[#1a365d]"
        >
          {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Update'}
        </Button>
      </div>
      {hasStored && (
        <p className="text-xs text-gray-400">
          Current key: <span className="font-mono">{maskApiKey(storedKey)}</span>
        </p>
      )}
    </div>
  );
}

/** Mask an API key showing only the last 4 characters. */
export function maskApiKey(key: string | undefined): string {
  if (!key || key.length < 4) return '';
  return `••••••••${key.slice(-4)} `;
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

export function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="border-gray-300 text-gray-500">
      <XCircle className="mr-1 h-3 w-3" />
      Not configured
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Color Picker Row
// ---------------------------------------------------------------------------

export function ColorPickerRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-gray-200 shadow-sm"
        style={{ backgroundColor: value }}
        title="Click to pick color"
        onClick={() => document.getElementById(`cp - ${label} `)?.click()}
      />
      <input
        id={`cp - ${label} `}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
      <div className="flex-1">
        <Label className="text-xs text-gray-500">{label}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="mt-1 h-8 font-mono text-sm"
          maxLength={7}
        />
      </div>
    </div>
  );
}

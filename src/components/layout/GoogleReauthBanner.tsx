import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useDocument } from '@/hooks/useFirestore';
import { COLLECTIONS, ROUTES } from '@/config/constants';

interface FirmIntegrationFlags {
  googleCalendar?: { connected?: boolean; needsReauth?: boolean };
  googleDrive?: { connected?: boolean; needsReauth?: boolean };
}

/**
 * App-wide warning shown when a Google integration's refresh token has been
 * revoked (backend sets `needsReauth` on the firm doc after an invalid_grant).
 * Without this, sync stops silently and nobody finds out until an event or
 * document is missing.
 */
export function GoogleReauthBanner() {
  const { userProfile } = useAuth();
  const { canManageFirmSettings } = usePermissions();
  const navigate = useNavigate();

  const firmId = userProfile?.firmId ?? '';
  const { data: firm } = useDocument<FirmIntegrationFlags>(
    firmId ? `${COLLECTIONS.FIRMS}/${firmId}` : null,
  );

  const expired: string[] = [];
  if (firm?.googleCalendar?.needsReauth) expired.push('Google Calendar');
  if (firm?.googleDrive?.needsReauth) expired.push('Google Drive');
  if (expired.length === 0) return null;

  return (
    <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="font-medium">
        {expired.join(' and ')} authorization has expired — syncing is paused until it is reconnected.
      </span>
      {canManageFirmSettings && (
        <button
          onClick={() => navigate(ROUTES.SETTINGS_BILLING)}
          className="ml-auto shrink-0 text-amber-600 hover:text-amber-800 underline text-xs"
        >
          Reconnect in Settings
        </button>
      )}
    </div>
  );
}

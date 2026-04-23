/**
 * CalendarPage.tsx
 *
 * Firm-wide calendar overview page (route: /calendar).
 * Displays all aggregated appointments across the firm utilizing
 * the shared CalendarTab component in global mode.
 */

import { useState } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';
import CalendarTab from '@/components/dashboard/CalendarTab';
import { useAuth } from '@/hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { app } from '@/config/firebase';

export default function CalendarPage() {
  const { userProfile } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);

  if (!userProfile?.firmId) return null;

  const handleManualSync = async () => {
    setIsSyncing(true);
    const toastId = toast.loading('Syncing with Google Calendar...');
    try {
      const fns = getFunctions(app, 'us-east1');
      const triggerFirmCalendarSync = httpsCallable(fns, 'triggerFirmCalendarSync', { timeout: 540_000 });
      const result = await triggerFirmCalendarSync();
      const updatedCount = (result.data as { eventsUpdated?: number })?.eventsUpdated || 0;

      toast.success(
        updatedCount > 0
          ? `Sync complete! Successfully mirrored ${updatedCount} events.`
          : 'Sync complete! All events are already up to date.',
        { id: toastId }
      );
    } catch (error: unknown) {
      console.error('Failed to trigger manual calendar sync:', error);
      const msg = error instanceof Error ? error.message : '';
      let toastMsg = 'Failed to sync with Google Calendar. Please try again.';

      if (msg.includes('not connected') || msg.includes('failed-precondition')) {
        toastMsg = 'Google Calendar is not connected. Please connect it in Settings → Integrations.';
      } else if (msg.includes('revoked') || msg.includes('unauthenticated') || msg.includes('authorisation')) {
        toastMsg = 'Google Calendar authorization expired. Please reconnect in Settings → Integrations → Google Calendar.';
      }

      toast.error(toastMsg, { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-8rem)]">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Calendar className="h-7 w-7 text-[#1a365d]" strokeWidth={1.75} />
            <h1 className="text-2xl font-bold text-[#1a365d]">Firm Calendar</h1>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            Aggregated firm-wide view of all scheduled client appointments and deadlines.
          </p>
        </div>

        <button
          onClick={handleManualSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1a365d] hover:bg-[#1a365d]/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1a365d]"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync from Google'}
        </button>
      </div>

      {/* Global Calendar Tab Container */}
      <div className="flex-1 min-h-0 min-w-0 bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl">
        <div className="h-full p-4 sm:p-6 overflow-y-auto w-full max-w-[1200px]">
          <CalendarTab firmId={userProfile.firmId} />
        </div>
      </div>
    </div>
  );
}

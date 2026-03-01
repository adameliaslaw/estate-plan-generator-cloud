/**
 * useSessionTimeout — idle session management hook.
 *
 * Tracks user activity (mousemove, mousedown, keydown, touchstart, scroll).
 * After SESSION_TIMEOUT_MS of inactivity the current user is signed out.
 * A "session-warning" CustomEvent is dispatched on the window
 * SESSION_WARNING_MS before that deadline so UI layers can show a toast.
 *
 * The hook is self-contained: it registers and cleans up its own event
 * listeners and timers. Mount it once in the authenticated layout root.
 *
 * It deliberately does NOT import useAuth to avoid circular dependencies —
 * the sign-out is handled by listening to the "session-timeout" event or
 * by accepting a `onTimeout` callback.
 */

import { useCallback, useEffect, useRef } from 'react';
import { SESSION_TIMEOUT_MS, SESSION_WARNING_MS } from '@/config/constants';

// ---------------------------------------------------------------------------
// Custom DOM events
// ---------------------------------------------------------------------------

/**
 * Dispatched on `window` 2 minutes before the session expires.
 * UI components can listen for this to show a warning toast.
 *
 * @example
 * window.addEventListener('session-warning', () => toast.warning('Session expiring…'));
 */
export const SESSION_WARNING_EVENT = 'session-warning' as const;

/**
 * Dispatched on `window` when the inactivity timer fires and sign-out
 * has been triggered.
 */
export const SESSION_TIMEOUT_EVENT = 'session-timeout' as const;

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseSessionTimeoutOptions {
  /** Called when the session times out. Typically calls auth.signOut(). */
  onTimeout: () => void | Promise<void>;
  /** Set to false to temporarily pause tracking (e.g. during a modal). */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionTimeout({
  onTimeout,
  enabled = true,
}: UseSessionTimeoutOptions): void {
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to onTimeout so we don't re-register listeners on
  // every render when the callback identity changes.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const scheduleTimers = useCallback(() => {
    if (!enabled) return;

    clearTimers();

    // Warning — fired 2 minutes before expiry.
    warningTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SESSION_WARNING_EVENT));
    }, SESSION_WARNING_MS);

    // Timeout — sign the user out.
    timeoutTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SESSION_TIMEOUT_EVENT));
      void Promise.resolve(onTimeoutRef.current());
    }, SESSION_TIMEOUT_MS);
  }, [enabled, clearTimers]);

  // Reset the timers on any user activity.
  const handleActivity = useCallback(() => {
    if (enabled) {
      scheduleTimers();
    }
  }, [enabled, scheduleTimers]);

  // Start / stop based on `enabled` flag.
  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    // Begin the first timer on mount.
    scheduleTimers();

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];

    events.forEach((e) =>
      window.addEventListener(e, handleActivity, { passive: true }),
    );

    return () => {
      clearTimers();
      events.forEach((e) => window.removeEventListener(e, handleActivity));
    };
  }, [enabled, scheduleTimers, handleActivity, clearTimers]);
}

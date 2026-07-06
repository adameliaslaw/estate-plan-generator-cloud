/**
 * useCreateClientRedirect
 *
 * Returns an `onCreate` handler for client-name comboboxes. Instead of creating
 * a minimal stub client inline, selecting "Create client" sends the user to the
 * full New Client form (/clients/new) — the same destination as the dashboard's
 * "New Client" button — with the typed name pre-filled via router state.
 *
 * Resolves `null` because the combobox unmounts on navigation; there is no
 * option to select back into the (now-gone) dropdown.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/constants';
import type { ComboboxOption } from '@/components/ui/combobox';

export function useCreateClientRedirect(): (
  typedName: string,
) => Promise<ComboboxOption | null> {
  const navigate = useNavigate();
  return useCallback(
    async (typedName: string) => {
      navigate(ROUTES.CLIENT_NEW, { state: { prefillName: typedName.trim() } });
      return null;
    },
    [navigate],
  );
}

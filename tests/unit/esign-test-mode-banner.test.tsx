/**
 * tests/unit/esign-test-mode-banner.test.tsx
 *
 * #174 — e-sign defaults to TEST MODE (watermarked, non-binding) and the
 * attorney only learned that AFTER a successful send. The dialog must show
 * the state BEFORE sending, mirroring the server's default logic
 * (dropboxSignTestMode !== false → test mode), so nobody sends a "signed"
 * document believing it binding.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDoc } from 'firebase/firestore';

import ESignatureDialog from '@/components/documents/ESignatureDialog';

function firmSnap(data: Record<string, unknown>) {
  return {
    id: 'firm-001',
    exists: () => true,
    data: () => data,
  } as unknown as Awaited<ReturnType<typeof getDoc>>;
}

const PROPS = {
  open: true,
  onClose: () => {},
  firmId: 'firm-001',
  clientId: 'client-1',
  documentId: 'doc-1',
  documentName: 'Last Will and Testament',
};

beforeEach(() => {
  vi.mocked(getDoc).mockReset();
});

describe('ESignatureDialog test-mode banner (#174)', () => {
  it('shows the TEST MODE banner before sending when the firm has not opted into live sends', async () => {
    // Default state: dropboxSignTestMode absent → server treats it as test mode.
    vi.mocked(getDoc).mockResolvedValue(firmSnap({}));

    render(<ESignatureDialog {...PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/TEST MODE/)).toBeInTheDocument();
    });
    expect(screen.getByText(/watermarked/i)).toBeInTheDocument();
    expect(screen.getByText(/non-binding/i)).toBeInTheDocument();
  });

  it('shows no banner when the firm has explicitly opted into live, binding sends', async () => {
    vi.mocked(getDoc).mockResolvedValue(firmSnap({ dropboxSignTestMode: false }));

    render(<ESignatureDialog {...PROPS} />);

    // Give the firm-doc read a tick to resolve, then assert absence.
    await waitFor(() => {
      expect(vi.mocked(getDoc)).toHaveBeenCalled();
    });
    expect(screen.queryByText(/TEST MODE/)).not.toBeInTheDocument();
  });
});

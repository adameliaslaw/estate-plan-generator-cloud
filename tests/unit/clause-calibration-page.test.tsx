/**
 * The calibration session as Adam meets it.
 *
 * The tuner's contract is "all 30 pairs labelled, when in doubt different" —
 * so the page must refuse to submit a partial set, must send exactly the
 * pairId/label pairs the packet asked about, and must survive a closed tab
 * (labels persist locally before any submit).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  userProfile: { uid: 'atty-1', role: 'attorney', firmId: 'firm-001' },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));

const svc = vi.hoisted(() => ({
  getCalibrationPacket: vi.fn(),
  submitCalibrationLabels: vi.fn(),
}));
vi.mock('@/services/clause-calibration-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCalibrationPacket: svc.getCalibrationPacket,
  submitCalibrationLabels: svc.submitCalibrationLabels,
}));

import ClauseCalibrationPage from '@/pages/admin/ClauseCalibrationPage';

const PACKET = {
  runId: 'pilot-1',
  instructions: 'Three asks.',
  boundaryDocs: [],
  seedPieces: [
    {
      pieceId: 'file1:0',
      seedFileName: 'AAA WILL PIECES.doc',
      title: 'Spendthrift',
      kind: 'clause',
      trustRelevant: true,
      normText: 'No beneficiary may assign…',
    },
  ],
  labelPairs: [
    {
      pairId: 'p1',
      aText: 'per stirpes sigtext',
      bText: 'per capita sigtext',
      aDisplay: 'Per stirpes readable text',
      bDisplay: 'Per capita readable text',
      score: 0.97,
    },
    // A pre-2026-08-02 packet pair without display fields still renders.
    { pairId: 'p2', aText: 'bond waived', bText: 'bond required', score: 0.95 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  svc.getCalibrationPacket.mockResolvedValue({ packet: PACKET, labels: null, draft: null });
  svc.submitCalibrationLabels.mockResolvedValue({ saved: 2 });
});

async function renderPage() {
  render(<ClauseCalibrationPage />);
  await screen.findByText(/Clause Calibration — run pilot-1/);
}

describe('ClauseCalibrationPage', () => {
  it('shows the readable display text, never the machine sigText, when the packet has it', async () => {
    await renderPage();
    expect(screen.getByText('Per stirpes readable text')).toBeInTheDocument();
    expect(screen.queryByText('per stirpes sigtext')).not.toBeInTheDocument();
    // Pairs from an old packet without display fields fall back to aText.
    expect(screen.getByText('bond waived')).toBeInTheDocument();
  });

  it('refuses to submit until every pair is labelled, then sends exactly the labels', async () => {
    const user = userEvent.setup();
    await renderPage();

    const submit = screen.getByRole('button', { name: /submit labels/i });
    expect(submit).toBeDisabled();

    const pair1 = within(screen.getByTestId('pair-p1'));
    await user.click(pair1.getByRole('button', { name: 'Different clauses' }));
    expect(submit).toBeDisabled(); // 1 of 2 is not enough

    const pair2 = within(screen.getByTestId('pair-p2'));
    await user.click(pair2.getByRole('button', { name: 'Different clauses' }));
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => expect(svc.submitCalibrationLabels).toHaveBeenCalledTimes(1));
    expect(svc.submitCalibrationLabels).toHaveBeenCalledWith({
      firmId: 'firm-001',
      runId: 'pilot-1',
      pairs: [
        { pairId: 'p1', label: 'different' },
        { pairId: 'p2', label: 'different' },
      ],
      boundaryMarks: [],
    });
  });

  it('persists labels locally so a closed tab loses nothing', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(
      within(screen.getByTestId('pair-p1')).getByRole('button', { name: 'Same clause' }),
    );
    const stored = JSON.parse(localStorage.getItem('clause-calibration-firm-001-pilot-1') ?? '{}');
    expect(stored.pairs).toEqual({ p1: 'same' });
  });

  it('rehydrates already-submitted server labels over an empty draft', async () => {
    svc.getCalibrationPacket.mockResolvedValue({
      packet: PACKET,
      labels: { pairs: [{ pairId: 'p1', label: 'same' }] },
      draft: null,
    });
    await renderPage();
    expect(screen.getByText(/Pairs 1\/2/)).toBeInTheDocument();
  });

  it('captures boundary marks on seed pieces and includes them in the submit', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('tab', { name: /clause boundaries/i }));
    await user.click(screen.getByRole('button', { name: 'Should split' }));

    await user.click(screen.getByRole('tab', { name: /same or different/i }));
    await user.click(
      within(screen.getByTestId('pair-p1')).getByRole('button', { name: 'Same clause' }),
    );
    await user.click(
      within(screen.getByTestId('pair-p2')).getByRole('button', { name: 'Different clauses' }),
    );
    await user.click(screen.getByRole('button', { name: /submit labels/i }));
    await waitFor(() => expect(svc.submitCalibrationLabels).toHaveBeenCalled());
    expect(svc.submitCalibrationLabels.mock.calls[0][0].boundaryMarks).toEqual([
      { pieceId: 'file1:0', mark: 'split' },
    ]);
  });

  it('shows the not-available card when the packet is missing', async () => {
    svc.getCalibrationPacket.mockRejectedValue(new Error('No calibration packet for run'));
    render(<ClauseCalibrationPage />);
    await screen.findByText(/Calibration packet not available/);
  });
});


describe('server autosave', () => {
  it('saves a debounced server draft after labelling', { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    render(<ClauseCalibrationPage />);
    await screen.findByText(/Clause Calibration — run pilot-1/);
    await user.click(
      within(screen.getByTestId('pair-p1')).getByRole('button', { name: 'Same clause' }),
    );
    expect(svc.submitCalibrationLabels).not.toHaveBeenCalled(); // debounced
    await waitFor(
      () =>
        expect(svc.submitCalibrationLabels).toHaveBeenCalledWith(
          expect.objectContaining({ draft: true, pairs: [{ pairId: 'p1', label: 'same' }] }),
        ),
      { timeout: 10_000 },
    );
  });

  it('rehydrates progress from a server draft when local storage is empty', async () => {
    svc.getCalibrationPacket.mockResolvedValue({
      packet: PACKET,
      labels: null,
      draft: { pairs: [{ pairId: 'p2', label: 'different' }] },
    });
    render(<ClauseCalibrationPage />);
    await screen.findByText(/Pairs 1\/2/);
  });
});

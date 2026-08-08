/**
 * tests/unit/interview-settings-tab.test.tsx
 *
 * D1 — the FirmInterviewSettings shell. Proves the record's write shape, not
 * just that the screen renders: autosaves are MERGED (so future sections and
 * concurrent editors never clobber existing keys), stamped with the acting
 * user, and debounced. Also pins the nine-section layout: five live sections,
 * four D7 placeholders.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { setDoc } from 'firebase/firestore';

const mockAuth = vi.hoisted(() => ({
  userProfile: { uid: 'atty-1', role: 'attorney', firmId: 'firm-001' } as Record<string, unknown> | null,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));

import InterviewSettingsTab from '@/components/settings/InterviewSettingsTab';

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(setDoc).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InterviewSettingsTab (D1)', () => {
  it('renders the five live sections and the four D7 placeholders', () => {
    render(<InterviewSettingsTab firmId="firm-001" />);

    for (const title of ['Documents', 'Trust', 'Definitions', 'Healthcare', 'Asset Schedules']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    for (const title of ['Power of Attorney', 'Deeds', 'Signing', 'Fiduciaries']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // Placeholders say when their fields arrive rather than rendering controls.
    expect(screen.getAllByText(/Fields arrive with D7/)).toHaveLength(4);
  });

  it('autosaves a toggle as a MERGED write stamped with the acting user', async () => {
    render(<InterviewSettingsTab firmId="firm-001" />);

    fireEvent.click(screen.getByLabelText('Include the Dementia Directive'));

    // Nothing is written until the debounce elapses.
    expect(vi.mocked(setDoc)).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(vi.mocked(setDoc)).toHaveBeenCalledTimes(1);
    const [, data, options] = vi.mocked(setDoc).mock.calls[0];
    expect(options).toEqual({ merge: true });
    expect(data).toMatchObject({
      firmId: 'firm-001',
      updatedBy: 'atty-1',
      healthcare: { dementiaDirective: true },
    });
  });

  it('collects incapacity determiners as a multi-select array', async () => {
    render(<InterviewSettingsTab firmId="firm-001" />);

    fireEvent.click(screen.getByText('Two physicians'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.click(screen.getByText('Trust protector'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    const last = vi.mocked(setDoc).mock.calls.at(-1)!;
    expect(last[1]).toMatchObject({
      definitions: { incapacityDeterminedBy: ['two-physicians', 'trust-protector'] },
    });
  });
});

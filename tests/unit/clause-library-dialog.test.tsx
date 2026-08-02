/**
 * The Clause Picker as the attorney meets it.
 *
 * Proves the properties the feature decision named, not just that it renders:
 * unapproved and PII-blocked mined clauses never appear as insertable options;
 * the folder/search/state filters actually narrow the list; "Use Clause"
 * delivers text with known placeholders resolved and unknown ones left
 * visible; and the questionnaire's Clause Library button is staff-only —
 * a client filling their intake must never see the firm's clause bank.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { resolveClausePlaceholders } from '@/services/clause-library-service';

const mockAuth = vi.hoisted(() => ({
  userProfile: { uid: 'atty-1', role: 'attorney', firmId: 'firm-001' } as Record<string, unknown> | null,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));

const mockCatalog = vi.hoisted(() => ({ data: [] as unknown[], loading: false, error: null }));
vi.mock('@/hooks/useFirestore', () => ({ useCollection: () => mockCatalog }));

const mockRemoveClause = vi.hoisted(() => vi.fn());
vi.mock('@/services/clause-library-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/clause-library-service')>();
  return { ...actual, addMyClause: vi.fn(), removeClause: mockRemoveClause };
});

import ClauseLibraryDialog from '@/components/clauses/ClauseLibraryDialog';

// Radix ScrollArea instantiates ResizeObserver with `new`; the global test
// stub is a plain fn, which throws only on the re-render after a click.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const CATALOG = [
  {
    id: 'c1', title: 'Spendthrift Clause', category: 'protection', status: 'approved',
    piiScanStatus: 'clean', canonicalText: 'No beneficiary may assign {{TRUST_NAME}} interests.',
    counts: { matters: 42 },
  },
  {
    id: 'c2', title: 'Bloodline Trust Clause', category: 'distribution', status: 'mined',
    piiScanStatus: 'clean', canonicalText: 'Descendants of {{GRANTOR_NAME}} only.',
  },
  {
    id: 'c3', title: 'Blocked Clause', category: 'protection', status: 'approved',
    piiScanStatus: 'blocked', canonicalText: 'Should never appear.',
  },
  {
    id: 'c4', title: 'My NY Attestation', origin: 'manual', createdBy: 'atty-1', state: 'NY',
    canonicalText: 'Signed for {{CLIENT_NAME}} at {{CITY}}.',
  },
  {
    id: 'c5', title: 'Colleague Clause', origin: 'manual', createdBy: 'atty-2', state: 'NJ',
    canonicalText: 'Another lawyer wrote this.',
  },
];

function clauseList() {
  return within(screen.getByRole('list', { name: 'Clause results' }));
}

function renderDialog(extra: Partial<Parameters<typeof ClauseLibraryDialog>[0]> = {}) {
  return render(
    <ClauseLibraryDialog
      open
      onOpenChange={() => {}}
      firmId="firm-001"
      onInsert={() => {}}
      {...extra}
    />,
  );
}

beforeEach(() => {
  mockCatalog.data = CATALOG;
  mockAuth.userProfile = { uid: 'atty-1', role: 'attorney', firmId: 'firm-001' };
});

describe('ClauseLibraryDialog', () => {
  it('offers approved and manual clauses, never unapproved or PII-blocked ones', () => {
    renderDialog();
    const list = clauseList();
    expect(list.getByText('Spendthrift Clause')).toBeInTheDocument();
    expect(list.getByText('My NY Attestation')).toBeInTheDocument();
    expect(list.queryByText('Bloodline Trust Clause')).not.toBeInTheDocument(); // not approved
    expect(list.queryByText('Blocked Clause')).not.toBeInTheDocument(); // PII-blocked
  });

  it('the My Clauses folder shows only the caller’s own manual clauses', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('tab', { name: 'My Clauses' }));
    expect(clauseList().getByText('My NY Attestation')).toBeInTheDocument();
    expect(clauseList().queryByText('Colleague Clause')).not.toBeInTheDocument();
    expect(clauseList().queryByText('Spendthrift Clause')).not.toBeInTheDocument();
  });

  it('search and state filter narrow the list', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByPlaceholderText('Search clauses…'), 'spendthrift');
    expect(clauseList().getByText('Spendthrift Clause')).toBeInTheDocument();
    expect(clauseList().queryByText('My NY Attestation')).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Search clauses…'));
    await user.selectOptions(screen.getByLabelText('Filter by state'), 'NY');
    expect(clauseList().getByText('My NY Attestation')).toBeInTheDocument();
    expect(clauseList().queryByText('Spendthrift Clause')).not.toBeInTheDocument();
  });

  it('Use Clause inserts resolved text, leaving unknown placeholders visible', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    renderDialog({ onInsert, placeholderValues: { CLIENT_NAME: 'Janice Altieri' } });
    await user.click(clauseList().getByText('My NY Attestation'));
    await user.click(screen.getByRole('button', { name: 'Use Clause' }));
    expect(onInsert).toHaveBeenCalledWith('Signed for Janice Altieri at {{CITY}}.');
  });

  it('removes a clause only after explicit confirmation', async () => {
    const user = userEvent.setup();
    mockRemoveClause.mockResolvedValue({ removed: 'tombstoned' });
    renderDialog();
    await user.click(clauseList().getByText('Spendthrift Clause'));
    await user.click(screen.getByRole('button', { name: /remove/i }));
    // Nothing is called until the confirm step.
    expect(mockRemoveClause).not.toHaveBeenCalled();
    expect(screen.getByText('Remove this clause from the library?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mockRemoveClause).toHaveBeenCalledWith({ firmId: 'firm-001', clauseId: 'c1' });
  });

  it('cancel backs out of removal without calling the service', async () => {
    const user = userEvent.setup();
    mockRemoveClause.mockClear();
    renderDialog();
    await user.click(clauseList().getByText('My NY Attestation'));
    await user.click(screen.getByRole('button', { name: /remove/i }));
    // Manual entries warn about permanence — they are hard-deleted.
    expect(screen.getByText('Delete this clause permanently?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockRemoveClause).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this clause permanently?')).not.toBeInTheDocument();
  });

  it('shows usage counts on mined clauses', () => {
    renderDialog();
    const row = clauseList().getByText('Spendthrift Clause').closest('button');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('used in 42 matters')).toBeInTheDocument();
  });
});

describe('resolveClausePlaceholders', () => {
  it('fills known tokens, keeps unknown and empty ones visible', () => {
    expect(
      resolveClausePlaceholders('{{A}} and {{B}} and {{C}}', { A: 'x', B: '' }),
    ).toBe('x and {{B}} and {{C}}');
  });
});

vi.mock('@/contexts/QuestionnaireContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/QuestionnaireContext')>();
  return {
    ...actual,
    useQuestionnaire: () => ({
      data: { personalInfo: { firstName: 'Janice', lastName: 'Altieri' } },
      updateField: vi.fn(),
      updateFields: vi.fn(),
    }),
  };
});

describe('questionnaire TextareaField gating', () => {
  const step = {
    id: 's1',
    title: 'Notes',
    fields: [{ name: 'notes', label: 'Special instructions', type: 'textarea' }],
  } as never;

  it('a client filling intake never sees the Clause Library button', async () => {
    mockAuth.userProfile = { uid: 'client-1', role: 'client', firmId: 'firm-001' };
    const { StepRenderer } = await import('@/components/questionnaire/StepRenderer');
    render(<StepRenderer step={step} />);
    expect(screen.queryByRole('button', { name: /clause library/i })).not.toBeInTheDocument();
  });

  it('an attorney sees the Clause Library button on textarea fields', async () => {
    const { StepRenderer } = await import('@/components/questionnaire/StepRenderer');
    render(<StepRenderer step={step} />);
    expect(screen.getByRole('button', { name: /clause library/i })).toBeInTheDocument();
  });
});

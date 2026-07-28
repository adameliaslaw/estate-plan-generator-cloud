/**
 * The residue block as the attorney meets it.
 *
 * Two things this proves that a type-check cannot. First, the per-stirpes notice is **on screen**
 * — the residue scope required that in as many words, because the model deliberately refuses to
 * resolve per stirpes and a refusal nobody is told about is just a missing feature. Second, the
 * pool is displayed and the shares reach the matter, so a mis-wired input fails here rather than
 * at the attorney's first save.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AssetAllocationFields } from '@/components/inheritance-tax/AssetAllocationFields';
import { ResiduarySharesFields } from '@/components/inheritance-tax/ResiduarySharesFields';
import type { ShareMode } from '@/lib/inheritance-tax-allocations';
import type { ITRAsset, ITRBeneficiary, ITRResiduaryShare } from '@/types/inheritance-tax';

const BENEFICIARIES: ITRBeneficiary[] = [
  {
    id: 'ben-1', firstName: 'Cara', lastName: 'Child', address: '1 Example St',
    relationship: 'child', bequests: [],
  },
  {
    id: 'ben-2', firstName: 'Sam', lastName: 'Sibling', address: '2 Example St',
    relationship: 'sibling', bequests: [],
  },
];

function ResidueHarness(
  { initial, pool, onShares }:
  { initial: ITRResiduaryShare[]; pool: number; onShares: (s: ITRResiduaryShare[]) => void },
) {
  const [shares, setShares] = useState(initial);
  return (
    <ResiduarySharesFields
      pool={pool}
      shares={shares}
      beneficiaries={BENEFICIARIES}
      onChange={(mutate) => setShares((prev) => {
        const next = structuredClone(prev);
        mutate(next);
        onShares(next);
        return next;
      })} />
  );
}

function AssetHarness({ initial, onAsset }: { initial: ITRAsset; onAsset: (a: ITRAsset) => void }) {
  const [asset, setAsset] = useState(initial);
  const [mode, setMode] = useState<ShareMode>('percent');
  return (
    <AssetAllocationFields
      asset={asset}
      beneficiaries={BENEFICIARIES}
      mode={mode}
      onModeChange={setMode}
      onChange={(mutate) => setAsset((prev) => {
        const next = structuredClone(prev);
        mutate(next);
        onAsset(next);
        return next;
      })} />
  );
}

describe('the per-stirpes notice is on screen', () => {
  it('says to enter the actual takers, and names the tax-class consequence', () => {
    render(<ResidueHarness initial={[]} pool={100_000} onShares={() => {}} />);
    expect(screen.getByText(/per stirpes is not applied/i)).toBeInTheDocument();
    // The reason, not just the rule: the substitute taker can be a different class.
    expect(screen.getByText(/Class C to Class D/i)).toBeInTheDocument();
    expect(screen.getByText(/Class A/)).toBeInTheDocument();
  });

  it('is shown even when there is no residue, because the rule is about who is entered', () => {
    render(<ResidueHarness initial={[]} pool={0} onShares={() => {}} />);
    expect(screen.getByText(/per stirpes is not applied/i)).toBeInTheDocument();
    expect(screen.getByText(/no residue to divide/i)).toBeInTheDocument();
  });
});

describe('the residue block', () => {
  it('shows the computed pool rather than asking for it', () => {
    render(<ResidueHarness initial={[]} pool={70_000} onShares={() => {}} />);
    expect(screen.getByText('$70,000.00')).toBeInTheDocument();
    expect(screen.getByText(/computed, not entered/i)).toBeInTheDocument();
  });

  it('a typed percentage reaches the matter as a fraction, with its dollars shown', async () => {
    const user = userEvent.setup();
    let latest: ITRResiduaryShare[] = [];
    render(
      <ResidueHarness
        initial={[{ beneficiaryId: 'ben-1', fraction: 0 }]}
        pool={100_000}
        onShares={(s) => { latest = s; }} />,
    );
    const input = screen.getByLabelText('Residuary share 1');
    await user.clear(input);
    await user.type(input, '60');
    expect(latest[0]?.fraction).toBeCloseTo(0.6, 10);
    expect(screen.getByText('$60,000.00')).toBeInTheDocument();
  });

  it('says so when the shares do not total 100%', async () => {
    render(
      <ResidueHarness
        initial={[{ beneficiaryId: 'ben-1', fraction: 0.6 }]}
        pool={100_000}
        onShares={() => {}} />,
    );
    expect(screen.getByText(/must total 100%/i)).toBeInTheDocument();
  });
});

describe('the share picker on an asset', () => {
  const house: ITRAsset = {
    id: 'ast-1', type: 'nj_real_property', description: '12 Oak Ave',
    fairMarketValue: 500_000, allocations: [{ beneficiaryId: 'ben-1', fraction: 0 }],
  };

  it('converts a typed percentage to a fraction and shows the dollars', async () => {
    const user = userEvent.setup();
    let latest: ITRAsset | null = null;
    render(<AssetHarness initial={house} onAsset={(a) => { latest = a; }} />);
    const input = screen.getByLabelText('Share 1');
    await user.clear(input);
    await user.type(input, '50');
    expect(latest?.allocations?.[0]?.fraction).toBe(0.5);
    expect(screen.getByText('$250,000.00')).toBeInTheDocument();
  });

  it('shows the remainder falling into the pool as the attorney allocates', () => {
    render(
      <AssetHarness
        initial={{ ...house, allocations: [{ beneficiaryId: 'ben-1', fraction: 0.5 }] }}
        onAsset={() => {}} />,
    );
    expect(screen.getByText(/\$250,000\.00 left over, which falls into the residuary pool/i))
      .toBeInTheDocument();
  });

  it('an asset with no shares reads as wholly residuary, not as an error', () => {
    render(<AssetHarness initial={{ ...house, allocations: [] }} onAsset={() => {}} />);
    expect(screen.getByText(/Wholly residuary/i)).toBeInTheDocument();
  });

  it('warns when the shares exceed the whole asset', () => {
    render(
      <AssetHarness
        initial={{
          ...house,
          allocations: [
            { beneficiaryId: 'ben-1', fraction: 0.6 },
            { beneficiaryId: 'ben-2', fraction: 0.6 },
          ],
        }}
        onAsset={() => {}} />,
    );
    expect(screen.getByText(/cannot be given away twice/i)).toBeInTheDocument();
  });
});

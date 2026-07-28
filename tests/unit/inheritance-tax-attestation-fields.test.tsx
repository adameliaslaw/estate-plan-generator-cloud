/**
 * The attestation block as the attorney meets it: which questions appear for which deduction, and
 * whether ticking the boxes and typing the basis actually produces something the server accepts.
 *
 * A type-check proves the props line up; only this proves the clicks reach the matter. The final
 * assertion in each case runs the real `validateMatter` over the deduction the component built,
 * so a mis-wired checkbox fails here rather than at the attorney's first save.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { validateMatter } from '../../functions/src/inheritance-tax/validation/matter';
import { DeductionAttestationFields } from '@/components/inheritance-tax/DeductionAttestationFields';
import type { ITRDeduction } from '@/types/inheritance-tax';

/** Mirrors the page: an immutable patch through a structured clone. */
function Harness(
  { initial, dateOfDeath, onMatter }:
  { initial: ITRDeduction; dateOfDeath: string; onMatter: (d: ITRDeduction) => void },
) {
  const [deduction, setDeduction] = useState(initial);
  return (
    <DeductionAttestationFields
      deduction={deduction}
      dateOfDeath={dateOfDeath}
      onChange={(mutate) => setDeduction((prev) => {
        const next = structuredClone(prev);
        mutate(next);
        onMatter(next);
        return next;
      })} />
  );
}

/** Does the server take a matter carrying this one deduction? */
function serverAccepts(deduction: ITRDeduction, dateOfDeath: string): boolean {
  try {
    validateMatter({
      matterId: 'ITR-TEST-1',
      createdAt: '2026-03-02T10:00:00.000Z',
      decedent: {
        firstName: 'Jane', lastName: 'Doe', ssn: '123-45-6789',
        dateOfDeath, countyOfResidence: 'Mercer', isNJResident: true,
      },
      willExists: true,
      trustExists: false,
      federalReturnFiled: false,
      virtualCurrencyExists: false,
      disclaimersExist: false,
      personalRepresentative: {
        name: 'Sam Sibling', title: 'Executor',
        address: '1 Example Street, Trenton, NJ 08600', phone: '609-555-0100',
      },
      beneficiaries: [{
        id: 'ben-001', firstName: 'Sam', lastName: 'Sibling',
        address: '1 Example Street, Trenton, NJ 08600', relationship: 'sibling',
        bequests: [{ id: 'beq-001', type: 'bank_account', description: 'Checking', fairMarketValue: 100000 }],
      }],
      deductions: [deduction],
    });
    return true;
  } catch {
    return false;
  }
}

const COMMISSION: ITRDeduction = {
  id: 'ded-001', type: 'executor_commission',
  description: 'Commission on the Ewing sale', amount: 12000,
};

const OTHER_STATE: ITRDeduction = {
  id: 'ded-002', type: 'transfer_taxes_other_states',
  description: 'PA inheritance tax', amount: 4500,
};

describe('DeductionAttestationFields', () => {
  it('asks nothing of a deduction that needs no attestation', () => {
    const { container } = render(
      <Harness
        initial={{ id: 'ded-000', type: 'funeral_expenses', description: 'Funeral', amount: 9000 }}
        dateOfDeath="2026-03-01" onMatter={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('asks nothing of a commission on a death before R.2025 d.152 took effect', () => {
    const { container } = render(
      <Harness initial={COMMISSION} dateOfDeath="2025-12-14" onMatter={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('collects the executor-commission attestation the server demands', async () => {
    const user = userEvent.setup();
    let latest: ITRDeduction = COMMISSION;
    render(<Harness initial={COMMISSION} dateOfDeath="2026-03-01"
      onMatter={(d) => { latest = d; }} />);

    // Displayed, and refused until it is answered.
    expect(screen.getByText(/18:26-7\.10\(d\)/)).toBeInTheDocument();
    expect(serverAccepts(latest, '2026-03-01')).toBe(false);

    const [residue, soldByExecutor] = screen.getAllByRole('checkbox');
    await user.click(residue!);
    // One box alone is not eligibility — the warning stands and the server still refuses.
    expect(screen.getByText(/not an allowable deduction/)).toBeInTheDocument();
    expect(serverAccepts(latest, '2026-03-01')).toBe(false);

    await user.click(soldByExecutor!);
    await user.type(screen.getByPlaceholderText(/Deed dated/), 'Deed dated 2026-03-04');

    expect(screen.queryByText(/not an allowable deduction/)).not.toBeInTheDocument();
    expect(latest.executorCommissionEligibility).toEqual({
      propertyWasResidueNotSpecificallyDevised: true,
      propertyWasSoldByExecutor: true,
      notes: 'Deed dated 2026-03-04',
    });
    expect(serverAccepts(latest, '2026-03-01')).toBe(true);
  });

  it('collects the other-jurisdiction attestation, whatever the date of death', async () => {
    const user = userEvent.setup();
    let latest: ITRDeduction = OTHER_STATE;
    render(<Harness initial={OTHER_STATE} dateOfDeath="2003-01-01"
      onMatter={(d) => { latest = d; }} />);

    expect(screen.getByText(/18:26-7\.16/)).toBeInTheDocument();
    expect(serverAccepts(latest, '2003-01-01')).toBe(false);

    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByPlaceholderText('Pennsylvania'), 'Pennsylvania');
    await user.type(screen.getByPlaceholderText(/PA inheritance tax/), 'Receipt dated 2026-02-11');

    expect(latest.transferTaxEligibility).toEqual({
      taxedPropertyIsAlsoNJTaxable: true,
      taxingJurisdiction: 'Pennsylvania',
      notes: 'Receipt dated 2026-02-11',
    });
    expect(serverAccepts(latest, '2003-01-01')).toBe(true);
  });

  it('says the deduction belongs off the return when the property is not also NJ-taxable', async () => {
    const user = userEvent.setup();
    render(<Harness initial={OTHER_STATE} dateOfDeath="2026-03-01" onMatter={() => {}} />);

    expect(screen.getByText(/not a deduction on this return/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.queryByText(/not a deduction on this return/)).not.toBeInTheDocument();
  });
});

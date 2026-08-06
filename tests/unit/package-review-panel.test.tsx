/**
 * The package review as the attorney meets it.
 *
 * Proves the properties that make the panel trustworthy rather than decorative:
 * a package that was never reviewed says nothing at all (silence is not a pass);
 * a clean package collapses to one line; outstanding findings open on arrival
 * rather than hiding behind a click; severity ordering survives into the DOM;
 * the explanation is reachable; and a truncated list admits it is truncated.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import PackageReviewPanel from '@/components/documents/PackageReviewPanel';
import type { PackageFinding, PackageReview } from '@/types';

const HIGH: PackageFinding = {
  docType: 'engagementLetter',
  title: 'Client Acknowledgment Letter',
  location: 'Body Paragraph',
  severity: 'high',
  reason: 'missing-instrument',
  summary: 'Refers to a trust, but no trust document exists in this package',
  detail:
    'This document refers to the client\'s trust as an existing instrument, but no trust ' +
    'was generated for this matter.',
};

const MEDIUM: PackageFinding = {
  docType: 'will',
  title: 'Last Will and Testament',
  location: 'Section 5.02',
  severity: 'medium',
  reason: 'statutory-limit',
  summary: 'UTMA custodianship directed to age 25; NJ caps it at 21',
  detail: 'New Jersey\'s UTMA requires transfer to the beneficiary no later than 21.',
};

function makeReview(overrides: Partial<PackageReview> = {}): PackageReview {
  const findings = overrides.findings ?? [HIGH, MEDIUM];
  return {
    findings,
    summary: {
      total: findings.length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    },
    truncated: false,
    packageType: 'foundation',
    reviewedAt: null as never,
    ...overrides,
  };
}

describe('PackageReviewPanel', () => {
  it('renders nothing when no review has ever run', () => {
    // A client whose documents predate the review pass has no record. Showing
    // "0 findings" would claim a check happened that never did.
    const { container } = render(<PackageReviewPanel review={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a clean package without listing anything', () => {
    render(<PackageReviewPanel review={makeReview({ findings: [] })} />);

    expect(screen.getByText('Package review passed')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    // Nothing to expand — the header is not an actionable control.
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('opens already expanded when findings are outstanding', () => {
    render(<PackageReviewPanel review={makeReview()} />);

    expect(screen.getByText('2 findings for review')).toBeInTheDocument();
    expect(screen.getByText(HIGH.summary)).toBeInTheDocument();
    expect(screen.getByText(MEDIUM.summary)).toBeInTheDocument();
  });

  it('singularises a lone finding', () => {
    render(<PackageReviewPanel review={makeReview({ findings: [HIGH] })} />);
    expect(screen.getByText('1 finding for review')).toBeInTheDocument();
  });

  it('summarises counts by severity in the header', () => {
    render(<PackageReviewPanel review={makeReview()} />);
    expect(screen.getByText('1 high')).toBeInTheDocument();
    expect(screen.getByText('1 medium')).toBeInTheDocument();
    expect(screen.queryByText(/low$/)).not.toBeInTheDocument();
  });

  it('preserves severity order from the engine', () => {
    render(<PackageReviewPanel review={makeReview()} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText(HIGH.summary)).toBeInTheDocument();
    expect(within(rows[1]).getByText(MEDIUM.summary)).toBeInTheDocument();
  });

  it('shows the document, location, and action label on each row', () => {
    render(<PackageReviewPanel review={makeReview({ findings: [MEDIUM] })} />);
    const row = screen.getByRole('listitem');
    // Reason renders as the action to take, not the internal taxonomy value.
    expect(within(row).getByText(/Last Will and Testament/)).toBeInTheDocument();
    expect(within(row).getByText(/Section 5\.02/)).toBeInTheDocument();
    expect(within(row).getByText(/Verify against statute/)).toBeInTheDocument();
    expect(within(row).queryByText('statutory-limit')).not.toBeInTheDocument();
  });

  it('keeps the explanation collapsed until asked for', async () => {
    const user = userEvent.setup();
    render(<PackageReviewPanel review={makeReview({ findings: [MEDIUM] })} />);

    expect(screen.queryByText(MEDIUM.detail)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: new RegExp(MEDIUM.summary) }));
    expect(screen.getByText(MEDIUM.detail)).toBeInTheDocument();
  });

  it('can be collapsed away once reviewed', async () => {
    const user = userEvent.setup();
    render(<PackageReviewPanel review={makeReview()} />);

    await user.click(screen.getByRole('button', { name: /Collapse/ }));
    expect(screen.queryByText(HIGH.summary)).not.toBeInTheDocument();
    expect(screen.getByText('2 findings for review')).toBeInTheDocument();
  });

  it('admits when the list is capped rather than looking complete', () => {
    render(
      <PackageReviewPanel
        review={makeReview({
          findings: [HIGH, MEDIUM],
          summary: { total: 60, high: 40, medium: 20, low: 0 },
          truncated: true,
        })}
      />,
    );
    expect(screen.getByText(/Showing the 2 most severe of 60 findings/)).toBeInTheDocument();
  });

  it('falls back to the doc-type label when a finding carries no title', () => {
    render(
      <PackageReviewPanel
        review={makeReview({ findings: [{ ...MEDIUM, title: '' }] })}
        docTypeLabels={{ will: 'Last Will & Testament' }}
      />,
    );
    expect(screen.getByText(/Last Will & Testament/)).toBeInTheDocument();
  });
});

/**
 * tests/unit/spouse-swap.test.ts
 *
 * Extracted spouse-swap module (spouse-swap.ts). Pins the behaviors the
 * inline unified-generator implementation guaranteed so the extraction (and
 * future reuse by high-fidelity package fills) stays behavior-identical:
 * backfill from primary, R5-035 gender gating, fiduciary re-targeting,
 * in-law translation, and the R5-003 same-sex title/pronoun derivation.
 */

import { describe, expect, it } from 'vitest';
import {
  hasSpouseData,
  swapClientDataForSpouse,
  swapClientContextForSpouse,
} from '../../functions/src/spouse-swap';
import type { ClientContext } from '../../functions/src/client-context-aggregator';

function baseClientData() {
  return {
    personalInfo: {
      firstName: 'Karen', middleName: 'A', lastName: 'Carter',
      address: '12 Main St', city: 'Haddonfield', state: 'NJ', zip: '08033',
      county: 'Camden', gender: 'Female', maritalStatus: 'Married',
    },
    spouseInfo: { firstName: 'Adam', lastName: 'Carter', dob: '1980-01-01' },
    fiduciaries: {
      healthcareProxy: {
        agent: { name: 'Adam Carter', relationship: 'Husband' },
        alternateAgent: { name: 'Beth Smith', relationship: 'Sister' },
      },
    },
  };
}

describe('hasSpouseData', () => {
  it('requires a first or last name', () => {
    expect(hasSpouseData(baseClientData())).toBe(true);
    expect(hasSpouseData({ spouseInfo: {} })).toBe(false);
    expect(hasSpouseData({})).toBe(false);
  });
});

describe('swapClientDataForSpouse', () => {
  it('swaps testator and spouse without mutating the input', () => {
    const input = baseClientData();
    const out = swapClientDataForSpouse(input);
    expect(out.personalInfo.firstName).toBe('Adam');
    expect(out.spouseInfo.firstName).toBe('Karen');
    expect(input.personalInfo.firstName).toBe('Karen'); // untouched
  });

  it('backfills household address and lastName from the primary', () => {
    const out = swapClientDataForSpouse(baseClientData());
    expect(out.personalInfo.address).toBe('12 Main St');
    expect(out.personalInfo.county).toBe('Camden');
    expect(out.personalInfo.lastName).toBe('Carter');
  });

  it('inverts gender only for Married (R5-035)', () => {
    const married = swapClientDataForSpouse(baseClientData());
    expect(married.personalInfo.gender).toBe('male');

    const dp = baseClientData();
    dp.personalInfo.maritalStatus = 'Domestic Partnership';
    const out = swapClientDataForSpouse(dp);
    expect(out.personalInfo.gender).toBeUndefined();
  });

  it('re-targets spouse-tagged fiduciaries and translates in-laws', () => {
    const out = swapClientDataForSpouse(baseClientData());
    const hc = out.fiduciaries.healthcareProxy;
    // Adam's doc must not appoint Adam as his own healthcare rep.
    expect(hc.agent.name).toBe('Karen A Carter');
    expect(hc.agent.relationship).toBe('Wife');
    expect(hc.agent.address).toBe(''); // stale address cleared for re-autofill
    expect(hc.alternateAgent.relationship).toBe('Sister-in-Law');
    expect(hc.alternateAgent.name).toBe('Beth Smith'); // same person, relabeled
  });

  it('is a no-op without spouseInfo', () => {
    const input = { personalInfo: { firstName: 'Solo' } };
    expect(swapClientDataForSpouse(input)).toBe(input);
  });
});

describe('swapClientContextForSpouse', () => {
  function baseCtx(): ClientContext {
    return {
      client: baseClientData(),
      computed: {
        clientFullName: 'Karen A Carter',
        spouseFullName: 'Adam Carter',
        clientTitle: 'wife',
        spouseTitle: 'husband',
      },
    } as unknown as ClientContext;
  }

  it('swaps computed names and mutates in place', () => {
    const ctx = baseCtx();
    swapClientContextForSpouse(ctx);
    expect(ctx.computed.clientFullName).toBe('Adam Carter');
    expect(ctx.computed.spouseFullName).toBe('Karen A Carter');
    expect((ctx.client.personalInfo as Record<string, unknown>).firstName).toBe('Adam');
  });

  it('derives spouse title/pronouns from the original primary\'s actual gender (R5-003)', () => {
    // Same-sex marriage: both female; spouse (Karen) must render wife/she,
    // never inferred by inverting the new testator's gender.
    const ctx = baseCtx();
    (ctx.client.spouseInfo as Record<string, unknown>).gender = 'Female';
    swapClientContextForSpouse(ctx);
    expect(ctx.computed.spouseTitle).toBe('wife');
    expect(ctx.computed.clientTitle).toBe('wife');
    expect(ctx.computed.spousePronouns).toEqual({ subject: 'she', object: 'her', possessive: 'her' });
    expect(ctx.computed.clientPronouns).toEqual({ subject: 'she', object: 'her', possessive: 'her' });
  });

  it('uses partner titles for Domestic Partnership', () => {
    const ctx = baseCtx();
    (ctx.client.spouseInfo as Record<string, unknown>).maritalStatus = 'Domestic Partnership';
    swapClientContextForSpouse(ctx);
    expect(ctx.computed.spouseTitle).toBe('partner');
    expect(ctx.computed.clientTitle).toBe('partner');
  });

  it('recomputes spouse-slot fiduciary pronouns from the new spouse', () => {
    const ctx = baseCtx();
    swapClientContextForSpouse(ctx);
    // healthcareProxy.agent was Husband→now Karen (Wife) → her pronouns.
    expect(ctx.computed.healthcareRepPronouns).toEqual({ subject: 'she', object: 'her', possessive: 'her' });
    // Sister→Sister-in-Law stays female by relationship inference.
    expect(ctx.computed.healthcareRepAlternatePronouns).toEqual({ subject: 'she', object: 'her', possessive: 'her' });
  });

  it('is a no-op without spouseInfo', () => {
    const ctx = { client: { personalInfo: { firstName: 'Solo' } }, computed: { clientFullName: 'Solo' } } as unknown as ClientContext;
    swapClientContextForSpouse(ctx);
    expect(ctx.computed.clientFullName).toBe('Solo');
  });
});

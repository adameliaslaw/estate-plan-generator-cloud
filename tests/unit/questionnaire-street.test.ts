/**
 * tests/unit/questionnaire-street.test.ts
 *
 * Regression test for R5-043: the Questionnaire Summary read `pi.street` /
 * `si.street`, but the canonical model field is `personalInfo.address` (there is
 * no `street` field), so the street line was silently dropped from every vaulted
 * questionnaire. The generator must render the client's `personalInfo.address`.
 */

import { describe, it, expect } from 'vitest';
import { generateQuestionnaire } from '../../functions/src/generators/questionnaire-generator';

describe('generateQuestionnaire — address rendered (R5-043)', () => {
  it("renders the client's personalInfo.address, not a nonexistent street field", async () => {
    const clientData = {
      personalInfo: {
        firstName: 'John',
        lastName: 'Smith',
        address: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'NJ',
        zip: '07000',
        maritalStatus: 'married',
      },
      spouseInfo: {
        firstName: 'Jane',
        lastName: 'Smith',
        address: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'NJ',
        zip: '07000',
      },
    };

    const result = await generateQuestionnaire(clientData, {}, 'foundation');
    expect(result.content).toContain('742 Evergreen Terrace');
  });

  it('omits the address line cleanly when no address is on file', async () => {
    const clientData = {
      personalInfo: { firstName: 'John', lastName: 'Smith', maritalStatus: 'single' },
    };
    const result = await generateQuestionnaire(clientData, {}, 'foundation');
    // No crash, and no stray street artifact.
    expect(result.content).not.toContain('undefined');
  });
});

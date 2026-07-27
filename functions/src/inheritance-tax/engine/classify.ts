import type { Relationship, TaxClass } from '../types';

/**
 * Derives NJ inheritance tax class from a beneficiary's relationship to the decedent.
 *
 * Verified against: IT-R Instructions "Beneficiary Tax Classes" section
 * (nj.gov/treasury/taxation/pdf/other_forms/inheritance/it-rinst.pdf).
 * Statutory basis: N.J.S.A. 54:34-2.
 * Verified against N.J.A.C. 18:26-1.1 (recodified from 18:26-2.1 in 2018 readoption).
 * Two additional Class D types confirmed: stepchild_in_law and mutually_acknowledged_child_in_law.
 */
export function classifyBeneficiary(relationship: Relationship): TaxClass {
  switch (relationship) {
    // Class A — exempt
    case 'spouse':
    case 'civil_union_partner':
    case 'domestic_partner':
    case 'child':
    case 'stepchild':
    case 'grandchild':
    case 'great_grandchild':
    case 'parent':
    case 'grandparent':
    case 'mutually_acknowledged_child':
      return 'A';

    // Class C — $25,000 exemption per beneficiary; 11%–16% on excess
    case 'sibling':
    case 'child_in_law':
    case 'child_civil_union_partner':
      return 'C';

    // Class D — 15%–16%; $499 de minimis
    case 'niece_nephew':
    case 'aunt_uncle':
    case 'cousin':
    case 'step_grandchild':
    case 'stepbrother_stepsister':
    case 'stepparent':
    case 'stepchild_in_law': // spouse/CU/DP of a stepchild — Class D, not C (N.J.A.C. 18:26-1.1)
    case 'mutually_acknowledged_child_in_law': // spouse/CU/DP of a mutually acknowledged child — Class D (N.J.A.C. 18:26-1.1)
    case 'ex_spouse':
    case 'friend':
    case 'non_certified_domestic_partner':
    case 'corporation_non_charitable':
    case 'other_individual':
      return 'D';

    // Class E — exempt
    case 'charity':
    case 'religious_organization':
    case 'educational_organization':
    case 'medical_institution':
    case 'governmental_entity':
      return 'E';

    default: {
      // Compile-time exhaustiveness check — if a new Relationship variant is added
      // without a case here, TypeScript will error on the never assignment below.
      // At runtime this guards against unexpected values from deserialization.
      const _exhaustive: never = relationship;
      throw new Error(`Unrecognized relationship value: ${String(_exhaustive)}`);
    }
  }
}

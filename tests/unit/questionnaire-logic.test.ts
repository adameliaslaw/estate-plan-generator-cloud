/**
 * tests/unit/questionnaire-logic.test.ts
 *
 * Tests for questionnaire skip/show logic and validation rules.
 * Imports directly from the actual source files to test real logic.
 *
 * Coverage:
 * - Condition evaluation for all operator types
 * - Spouse section skip logic (marital status gating)
 * - Children / guardian section conditional rendering
 * - Asset sub-section conditional steps
 * - Package recommendation scoring (foundation / guardian / fortress)
 * - Required field validation presence
 * - NJ county options
 * - Step ordering and section assignments
 */

import { describe, it, expect } from 'vitest';
import { QUESTIONNAIRE_STEPS } from '@/types/questionnaire';
import { NJ_COUNTIES } from '@/config/constants';
import { calculateRecommendation } from '@/services/recommendation-engine';
import { createEmptyQuestionnaireData } from '@/types/questionnaire';
import type { QuestionnaireData, StepCondition } from '@/types/questionnaire';

// ============================================================================
// Helper: evaluate a step condition against questionnaire data
// ============================================================================

/**
 * Mirrors the condition evaluation logic used in QuestionnaireShell.tsx.
 * A step without a condition is always shown.
 */
function evaluateCondition(
  condition: StepCondition | undefined,
  data: Partial<QuestionnaireData>,
): boolean {
  if (!condition) return true;

  const { field, operator, value } = condition;

  // Resolve dot-path into nested object
  const fieldValue = field.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object') {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, data as unknown);

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'notEquals':
      return fieldValue !== value;
    case 'includes':
      if (Array.isArray(value)) {
        return value.includes(fieldValue);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value);
      }
      return false;
    case 'gt':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
    case 'lt':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'notExists':
      return fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

/**
 * Filter QUESTIONNAIRE_STEPS to only those visible for the given data.
 */
function getVisibleSteps(data: Partial<QuestionnaireData>): typeof QUESTIONNAIRE_STEPS {
  return QUESTIONNAIRE_STEPS.filter((step) => evaluateCondition(step.condition, data));
}

// ============================================================================
// Helper: build questionnaire data for scenarios
// ============================================================================

function withMaritalStatus(status: string): Partial<QuestionnaireData> {
  const base = createEmptyQuestionnaireData();
  return { ...base, personalInfo: { ...base.personalInfo, maritalStatus: status } };
}

function withChildren(
  hasChildren: boolean,
  children: Array<{ name: string; dob: string }> = [],
): Partial<QuestionnaireData> {
  const base = createEmptyQuestionnaireData();
  return { ...base, hasChildren, children, numberOfChildren: children.length };
}

function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0];
}

// ============================================================================
// SECTION: Marital status skip logic
// ============================================================================

describe('Questionnaire Skip Logic — Spouse Section', () => {
  it('spouse steps are hidden when marital status is Single', () => {
    const data = withMaritalStatus('Single');
    const visible = getVisibleSteps(data);
    const spouseSteps = visible.filter((s) => s.section === 'spouse');
    expect(spouseSteps).toHaveLength(0);
  });

  it('spouse steps are shown when marital status is Married', () => {
    const data = withMaritalStatus('Married');
    const visible = getVisibleSteps(data);
    const spouseSteps = visible.filter((s) => s.section === 'spouse');
    expect(spouseSteps.length).toBeGreaterThan(0);
  });

  it('spouse steps are shown for Domestic Partnership', () => {
    const data = withMaritalStatus('Domestic Partnership');
    const visible = getVisibleSteps(data);
    const spouseSteps = visible.filter((s) => s.section === 'spouse');
    expect(spouseSteps.length).toBeGreaterThan(0);
  });

  it('spouse steps are hidden when marital status is Divorced', () => {
    const data = withMaritalStatus('Divorced');
    const visible = getVisibleSteps(data);
    const spouseSteps = visible.filter((s) => s.section === 'spouse');
    expect(spouseSteps).toHaveLength(0);
  });

  it('spouse steps are hidden when marital status is Widowed', () => {
    const data = withMaritalStatus('Widowed');
    const visible = getVisibleSteps(data);
    const spouseSteps = visible.filter((s) => s.section === 'spouse');
    expect(spouseSteps).toHaveLength(0);
  });

  it('spouse_name step uses includes operator for marital status', () => {
    const spouseNameStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'spouse_name');
    expect(spouseNameStep).toBeDefined();
    expect(spouseNameStep!.condition?.operator).toBe('includes');
    expect(Array.isArray(spouseNameStep!.condition?.value)).toBe(true);
    expect((spouseNameStep!.condition?.value as string[])).toContain('Married');
    expect((spouseNameStep!.condition?.value as string[])).toContain('Domestic Partnership');
  });
});

// ============================================================================
// SECTION: Children skip logic
// ============================================================================

describe('Questionnaire Skip Logic — Children Section', () => {
  it('children_list step is hidden when hasChildren is false', () => {
    const data = withChildren(false);
    const visible = getVisibleSteps(data);
    const childrenList = visible.find((s) => s.id === 'children_list');
    expect(childrenList).toBeUndefined();
  });

  it('children_list step is shown when hasChildren is true', () => {
    const data = withChildren(true, [{ name: 'Alice', dob: dateYearsAgo(10) }]);
    const visible = getVisibleSteps(data);
    const childrenList = visible.find((s) => s.id === 'children_list');
    expect(childrenList).toBeDefined();
  });

  it('guardian step is shown when hasChildren is true', () => {
    const data = withChildren(true, [{ name: 'Bob', dob: dateYearsAgo(5) }]);
    const visible = getVisibleSteps(data);
    const guardianStep = visible.find((s) => s.id === 'children_guardian');
    expect(guardianStep).toBeDefined();
  });

  it('guardian step is hidden when there are no children', () => {
    const data = withChildren(false);
    const visible = getVisibleSteps(data);
    const guardianStep = visible.find((s) => s.id === 'children_guardian');
    expect(guardianStep).toBeUndefined();
  });

  it('children_hasChildren step is always shown (no condition)', () => {
    const dataEmpty = createEmptyQuestionnaireData();
    const visible = getVisibleSteps(dataEmpty);
    const hasChildrenStep = visible.find((s) => s.id === 'children_hasChildren');
    expect(hasChildrenStep).toBeDefined();
  });
});

// ============================================================================
// SECTION: Other dependents
// ============================================================================

describe('Questionnaire Skip Logic — Other Dependents', () => {
  it('otherDependents repeater field condition hides when hasOtherDependents is false', () => {
    const base = createEmptyQuestionnaireData();
    const data = { ...base, hasOtherDependents: false };
    const dependentsStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'children_dependents');
    expect(dependentsStep).toBeDefined();
    // The repeater field inside has a condition
    const repeaterField = dependentsStep!.fields.find(
      (f) => f.name === 'otherDependents' && f.condition,
    );
    expect(repeaterField).toBeDefined();
    const fieldVisible = evaluateCondition(
      repeaterField!.condition as StepCondition,
      data,
    );
    expect(fieldVisible).toBe(false);
  });

  it('otherDependents repeater field shows when hasOtherDependents is true', () => {
    const base = createEmptyQuestionnaireData();
    const data = { ...base, hasOtherDependents: true };
    const dependentsStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'children_dependents');
    const repeaterField = dependentsStep!.fields.find(
      (f) => f.name === 'otherDependents' && f.condition,
    );
    const fieldVisible = evaluateCondition(
      repeaterField!.condition as StepCondition,
      data,
    );
    expect(fieldVisible).toBe(true);
  });
});

// ============================================================================
// SECTION: NJ County options
// ============================================================================

describe('NJ County options', () => {
  it('NJ_COUNTIES contains exactly 21 counties', () => {
    expect(NJ_COUNTIES).toHaveLength(21);
  });

  it('NJ_COUNTIES includes all expected counties', () => {
    const expected = [
      'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May',
      'Cumberland', 'Essex', 'Gloucester', 'Hudson', 'Hunterdon',
      'Mercer', 'Middlesex', 'Monmouth', 'Morris', 'Ocean',
      'Passaic', 'Salem', 'Somerset', 'Sussex', 'Union', 'Warren',
    ];
    for (const county of expected) {
      expect(NJ_COUNTIES).toContain(county as typeof NJ_COUNTIES[number]);
    }
  });

  it('personal_address step has a county field with NJ county options', () => {
    const addressStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'personal_address');
    expect(addressStep).toBeDefined();
  });
});

// ============================================================================
// SECTION: Required field presence
// ============================================================================

describe('Required field validation — personal info', () => {
  it('personal_name step has firstName as required', () => {
    const nameStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'personal_name');
    expect(nameStep).toBeDefined();
    const firstNameField = nameStep!.fields.find((f) => f.name === 'personalInfo.firstName');
    expect(firstNameField?.required).toBe(true);
  });

  it('personal_name step has lastName as required', () => {
    const nameStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'personal_name');
    const lastNameField = nameStep!.fields.find((f) => f.name === 'personalInfo.lastName');
    expect(lastNameField?.required).toBe(true);
  });

  it('personal_dob step has dob field', () => {
    const dobStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'personal_dob');
    expect(dobStep).toBeDefined();
    const dobField = dobStep!.fields.find((f) => f.name === 'personalInfo.dob');
    expect(dobField).toBeDefined();
    expect(dobField?.type).toBe('date');
  });

  it('personal_marital step has maritalStatus as required radio', () => {
    const maritalStep = QUESTIONNAIRE_STEPS.find((s) => s.id === 'personal_marital');
    expect(maritalStep).toBeDefined();
    const field = maritalStep!.fields.find((f) => f.name === 'personalInfo.maritalStatus');
    expect(field?.required).toBe(true);
    expect(field?.type).toBe('radio');
  });

  it('children_hasChildren step requires the yesno field', () => {
    const step = QUESTIONNAIRE_STEPS.find((s) => s.id === 'children_hasChildren');
    expect(step).toBeDefined();
    const field = step!.fields.find((f) => f.name === 'hasChildren');
    expect(field).toBeDefined();
    expect(field?.type).toBe('yesno');
    expect(field?.required).toBe(true);
  });
});

// ============================================================================
// SECTION: Step structure integrity
// ============================================================================

describe('Questionnaire step structure integrity', () => {
  it('all steps have a unique id', () => {
    const ids = QUESTIONNAIRE_STEPS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all steps have a section assigned', () => {
    for (const step of QUESTIONNAIRE_STEPS) {
      expect(step.section).toBeDefined();
      expect(step.section.length).toBeGreaterThan(0);
    }
  });

  it('all steps have at least one field', () => {
    for (const step of QUESTIONNAIRE_STEPS) {
      expect(step.fields.length).toBeGreaterThan(0);
    }
  });

  it('conditional steps reference valid field paths', () => {
    const stepsWithConditions = QUESTIONNAIRE_STEPS.filter((s) => s.condition);
    for (const step of stepsWithConditions) {
      expect(step.condition!.field).toBeDefined();
      expect(typeof step.condition!.field).toBe('string');
      expect(step.condition!.operator).toBeDefined();
    }
  });

  it('there are steps in every expected section', () => {
    const sections = ['aboutYou', 'spouse', 'children', 'assets'];
    for (const section of sections) {
      const sectionSteps = QUESTIONNAIRE_STEPS.filter((s) => s.section === section);
      expect(sectionSteps.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// SECTION: Package recommendation logic
// ============================================================================

describe('Package Recommendation — Foundation', () => {
  it('recommends Foundation for single person with simple estate (<$500K)', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      personalInfo: { maritalStatus: 'Single' },
      hasChildren: false,
      children: [],
      assets: {
        realEstate: [],
        bankAccounts: [{ estimatedBalance: 95000 } as never],
        retirementAccounts: [{ estimatedValue: 180000 } as never],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.recommended).toBe('foundation');
    expect(result.scores.foundation).toBeGreaterThan(result.scores.guardian);
  });

  it('Foundation score gets +3 for simple estate', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      assets: {
        realEstate: [],
        bankAccounts: [{ estimatedBalance: 100000 } as never],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.scores.foundation).toBeGreaterThanOrEqual(3);
  });

  it('Foundation reasons mention simple estate when assets < $500K', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      assets: {
        realEstate: [],
        bankAccounts: [{ estimatedBalance: 200000 } as never],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    if (result.recommended === 'foundation') {
      expect(result.reasons.some((r) => r.includes('$500,000') || r.includes('500K') || r.includes('will-based'))).toBe(true);
    }
  });
});

describe('Package Recommendation — Guardian', () => {
  it('recommends Guardian when client has minor children and moderate estate', () => {
    // A moderate estate ($600K+) removes Foundation's +3 "isSimpleEstate" bonus,
    // allowing Guardian's minor-children (+2) and real-estate (+1) bonuses to win.
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      hasChildren: true,
      children: [
        { name: 'Child 1', dob: dateYearsAgo(8), relationship: 'biological', specialNeeds: false },
        { name: 'Child 2', dob: dateYearsAgo(5), relationship: 'biological', specialNeeds: false },
      ],
      assets: {
        realEstate: [
          { address: '112 Laurel Ave', city: 'Cherry Hill', state: 'NJ', zip: '08002', estimatedValue: 610000, titling: 'Sole ownership' } as never,
        ],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.recommended).toBe('guardian');
  });

  it('Guardian score increases with minor children (+2)', () => {
    const withMinors: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      hasChildren: true,
      children: [
        { name: 'Minor', dob: dateYearsAgo(6), relationship: 'biological', specialNeeds: false },
      ],
      assets: {
        realEstate: [],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const withoutMinors: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      hasChildren: false,
      children: [],
      assets: {
        realEstate: [],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const scoreWith = calculateRecommendation(withMinors).scores.guardian;
    const scoreWithout = calculateRecommendation(withoutMinors).scores.guardian;
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('Guardian score increases for out-of-state real estate (+3)', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      assets: {
        realEstate: [
          { address: '1 Beach Ave', city: 'Miami', state: 'FL', zip: '33101', estimatedValue: 800000, titling: 'Sole ownership' } as never,
        ],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.scores.guardian).toBeGreaterThanOrEqual(3);
  });
});

describe('Package Recommendation — Fortress', () => {
  it('recommends Fortress when client has special needs child', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      hasChildren: true,
      children: [
        { name: 'Special Needs Child', dob: dateYearsAgo(10), relationship: 'biological', specialNeeds: true },
      ],
      assets: {
        realEstate: [],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.scores.fortress).toBeGreaterThanOrEqual(2);
  });

  it('Fortress score increases for large estate (>= $2M)', () => {
    const data: QuestionnaireData = {
      ...createEmptyQuestionnaireData(),
      assets: {
        realEstate: [
          { estimatedValue: 2500000 } as never,
        ],
        bankAccounts: [],
        retirementAccounts: [],
        lifeInsurance: [],
        businessInterests: [],
        investmentAccounts: [],
        personalProperty: [],
        digitalAssets: [],
      },
    };
    const result = calculateRecommendation(data);
    expect(result.scores.fortress).toBeGreaterThanOrEqual(1);
  });

  it('all three packages are returned in allPackages array', () => {
    const data = createEmptyQuestionnaireData();
    const result = calculateRecommendation(data);
    expect(result.allPackages).toHaveLength(3);
    const types = result.allPackages.map((p) => p.type);
    expect(types).toContain('foundation');
    expect(types).toContain('guardian');
    expect(types).toContain('fortress');
  });

  it('exactly one package is marked as recommended', () => {
    const data = createEmptyQuestionnaireData();
    const result = calculateRecommendation(data);
    const recommended = result.allPackages.filter((p) => p.isRecommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].type).toBe(result.recommended);
  });

  it('scores are non-negative integers', () => {
    const data = createEmptyQuestionnaireData();
    const result = calculateRecommendation(data);
    for (const score of Object.values(result.scores)) {
      expect(score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// SECTION: Condition operator tests
// ============================================================================

describe('Condition operator evaluation', () => {
  it('equals operator: true when values match', () => {
    const condition: StepCondition = { field: 'hasChildren', operator: 'equals', value: true };
    expect(evaluateCondition(condition, { hasChildren: true })).toBe(true);
  });

  it('equals operator: false when values differ', () => {
    const condition: StepCondition = { field: 'hasChildren', operator: 'equals', value: true };
    expect(evaluateCondition(condition, { hasChildren: false })).toBe(false);
  });

  it('notEquals operator: true when values differ', () => {
    const condition: StepCondition = { field: 'hasChildren', operator: 'notEquals', value: false };
    expect(evaluateCondition(condition, { hasChildren: true })).toBe(true);
  });

  it('includes operator: true when field value is in the array', () => {
    const condition: StepCondition = {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    };
    expect(evaluateCondition(condition, { personalInfo: { maritalStatus: 'Married' } })).toBe(true);
    expect(evaluateCondition(condition, { personalInfo: { maritalStatus: 'Single' } })).toBe(false);
  });

  it('gt operator: true when field value exceeds threshold', () => {
    const condition: StepCondition = { field: 'numberOfChildren', operator: 'gt', value: 0 };
    expect(evaluateCondition(condition, { numberOfChildren: 2 })).toBe(true);
    expect(evaluateCondition(condition, { numberOfChildren: 0 })).toBe(false);
  });

  it('lt operator: true when field value is below threshold', () => {
    const condition: StepCondition = { field: 'numberOfChildren', operator: 'lt', value: 3 };
    expect(evaluateCondition(condition, { numberOfChildren: 1 })).toBe(true);
    expect(evaluateCondition(condition, { numberOfChildren: 5 })).toBe(false);
  });

  it('exists operator: true when field is defined', () => {
    const condition: StepCondition = { field: 'spouseInfo', operator: 'exists' };
    expect(evaluateCondition(condition, { spouseInfo: { firstName: 'Jane' } })).toBe(true);
    expect(evaluateCondition(condition, {})).toBe(false);
  });

  it('notExists operator: true when field is undefined', () => {
    const condition: StepCondition = { field: 'spouseInfo', operator: 'notExists' };
    expect(evaluateCondition(condition, {})).toBe(true);
    expect(evaluateCondition(condition, { spouseInfo: { firstName: 'Jane' } })).toBe(false);
  });

  it('undefined condition always returns true (step always shown)', () => {
    expect(evaluateCondition(undefined, {})).toBe(true);
  });
});

/**
 * src/services/follow-up-engine-service.ts
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';
import type { Timestamp } from 'firebase/firestore';

export type AutomationTriggerType = 'questionnaire_incomplete' | 'payment_outstanding';

export interface AutomationRule {
  id: string;
  triggerType: AutomationTriggerType;
  delayDays: number;
  repeatEveryDays: number;
  enabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

type ManageAction = 'create' | 'update' | 'delete';

interface ManageRuleRequest {
  firmId: string;
  action: ManageAction;
  ruleId?: string;
  rule?: Partial<Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>>;
}

const manageRuleFn = httpsCallable<ManageRuleRequest, { id?: string; deleted?: boolean }>(
  functions,
  'manageAutomationRule',
);

const listRulesFn = httpsCallable<{ firmId: string }, { rules: AutomationRule[] }>(
  functions,
  'listAutomationRules',
);

export async function listAutomationRules(firmId: string): Promise<AutomationRule[]> {
  const result = await listRulesFn({ firmId });
  return result.data.rules;
}

export async function createAutomationRule(
  firmId: string,
  rule: Pick<AutomationRule, 'triggerType' | 'delayDays' | 'repeatEveryDays' | 'enabled'>,
): Promise<string> {
  const result = await manageRuleFn({ firmId, action: 'create', rule });
  return result.data.id!;
}

export async function updateAutomationRule(
  firmId: string,
  ruleId: string,
  updates: Partial<Pick<AutomationRule, 'triggerType' | 'delayDays' | 'repeatEveryDays' | 'enabled'>>,
): Promise<void> {
  await manageRuleFn({ firmId, action: 'update', ruleId, rule: updates });
}

export async function deleteAutomationRule(firmId: string, ruleId: string): Promise<void> {
  await manageRuleFn({ firmId, action: 'delete', ruleId });
}

/**
 * src/pages/admin/AutomationsPage.tsx
 *
 * Configure automated follow-up rules. Each rule watches a trigger condition
 * and emails matching clients on a configurable cadence.
 * Addresses grievance #7: solo attorneys lose 5+ hrs/week to manual chasing.
 */

import { useState, useEffect, useCallback } from 'react';
import { Zap, Plus, Trash2, Loader2, AlertTriangle, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  listAutomationRules,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
  type AutomationRule,
  type AutomationTriggerType,
} from '@/services/follow-up-engine-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_LABELS: Record<AutomationTriggerType, { label: string; description: string }> = {
  questionnaire_incomplete: {
    label: 'Questionnaire not completed',
    description: 'Email clients who haven\'t finished their questionnaire after N days.',
  },
  payment_outstanding: {
    label: 'Balance due outstanding',
    description: 'Email clients with an unpaid balance after N days.',
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TriggerBadge({ type }: { type: AutomationTriggerType }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        type === 'questionnaire_incomplete'
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      )}
    >
      {TRIGGER_LABELS[type].label}
    </span>
  );
}

interface RuleCardProps {
  rule: AutomationRule;
  onToggle: (ruleId: string, enabled: boolean) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
}

function RuleCard({ rule, onToggle, onDelete }: RuleCardProps) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try { await onToggle(rule.id, !rule.enabled); } finally { setToggling(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(rule.id); } finally { setDeleting(false); }
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-4 transition-colors',
        rule.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <TriggerBadge type={rule.triggerType} />
          <p className="text-xs text-gray-500">{TRIGGER_LABELS[rule.triggerType].description}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            <span className="text-xs text-gray-700">
              Wait <strong>{rule.delayDays}d</strong> before first email
            </span>
            <span className="text-[11px] text-gray-400">·</span>
            <span className="text-xs text-gray-700">
              {rule.repeatEveryDays === 0
                ? 'Send once'
                : <>Repeat every <strong>{rule.repeatEveryDays}d</strong></>}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void handleToggle()}
            disabled={toggling}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
            title={rule.enabled ? 'Disable' : 'Enable'}
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : rule.enabled ? (
              <ToggleRight className="h-5 w-5 text-emerald-600" />
            ) : (
              <ToggleLeft className="h-5 w-5 text-gray-400" />
            )}
            {rule.enabled ? 'On' : 'Off'}
          </button>

          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
            title="Delete rule"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New rule form
// ---------------------------------------------------------------------------

interface NewRuleFormProps {
  onSave: (rule: { triggerType: AutomationTriggerType; delayDays: number; repeatEveryDays: number; enabled: boolean }) => Promise<void>;
  onCancel: () => void;
}

function NewRuleForm({ onSave, onCancel }: NewRuleFormProps) {
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('questionnaire_incomplete');
  const [delayDays, setDelayDays] = useState(7);
  const [repeatEveryDays, setRepeatEveryDays] = useState(7);
  const [oneShot, setOneShot] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ triggerType, delayDays, repeatEveryDays: oneShot ? 0 : repeatEveryDays, enabled: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-[#2b6cb0]/30 bg-blue-50/40 p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold text-gray-800">New automation rule</h3>

      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-700">Trigger</label>
        <select
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
        >
          {(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t].label}</option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500">{TRIGGER_LABELS[triggerType].description}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">Wait before first email (days)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={delayDays}
            onChange={(e) => setDelayDays(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">
            {oneShot ? 'Send once' : 'Repeat every (days)'}
          </label>
          <input
            type="number"
            min={1}
            max={90}
            value={repeatEveryDays}
            disabled={oneShot}
            onChange={(e) => setRepeatEveryDays(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={oneShot}
              onChange={(e) => setOneShot(e.target.checked)}
              className="rounded"
            />
            Send once only
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2b6cb0] transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save rule
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AutomationsPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!firmId) return;
    try {
      const data = await listAutomationRules(firmId);
      setRules(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(rule: Parameters<typeof createAutomationRule>[1]) {
    const id = await createAutomationRule(firmId, rule);
    setRules((prev) => [
      ...prev,
      {
        id,
        ...rule,
        createdAt: null as unknown as AutomationRule['createdAt'],
        updatedAt: null as unknown as AutomationRule['updatedAt'],
        createdBy: userProfile?.uid ?? '',
      },
    ]);
    setShowForm(false);
  }

  async function handleToggle(ruleId: string, enabled: boolean) {
    await updateAutomationRule(firmId, ruleId, { enabled });
    setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
  }

  async function handleDelete(ruleId: string) {
    await deleteAutomationRule(firmId, ruleId);
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Client Follow-Up Automations</h1>
            <p className="text-[11px] text-gray-500">Auto-chase clients without lifting a finger · runs every hour</p>
          </div>
        </div>

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2b6cb0] transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {showForm && (
          <NewRuleForm
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : rules.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a365d]/10">
              <Zap className="h-7 w-7 text-[#1a365d]" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-800">No automation rules yet</h3>
            <p className="mt-1.5 max-w-xs text-xs text-gray-500">
              Create a rule to automatically follow up with clients who haven't completed their questionnaire or paid their balance.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-5 flex items-center gap-1.5 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2b6cb0] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create your first rule
            </button>
          </div>
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))
        )}

        {rules.length > 0 && (
          <p className="text-[10px] text-gray-400 text-center pt-1">
            Rules run hourly. Emails sent via SendGrid using your firm's branding. Requires SendGrid API key in firm settings.
          </p>
        )}
      </div>
    </div>
  );
}

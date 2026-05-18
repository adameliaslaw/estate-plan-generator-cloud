/**
 * src/pages/admin/BillingCalculatorPage.tsx
 *
 * Stop undercharging for AI-assisted work. Inputs: matter type, AI tools
 * used, actual hours logged. Outputs: suggested flat fee + reasoning.
 * Addresses grievance #8: billable hour collapses when AI cuts research
 * from 10 hrs → 1 hr.
 */

import { useState, useMemo } from 'react';
import { Calculator, DollarSign, Clock, TrendingUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MATTER_COMPARABLES, AI_TOOLS } from '@/data/matter-comparables';

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

interface CalcInput {
  matterId: string;
  actualHours: number;
  selectedToolIds: string[];
  hourlyRate: number;
}

interface CalcOutput {
  matterLabel: string;
  marketFlatFee: number;
  traditionalHours: number;
  aiHoursSaved: number;
  suggestedFlatFee: number;
  effectiveHourlyRate: number;
  reasoning: string[];
}

function calculate(input: CalcInput): CalcOutput | null {
  const matter = MATTER_COMPARABLES.find((m) => m.id === input.matterId);
  if (!matter) return null;

  const aiHoursSaved = input.selectedToolIds
    .map((id) => AI_TOOLS.find((t) => t.id === id)?.hoursSaved ?? 0)
    .reduce((a, b) => a + b, 0);

  // Anchor: market flat fee. Adjustment factor balances market value with
  // efficiency: charging full market fee when AI cut the work in half is
  // ethically defensible but increasingly contested; pure hourly billing
  // gives away the productivity. We split the difference.
  const expectedHours = Math.max(matter.traditionalHours - aiHoursSaved, matter.traditionalHours * 0.3);
  const efficiencyRatio = input.actualHours / expectedHours; // 1.0 = expected; <1 = faster; >1 = harder than typical

  let adjustment = 1.0;
  if (efficiencyRatio < 0.5) adjustment = 0.85; // suggest small discount for dramatic AI gains
  else if (efficiencyRatio > 1.3) adjustment = 1.15; // suggest premium for harder matter
  const suggestedFlatFee = Math.round((matter.flatFee * adjustment) / 25) * 25;

  const effectiveHourlyRate = input.actualHours > 0 ? suggestedFlatFee / input.actualHours : 0;

  const reasoning: string[] = [];
  reasoning.push(
    `Market comparable for ${matter.label}: $${matter.flatFee.toLocaleString()} flat (typical ${matter.traditionalHours} hrs without AI).`,
  );
  if (input.selectedToolIds.length > 0) {
    reasoning.push(
      `AI tools used: ${input.selectedToolIds.length} (saves ~${aiHoursSaved.toFixed(1)} hrs based on tool benchmarks).`,
    );
  }
  reasoning.push(
    `You logged ${input.actualHours} hrs; expected with AI assistance is ~${expectedHours.toFixed(1)} hrs.`,
  );
  if (adjustment < 1) {
    reasoning.push(
      `Suggested fee is ${Math.round((1 - adjustment) * 100)}% below market — AI made this dramatically faster than typical.`,
    );
  } else if (adjustment > 1) {
    reasoning.push(
      `Suggested fee is ${Math.round((adjustment - 1) * 100)}% above market — this matter took longer than the AI-assisted average.`,
    );
  } else {
    reasoning.push(`Suggested fee matches market — your time aligns with the AI-assisted average.`);
  }
  if (input.hourlyRate > 0) {
    const hourlyBilled = input.actualHours * input.hourlyRate;
    if (hourlyBilled < suggestedFlatFee) {
      reasoning.push(
        `Billing hourly at $${input.hourlyRate}/hr would yield $${hourlyBilled.toLocaleString()} — $${(suggestedFlatFee - hourlyBilled).toLocaleString()} less than the flat-fee suggestion.`,
      );
    }
  }

  return {
    matterLabel: matter.label,
    marketFlatFee: matter.flatFee,
    traditionalHours: matter.traditionalHours,
    aiHoursSaved,
    suggestedFlatFee,
    effectiveHourlyRate,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4 shadow-sm',
        highlight ? 'border-[#1a365d]/30 bg-[#1a365d]/5' : 'border-gray-200 bg-white',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Icon className={cn('h-3.5 w-3.5', highlight ? 'text-[#1a365d]' : 'text-gray-400')} />
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          'mt-1.5 text-2xl font-semibold',
          highlight ? 'text-[#1a365d]' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      {sublabel && <p className="text-[11px] text-gray-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BillingCalculatorPage() {
  const [matterId, setMatterId] = useState<string>(MATTER_COMPARABLES[0].id);
  const [actualHours, setActualHours] = useState<number>(0);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [hourlyRate, setHourlyRate] = useState<number>(350);

  const result = useMemo(
    () => calculate({ matterId, actualHours, selectedToolIds, hourlyRate }),
    [matterId, actualHours, selectedToolIds, hourlyRate],
  );

  function toggleTool(id: string) {
    setSelectedToolIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  const showResult = result && actualHours > 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Left panel — inputs ──────────────────────────────────────────────── */}
      <div className="flex flex-[5] flex-col min-h-0 border-r border-gray-200 bg-gray-50">
        <div className="shrink-0 flex items-center gap-2.5 border-b border-gray-200 bg-white px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
            <Calculator className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Value Billing Calculator</h1>
            <p className="text-[11px] text-gray-500">Stop billing hourly for work AI did in minutes</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-5">
          {/* Matter type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Matter type</label>
            <select
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
            >
              {MATTER_COMPARABLES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — ${m.flatFee.toLocaleString()} / {m.traditionalHours}h typical
                </option>
              ))}
            </select>
          </div>

          {/* Actual hours */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Hours logged</label>
              <input
                type="number"
                step={0.5}
                min={0}
                max={200}
                value={actualHours || ''}
                onChange={(e) => setActualHours(Number(e.target.value))}
                placeholder="0"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Your hourly rate ($)</label>
              <input
                type="number"
                step={25}
                min={0}
                max={2000}
                value={hourlyRate || ''}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
              />
            </div>
          </div>

          {/* AI tools */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">AI tools used on this matter</label>
            <div className="grid grid-cols-1 gap-2">
              {AI_TOOLS.map((tool) => {
                const active = selectedToolIds.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-[#1a365d] bg-[#1a365d]/5'
                        : 'border-gray-200 bg-white hover:border-gray-300',
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn('text-sm font-medium', active ? 'text-[#1a365d]' : 'text-gray-800')}>
                        {tool.label}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{tool.description}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        active ? 'bg-[#1a365d] text-white' : 'bg-gray-100 text-gray-500',
                      )}
                    >
                      ~{tool.hoursSaved}h saved
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel — result ─────────────────────────────────────────────── */}
      <div className="flex flex-[5] flex-col min-h-0 bg-white">
        <div className="shrink-0 flex items-center gap-2 border-b border-gray-200 px-4 py-3.5">
          <Sparkles className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Suggested Fee</h2>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
          {!showResult && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a365d]/10">
                <Calculator className="h-7 w-7 text-[#1a365d]" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-800">Enter your matter details</h3>
              <p className="mt-1.5 max-w-xs text-xs text-gray-500">
                Pick a matter type, log hours, and select the AI tools you used. We'll suggest a
                flat fee anchored to market comparables.
              </p>
            </div>
          )}

          {showResult && result && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={DollarSign}
                  label="Suggested flat fee"
                  value={`$${result.suggestedFlatFee.toLocaleString()}`}
                  sublabel={`Market: $${result.marketFlatFee.toLocaleString()}`}
                  highlight
                />
                <StatCard
                  icon={TrendingUp}
                  label="Effective hourly"
                  value={`$${Math.round(result.effectiveHourlyRate).toLocaleString()}/hr`}
                  sublabel={`vs. your $${hourlyRate}/hr rate`}
                />
                <StatCard
                  icon={Clock}
                  label="Hours saved by AI"
                  value={`~${result.aiHoursSaved.toFixed(1)}h`}
                  sublabel={`Traditional: ${result.traditionalHours}h`}
                />
                <StatCard
                  icon={Clock}
                  label="Your time"
                  value={`${actualHours}h`}
                  sublabel={`${selectedToolIds.length} AI tool${selectedToolIds.length === 1 ? '' : 's'}`}
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reasoning</p>
                <ul className="space-y-1.5">
                  {result.reasoning.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-700 leading-relaxed">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[10px] text-gray-400 text-center pt-1">
                Anchored to NJ market comparables. Always reconcile against your engagement letter and applicable
                fee rules before sending an invoice.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

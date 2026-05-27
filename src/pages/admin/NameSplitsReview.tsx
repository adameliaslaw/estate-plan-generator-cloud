/**
 * Admin review queue for the 2026-05-27 name-split refactor (Phase C).
 *
 * Lists every client doc with at least one `_pendingNameSplit` field on a
 * fiduciary slot or repeater item. Per row: editable firstName / middleName /
 * lastName / suffix against the original `name`. Approve commits the split
 * into the canonical fields + writes the joined `name` (back-compat); Skip
 * just clears `_pendingNameSplit` so future migration runs don't re-propose.
 *
 * Admin-only. The migration script (functions/scripts/split-names.cjs)
 * writes the proposals; this page commits them after human review.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

interface PendingSplit {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
}

interface Entry {
  label: string;          // e.g. "fiduciaries.executor.primary"
  originalName: string;
  proposed: PendingSplit;
}

interface ClientGroup {
  id: string;
  displayName: string;
  entries: Entry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function joinName(p: PendingSplit): string {
  return [p.firstName, p.middleName, p.lastName, p.suffix]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

interface SlotRef {
  label: string;
  parent: Record<string, unknown> | unknown[];
  key: string | number;
}

/** Enumerates every fiduciary slot + repeater item in a client doc.
 *  Mirrors enumerateSlots() in split-names.cjs. Returns live references so
 *  callers can read/mutate via parent[key]. */
function enumerateSlots(client: Record<string, unknown>): SlotRef[] {
  const out: SlotRef[] = [];
  const push = (label: string, parent: unknown, key: string | number) => {
    if (isObject(parent) || Array.isArray(parent)) {
      const entry = (parent as Record<string | number, unknown>)[key];
      if (isObject(entry)) {
        out.push({ label, parent: parent as Record<string, unknown> | unknown[], key });
      }
    }
  };

  const f = client.fiduciaries as Record<string, unknown> | undefined;
  if (f) {
    const exec = f.executor as Record<string, unknown> | undefined;
    if (exec) {
      push('fiduciaries.executor.primary', exec, 'primary');
      push('fiduciaries.executor.alternate', exec, 'alternate');
      push('fiduciaries.executor.successor', exec, 'successor');
      push('fiduciaries.executor.secondSuccessor', exec, 'secondSuccessor');
    }
    const trustee = f.trustee as Record<string, unknown> | undefined;
    if (trustee) {
      push('fiduciaries.trustee.primary', trustee, 'primary');
      push('fiduciaries.trustee.alternate', trustee, 'alternate');
      push('fiduciaries.trustee.successor', trustee, 'successor');
      push('fiduciaries.trustee.coTrustee', trustee, 'coTrustee');
    }
    const poa = f.powerOfAttorney as Record<string, unknown> | undefined;
    if (poa) {
      push('fiduciaries.powerOfAttorney.agent', poa, 'agent');
      push('fiduciaries.powerOfAttorney.alternateAgent', poa, 'alternateAgent');
      push('fiduciaries.powerOfAttorney.successorAgent', poa, 'successorAgent');
    }
    const hc = f.healthcareProxy as Record<string, unknown> | undefined;
    if (hc) {
      push('fiduciaries.healthcareProxy.agent', hc, 'agent');
      push('fiduciaries.healthcareProxy.alternateAgent', hc, 'alternateAgent');
      push('fiduciaries.healthcareProxy.successorAgent', hc, 'successorAgent');
    }
    const guard = f.guardian as Record<string, unknown> | undefined;
    if (guard) {
      push('fiduciaries.guardian.primary', guard, 'primary');
      push('fiduciaries.guardian.alternate', guard, 'alternate');
    }
  }
  push('guardianPrimary', client, 'guardianPrimary');
  push('guardianAlternate', client, 'guardianAlternate');
  if (Array.isArray(client.children)) {
    client.children.forEach((_, idx) => push(`children[${idx}]`, client.children as unknown[], idx));
  }
  if (Array.isArray(client.grandchildren)) {
    client.grandchildren.forEach((_, idx) => push(`grandchildren[${idx}]`, client.grandchildren as unknown[], idx));
  }
  if (Array.isArray(client.otherDependents)) {
    client.otherDependents.forEach((_, idx) => push(`otherDependents[${idx}]`, client.otherDependents as unknown[], idx));
  }
  return out;
}

function clientDisplayName(client: Record<string, unknown>): string {
  const pi = client.personalInfo as Record<string, unknown> | undefined;
  if (pi) {
    const joined = [pi.firstName, pi.lastName].filter((v) => nonEmptyString(v)).join(' ');
    if (joined) return joined;
  }
  return '<unnamed>';
}

// ── Page component ────────────────────────────────────────────────────────

export default function NameSplitsReview() {
  const { userProfile } = useAuth();
  const { isAdmin } = usePermissions();
  const firmId = userProfile?.firmId;

  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [edits, setEdits] = useState<Record<string, PendingSplit>>({}); // key: `${clientId}::${label}`
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!firmId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const snap = await getDocs(collection(db, `firms/${firmId}/clients`));
      const out: ClientGroup[] = [];
      const initialEdits: Record<string, PendingSplit> = {};
      for (const d of snap.docs) {
        const client = d.data() as Record<string, unknown>;
        const slots = enumerateSlots(client);
        const entries: Entry[] = [];
        for (const { label, parent, key } of slots) {
          const entry = (parent as Record<string | number, unknown>)[key] as Record<string, unknown>;
          const pending = entry._pendingNameSplit;
          if (!isObject(pending)) continue;
          const proposed: PendingSplit = {
            firstName: nonEmptyString(pending.firstName) ? pending.firstName.trim() : '',
            middleName: nonEmptyString(pending.middleName) ? pending.middleName.trim() : '',
            lastName: nonEmptyString(pending.lastName) ? pending.lastName.trim() : '',
            suffix: nonEmptyString(pending.suffix) ? pending.suffix.trim() : '',
          };
          const originalName = nonEmptyString(entry.name) ? entry.name.trim() : '';
          entries.push({ label, originalName, proposed });
          initialEdits[`${d.id}::${label}`] = proposed;
        }
        if (entries.length > 0) {
          out.push({ id: d.id, displayName: clientDisplayName(client), entries });
        }
      }
      if (!cancelled) {
        setGroups(out);
        setEdits(initialEdits);
        setLoading(false);
      }
    })().catch((err) => {
      console.error('[NameSplitsReview] failed to load:', err);
      toast.error(`Failed to load name splits: ${err.message ?? err}`);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [firmId]);

  const updateField = (clientId: string, label: string, field: keyof PendingSplit, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [`${clientId}::${label}`]: {
        ...(prev[`${clientId}::${label}`] ?? { firstName: '', middleName: '', lastName: '', suffix: '' }),
        [field]: value,
      },
    }));
  };

  /** Read-modify-write the client doc, applying the action to the named entries. */
  async function applyToClient(
    clientId: string,
    actions: Array<{ label: string; action: 'approve' | 'skip' }>,
  ) {
    if (!firmId) return;
    const clientRef = doc(db, `firms/${firmId}/clients`, clientId);
    const snap = await getDocs(collection(db, `firms/${firmId}/clients`));
    const target = snap.docs.find((d) => d.id === clientId);
    if (!target) throw new Error(`Client ${clientId} not found`);
    const client = target.data() as Record<string, unknown>;
    const slots = enumerateSlots(client);
    const labelToSlot = new Map(slots.map((s) => [s.label, s]));

    for (const { label, action } of actions) {
      const slotRef = labelToSlot.get(label);
      if (!slotRef) continue;
      const { parent, key } = slotRef;
      const entry = (parent as Record<string | number, unknown>)[key] as Record<string, unknown>;
      if (action === 'approve') {
        const editKey = `${clientId}::${label}`;
        const split = edits[editKey];
        if (!split) continue;
        entry.firstName = split.firstName.trim();
        entry.middleName = split.middleName.trim();
        entry.lastName = split.lastName.trim();
        entry.suffix = split.suffix.trim();
        const joined = joinName(split);
        if (joined) entry.name = joined;
        delete entry._pendingNameSplit;
      } else {
        // Skip — just clear the pending field; canonical name unchanged.
        delete entry._pendingNameSplit;
      }
    }

    const updates: Record<string, unknown> = {};
    if (client.fiduciaries) updates.fiduciaries = client.fiduciaries;
    if (client.children) updates.children = client.children;
    if (client.grandchildren) updates.grandchildren = client.grandchildren;
    if (client.otherDependents) updates.otherDependents = client.otherDependents;
    if (client.guardianPrimary) updates.guardianPrimary = client.guardianPrimary;
    if (client.guardianAlternate) updates.guardianAlternate = client.guardianAlternate;
    await updateDoc(clientRef, updates);

    // Optimistically remove the affected entries from the local UI state.
    setGroups((prev) => prev.flatMap((g) => {
      if (g.id !== clientId) return [g];
      const touched = new Set(actions.map((a) => a.label));
      const remaining = g.entries.filter((e) => !touched.has(e.label));
      if (remaining.length === 0) return [];
      return [{ ...g, entries: remaining }];
    }));
  }

  async function approveRow(clientId: string, label: string) {
    const key = `${clientId}::${label}`;
    setBusy(key);
    try {
      await applyToClient(clientId, [{ label, action: 'approve' }]);
      toast.success(`Approved ${label}`);
    } catch (err) {
      console.error('Approve failed:', err);
      toast.error(`Approve failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function skipRow(clientId: string, label: string) {
    const key = `${clientId}::${label}`;
    setBusy(key);
    try {
      await applyToClient(clientId, [{ label, action: 'skip' }]);
      toast.success(`Skipped ${label}`);
    } catch (err) {
      console.error('Skip failed:', err);
      toast.error(`Skip failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function approveAll(group: ClientGroup) {
    setBusy(`client::${group.id}`);
    try {
      await applyToClient(
        group.id,
        group.entries.map((e) => ({ label: e.label, action: 'approve' as const })),
      );
      toast.success(`Approved all ${group.entries.length} splits for ${group.displayName}`);
    } catch (err) {
      console.error('Bulk approve failed:', err);
      toast.error(`Bulk approve failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const totalPending = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups],
  );

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold text-gray-900">Name Splits Review</h1>
        <p className="mt-2 text-sm text-gray-600">Admin-only. Your role does not have access to this tool.</p>
      </div>
    );
  }

  if (loading) return <LoadingSpinner fullScreen />;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Name Splits Review</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review proposed splits of legacy fiduciary + dependent names into firstName / middleName / lastName / suffix.
          Approve commits the split into canonical fields and writes the joined name for back-compat.
          Skip clears the proposal without changing the canonical name.
        </p>
        <p className="mt-2 text-sm font-medium text-gray-700">
          {totalPending} pending across {groups.length} client{groups.length === 1 ? '' : 's'}.
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-sm text-emerald-900">
            No pending splits. Run <code className="rounded bg-emerald-100 px-1.5 py-0.5">functions/scripts/split-names.cjs --commit</code> to propose splits for any legacy names.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="mb-8 rounded-lg border border-gray-200 bg-white shadow-sm">
            <header className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{g.displayName}</h2>
                <p className="text-xs text-gray-500">client id: <code>{g.id}</code> · {g.entries.length} pending</p>
              </div>
              <button
                className="rounded-md bg-[#1a365d] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2b6cb0] disabled:opacity-50"
                onClick={() => approveAll(g)}
                disabled={busy === `client::${g.id}`}
              >
                Approve All ({g.entries.length})
              </button>
            </header>
            <div className="divide-y divide-gray-100">
              {g.entries.map((e) => {
                const editKey = `${g.id}::${e.label}`;
                const split = edits[editKey] ?? e.proposed;
                const rowBusy = busy === editKey;
                return (
                  <div key={e.label} className="px-4 py-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <code className="text-xs text-gray-500">{e.label}</code>
                        <p className="text-sm text-gray-700">
                          Original: <span className="font-medium">{e.originalName || '<no name>'}</span>
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          onClick={() => skipRow(g.id, e.label)}
                          disabled={rowBusy}
                        >Skip</button>
                        <button
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          onClick={() => approveRow(g.id, e.label)}
                          disabled={rowBusy}
                        >Approve</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      {(['firstName', 'middleName', 'lastName', 'suffix'] as const).map((f) => (
                        <label key={f} className="block">
                          <span className="block text-xs font-medium text-gray-600">{f}</span>
                          <input
                            type="text"
                            value={split[f]}
                            onChange={(ev) => updateField(g.id, e.label, f, ev.target.value)}
                            className="mt-0.5 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1a365d] focus:outline-none focus:ring-1 focus:ring-[#1a365d]/30"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

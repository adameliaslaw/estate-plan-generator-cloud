import { useState } from 'react';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { CalendarClock, Plus, Check, Trash2, X } from 'lucide-react';
import { db } from '@/config/firebase';
import { COLLECTIONS } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import type { ClientDeadline, ClientDeadlineType } from '@/types';

interface Props {
  firmId: string;
  clientId: string;
  deadlines: ClientDeadline[];
}

const TYPE_OPTIONS: Array<{ value: ClientDeadlineType; label: string }> = [
  { value: 'signing_ceremony', label: 'Signing Ceremony' },
  { value: 'filing', label: 'Filing' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'custom', label: 'Task' },
];

const TYPE_LABEL: Record<ClientDeadlineType, string> = {
  signing_ceremony: 'Signing',
  filing: 'Filing',
  follow_up: 'Follow-up',
  custom: 'Task',
};

function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DeadlinesCard({ firmId, clientId, deadlines }: Props) {
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<ClientDeadlineType>('signing_ceremony');
  const [saving, setSaving] = useState(false);

  const clientPath = `${COLLECTIONS.CLIENTS(firmId)}/${clientId}`;

  const sorted = [...deadlines].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.date.localeCompare(b.date);
  });

  const resetForm = () => {
    setLabel('');
    setDate('');
    setType('signing_ceremony');
    setAdding(false);
  };

  const handleAdd = async () => {
    if (!user?.uid || !label.trim() || !date) {
      toast.error('Label and date are required.');
      return;
    }
    setSaving(true);
    try {
      const newDeadline: ClientDeadline = {
        id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: label.trim(),
        date,
        type,
        completed: false,
        createdAt: Timestamp.now(),
        createdBy: user.uid,
      };
      const next = [...deadlines, newDeadline];
      await updateDoc(doc(db, clientPath), { deadlines: next });
      toast.success('Deadline added.');
      resetForm();
    } catch (err) {
      console.error('Failed to add deadline', err);
      toast.error('Failed to add deadline.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async (deadlineId: string) => {
    const next = deadlines.map((d) =>
      d.id === deadlineId ? { ...d, completed: !d.completed } : d,
    );
    try {
      await updateDoc(doc(db, clientPath), { deadlines: next });
    } catch (err) {
      console.error('Failed to update deadline', err);
      toast.error('Failed to update deadline.');
    }
  };

  const handleDelete = async (deadlineId: string) => {
    const next = deadlines.filter((d) => d.id !== deadlineId);
    try {
      await updateDoc(doc(db, clientPath), { deadlines: next });
      toast.success('Deadline removed.');
    } catch (err) {
      console.error('Failed to delete deadline', err);
      toast.error('Failed to delete deadline.');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-50 p-1.5">
            <CalendarClock className="h-4 w-4 text-indigo-600" />
          </div>
          <h3 className="text-base font-semibold text-[#1a365d]">Deadlines</h3>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
            {deadlines.filter((d) => !d.completed).length} open
          </span>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>

      {adding && (
        <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_160px_auto]">
            <Input
              placeholder="e.g. Signing ceremony at office"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9 text-sm"
            />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 text-sm"
            />
            <Select value={type} onValueChange={(v) => setType(v as ClientDeadlineType)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-sm">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleAdd} disabled={saving} className="bg-[#1a365d] hover:bg-[#1e407a]">
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={resetForm}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <CalendarClock className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-400">No deadlines yet</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sorted.map((d) => {
            const diff = daysUntil(d.date);
            const isOverdue = !d.completed && diff < 0;
            const isToday = !d.completed && diff === 0;
            const isThisWeek = !d.completed && diff > 0 && diff <= 7;
            const pillClass = d.completed
              ? 'bg-gray-100 text-gray-500'
              : isOverdue || isToday
              ? 'bg-red-100 text-red-700'
              : isThisWeek
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600';
            const pillLabel = d.completed
              ? 'Done'
              : isOverdue
              ? `${Math.abs(diff)}d overdue`
              : isToday
              ? 'Today'
              : diff === 1
              ? 'Tomorrow'
              : `in ${diff}d`;
            return (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <button
                  onClick={() => handleToggleComplete(d.id)}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                    d.completed
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-gray-300 hover:border-emerald-500',
                  )}
                  aria-label={d.completed ? 'Mark incomplete' : 'Mark complete'}
                >
                  {d.completed && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        d.completed ? 'text-gray-400 line-through' : 'text-[#1a365d]',
                      )}
                    >
                      {d.label}
                    </p>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {TYPE_LABEL[d.type] ?? d.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{formatDate(d.date)}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    pillClass,
                  )}
                >
                  {pillLabel}
                </span>
                <button
                  onClick={() => handleDelete(d.id)}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                  aria-label="Delete deadline"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

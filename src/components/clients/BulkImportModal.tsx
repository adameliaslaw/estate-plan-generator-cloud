/**
 * BulkImportModal.tsx
 *
 * Modal dialog for bulk-importing clients from a CSV file.
 *
 * Flow:
 *   1. User uploads a CSV file or pastes data
 *   2. Preview parsed rows with validation status
 *   3. Confirm → creates Firestore documents one-by-one with progress
 *
 * Expected CSV columns (flexible — mapped by header):
 *   firstName, lastName, email, phone, packageType
 *   All columns are optional except firstName + lastName.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Download,
  UserPlus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { db } from '@/config/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS } from '@/config/constants';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  packageType: string;
  valid: boolean;
  error?: string;
  imported?: boolean;
}

type Phase = 'idle' | 'preview' | 'importing' | 'complete';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firmId: string;
  userId: string;
  onComplete?: () => void;
}

// ── CSV parser ───────────────────────────────────────────────────────────────

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  firstname: 'firstName',
  first_name: 'firstName',
  'first name': 'firstName',
  lastname: 'lastName',
  last_name: 'lastName',
  'last name': 'lastName',
  email: 'email',
  'email address': 'email',
  emailaddress: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  'phone number': 'phone',
  telephone: 'phone',
  package: 'packageType',
  packagetype: 'packageType',
  'package type': 'packageType',
  plan: 'packageType',
};

function parseCSV(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  // Parse header
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const colMap: Map<number, keyof ParsedRow> = new Map();
  headers.forEach((h, i) => {
    const mapped = HEADER_MAP[h];
    if (mapped) colMap.set(i, mapped);
  });

  // Parse data rows
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: ParsedRow = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      packageType: '',
      valid: true,
    };

    colMap.forEach((field, colIdx) => {
      if (field !== 'valid' && field !== 'error' && field !== 'imported') {
        (row as unknown as Record<string, string>)[field] = cells[colIdx] ?? '';
      }
    });

    // Validate
    if (!row.firstName && !row.lastName) {
      row.valid = false;
      row.error = 'First or last name is required';
    }

    // Normalize package type
    if (row.packageType) {
      const pkg = row.packageType.toLowerCase();
      if (['foundation', 'guardian', 'fortress'].includes(pkg)) {
        row.packageType = pkg;
      } else {
        row.packageType = '';
      }
    }

    rows.push(row);
  }
  return rows;
}

// ── Template download ────────────────────────────────────────────────────────

function downloadTemplate() {
  const csv = 'firstName,lastName,email,phone\nJohn,Doe,john@example.com,(555) 123-4567\nJane,Smith,jane@example.com,(555) 987-6543\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'client-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BulkImportModal({
  open,
  onOpenChange,
  firmId,
  userId,
  onComplete,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter((r) => r.valid);

  const reset = useCallback(() => {
    setPhase('idle');
    setRows([]);
    setImportProgress(0);
    setImportedCount(0);
    setErrorCount(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(
    (o: boolean) => {
      if (!o && phase !== 'importing') {
        reset();
        onOpenChange(false);
      }
    },
    [phase, reset, onOpenChange],
  );

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const parsed = parseCSV(reader.result as string);
        setRows(parsed);
        setPhase('preview');
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleImport = useCallback(async () => {
    if (!firmId || validRows.length === 0) return;

    setPhase('importing');
    setImportProgress(0);
    setImportedCount(0);
    setErrorCount(0);

    let success = 0;
    let errors = 0;
    const results = new Map<number, { imported: boolean; error?: string }>();

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const clientsCol = collection(db, COLLECTIONS.CLIENTS(firmId));
        const newRef = doc(clientsCol);
        const clientData: Record<string, unknown> = {
          firmId,
          personalInfo: {
            firstName: row.firstName || '',
            lastName: row.lastName || '',
            email: row.email || '',
            phone: row.phone || '',
          },
          firstName: row.firstName || '',
          lastName: row.lastName || '',
          status: 'active',
          isArchived: false,
          children: [],
          createdBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          questionnaireProgress: {
            status: 'not_started',
            percentComplete: 0,
          },
        };

        if (row.packageType) {
          clientData.packageDetails = {
            packageType: row.packageType,
            documentsIncluded: [],
          };
        }

        await setDoc(newRef, clientData);
        results.set(i, { imported: true });
        success++;
      } catch {
        results.set(i, { imported: false, error: 'Failed to create' });
        errors++;
      }

      setImportProgress(Math.round(((i + 1) / validRows.length) * 100));
      setImportedCount(success);
      setErrorCount(errors);
    }

    setPhase('complete');
    if (success > 0) {
      toast.success(`Successfully imported ${success} client${success !== 1 ? 's' : ''}`);
      onComplete?.();
    }
  }, [firmId, userId, validRows, onComplete]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Upload className="h-5 w-5" />
            {phase === 'complete' ? 'Import Complete' : 'Bulk Client Import'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'idle' && 'Upload a CSV file to import multiple clients at once.'}
            {phase === 'preview' && `${validRows.length} of ${rows.length} rows ready to import.`}
            {phase === 'importing' && 'Importing clients — please wait…'}
            {phase === 'complete' &&
              `${importedCount} imported successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Idle: File upload ── */}
          {phase === 'idle' && (
            <>
              <div
                className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/50 px-6 py-12 cursor-pointer hover:border-[#2b6cb0] hover:bg-[#ebf4ff]/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ebf4ff]">
                  <FileText className="h-7 w-7 text-[#2b6cb0]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">
                    Click to upload or drag a CSV file
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Expected columns: firstName, lastName, email, phone
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-xs"
                onClick={downloadTemplate}
              >
                <Download className="h-3.5 w-3.5" />
                Download CSV Template
              </Button>
            </>
          )}

          {/* ── Preview: Parsed rows ── */}
          {phase === 'preview' && rows.length > 0 && (
            <ScrollArea className="max-h-80">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead>
                  <tr className="bg-gray-50/60">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">First Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Last Name</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Phone</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Package</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row, i) => (
                    <tr key={i} className={cn(!row.valid && 'bg-red-50/50')}>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {row.error}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{row.firstName}</td>
                      <td className="px-3 py-2 text-gray-700">{row.lastName}</td>
                      <td className="px-3 py-2 text-gray-500">{row.email}</td>
                      <td className="px-3 py-2 text-gray-500">{row.phone}</td>
                      <td className="px-3 py-2">
                        {row.packageType ? (
                          <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 capitalize">
                            {row.packageType}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}

          {/* ── Importing: Progress ── */}
          {phase === 'importing' && (
            <div className="space-y-3 py-4">
              <Progress value={importProgress} className="h-2" />
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing clients…
                </span>
                <span>{importProgress}%</span>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-600">{importedCount} imported</span>
                {errorCount > 0 && <span className="text-red-600">{errorCount} failed</span>}
              </div>
            </div>
          )}

          {/* ── Complete: Summary ── */}
          {phase === 'complete' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 mb-3" />
              <p className="text-lg font-semibold text-emerald-800">
                {importedCount} Client{importedCount !== 1 ? 's' : ''} Imported
              </p>
              {errorCount > 0 && (
                <p className="mt-1 text-sm text-red-600">
                  {errorCount} row{errorCount !== 1 ? 's' : ''} failed to import
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {phase === 'idle' && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}
          {phase === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>
                <X className="mr-2 h-4 w-4" />
                Start Over
              </Button>
              <Button
                className="gap-2 bg-[#1a365d] hover:bg-[#1e407a] text-white"
                onClick={handleImport}
                disabled={validRows.length === 0}
              >
                <UserPlus className="h-4 w-4" />
                Import {validRows.length} Client{validRows.length !== 1 ? 's' : ''}
              </Button>
            </>
          )}
          {phase === 'complete' && (
            <Button
              className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

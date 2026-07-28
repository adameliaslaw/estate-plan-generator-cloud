/**
 * DocxTemplateMapCard.tsx
 *
 * Settings card mapping each document type to one of the firm's uploaded
 * .docx templates (Storage: firms/{firmId}/templates/). The mapping powers
 * high-fidelity package generation: mapped docTypes are filled from the
 * firm's real template; unmapped ones fall back to HTML-template generation
 * with a warning on the document.
 *
 * Data: firms/{firmId}/docxTemplateMap/{docType} (doc id = docType).
 * Per-property docTypes (deed, affidavit, GIT/REP-3) are not listed — they
 * generate per property and cannot fill a flat .docx.
 */

import { useEffect, useState } from 'react';
import { doc, deleteDoc, getFirestore, onSnapshot, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, listAll } from 'firebase/storage';
import { FileText, X } from 'lucide-react';
import { storage } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';

// Fillable docTypes (per-property types excluded — see module docblock).
const MAPPABLE_DOC_TYPES = [
  { value: 'will', label: 'Last Will and Testament' },
  { value: 'pourOverWill', label: 'Pour-Over Will' },
  { value: 'poa', label: 'Durable Power of Attorney' },
  { value: 'livingWill', label: 'Advance Directive' },
  { value: 'trust', label: 'Revocable Living Trust' },
  { value: 'estatePlanSummary', label: 'Estate Plan Summary' },
] as const;

// Same soft filename heuristic as the single-doc generator's mismatch warning.
const DOC_TYPE_FILENAME_KEYWORDS: Record<string, string[]> = {
  will: ['will', 'testament'],
  pourOverWill: ['pour', 'will', 'testament'],
  poa: ['poa', 'power', 'attorney'],
  livingWill: ['advance', 'directive', 'healthcare', 'health', 'living'],
  trust: ['trust'],
  estatePlanSummary: ['summary', 'estate plan'],
};

function looksLikeMismatch(docType: string, fileName: string): boolean {
  const keywords = DOC_TYPE_FILENAME_KEYWORDS[docType];
  if (!keywords || !fileName) return false;
  const name = fileName.toLowerCase();
  return !keywords.some((k) => name.includes(k));
}

interface Props {
  firmId: string;
}

export default function DocxTemplateMapCard({ firmId }: Props) {
  const { user } = useAuth();
  const [docxFiles, setDocxFiles] = useState<Array<{ name: string; fullPath: string }>>([]);
  const [mappings, setMappings] = useState<Record<string, { path: string; fileName: string }>>({});
  const [error, setError] = useState('');

  // Live mapping subscription.
  useEffect(() => {
    if (!firmId) return;
    const unsub = onSnapshot(
      collection(getFirestore(), `firms/${firmId}/docxTemplateMap`),
      (snap) => {
        const next: Record<string, { path: string; fileName: string }> = {};
        for (const d of snap.docs) {
          const data = d.data();
          next[d.id] = {
            path: (data.templateStoragePath as string) ?? '',
            fileName: (data.templateFileName as string) ?? '',
          };
        }
        setMappings(next);
      },
      (err) => console.error('[DocxTemplateMapCard] mapping listener error:', err),
    );
    return () => unsub();
  }, [firmId]);

  // Firm .docx files from Storage.
  useEffect(() => {
    if (!firmId) return;
    let cancelled = false;
    (async () => {
      try {
        const listing = await listAll(storageRef(storage, `firms/${firmId}/templates`));
        if (cancelled) return;
        setDocxFiles(
          listing.items
            .filter((item) => item.name.toLowerCase().endsWith('.docx'))
            .map((item) => ({ name: item.name, fullPath: item.fullPath })),
        );
      } catch (err) {
        console.warn('[DocxTemplateMapCard] template listing failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [firmId]);

  const setMapping = async (docType: string, fullPath: string) => {
    setError('');
    const file = docxFiles.find((f) => f.fullPath === fullPath);
    try {
      await setDoc(doc(getFirestore(), `firms/${firmId}/docxTemplateMap/${docType}`), {
        docType,
        templateStoragePath: fullPath,
        templateFileName: file?.name ?? '',
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping.');
    }
  };

  const clearMapping = async (docType: string) => {
    setError('');
    try {
      await deleteDoc(doc(getFirestore(), `firms/${firmId}/docxTemplateMap/${docType}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear mapping.');
    }
  };

  return (
    <Card className="border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#1a365d]">
          <FileText className="h-5 w-5 text-[#2b6cb0]" />
          Firm .docx Templates
        </CardTitle>
        <CardDescription>
          Map each document type to one of your uploaded .docx templates to enable
          High-Fidelity package generation — mapped documents are filled directly in
          your template, preserving its exact formatting. Upload templates via the
          Knowledge Base → Template Library. Unmapped types fall back to standard
          HTML-template generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {docxFiles.length === 0 && (
          <p className="text-sm text-gray-500">
            No .docx templates uploaded yet. Upload templates in the Knowledge Base
            Template Library first, then map them here.
          </p>
        )}
        {MAPPABLE_DOC_TYPES.map((dt) => {
          const mapped = mappings[dt.value];
          const mismatch = mapped && looksLikeMismatch(dt.value, mapped.fileName);
          return (
            <div key={dt.value} className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="w-56 shrink-0 text-sm font-medium text-gray-700">{dt.label}</span>
                <Select
                  value={mapped?.path ?? ''}
                  onValueChange={(v) => setMapping(dt.value, v)}
                  disabled={docxFiles.length === 0}
                >
                  <SelectTrigger className="h-9 flex-1 text-xs">
                    <SelectValue placeholder="Not mapped — HTML template fallback" />
                  </SelectTrigger>
                  <SelectContent>
                    {docxFiles.map((f) => (
                      <SelectItem key={f.fullPath} value={f.fullPath} className="text-xs">
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {mapped && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-gray-400 hover:text-red-600"
                    onClick={() => clearMapping(dt.value)}
                    title="Clear mapping"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {mismatch && (
                <p className="ml-56 pl-3 text-xs text-amber-700">
                  ⚠️ "{mapped.fileName}" doesn't look like a {dt.label} template — double-check the pairing.
                </p>
              )}
            </div>
          );
        })}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * pdf-reports.ts
 *
 * Client-side PDF generation for on-demand report downloads from the dashboard.
 * Uses jsPDF + jspdf-autotable. The same reports are generated server-side in
 * functions/src/pdf-reports.ts for the weekly email digest — keep the output
 * shape consistent between the two.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Client, Document } from '@/types';

const BRAND_COLOR: [number, number, number] = [26, 54, 93]; // #1a365d

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrencyCents(cents: number | undefined | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTs(ts: unknown): string {
  const t = ts as { seconds?: number } | null | undefined;
  if (!t?.seconds) return '—';
  return new Date(t.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function clientDisplayName(c: Client): { last: string; first: string } {
  return {
    last: c.personalInfo?.lastName ?? '',
    first: c.personalInfo?.firstName ?? '',
  };
}

function qStatusLabel(s: string | undefined): string {
  if (s === 'completed') return 'Complete';
  if (s === 'in_progress') return 'In Progress';
  return 'Not Started';
}

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader(
  doc: jsPDF,
  title: string,
  firmName: string,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Brand-colored header bar
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, pageWidth, 22, 'F');

  // Firm name (left)
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(firmName, 14, 14);

  // Report date (right)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  doc.text(dateStr, pageWidth - 14, 14, { align: 'right' });

  // Title below bar
  doc.setTextColor(26, 54, 93);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 32);

  return 38; // y-coordinate where body content should start
}

// ── Client roster ─────────────────────────────────────────────────────────────

export interface RosterPdfInput {
  clients: Client[];
  /** All documents across the firm, used to compute per-client doc counts */
  documents?: Document[];
  firmName: string;
}

export function generateClientRosterPdf(input: RosterPdfInput): Blob {
  const { clients, documents = [], firmName } = input;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

  const startY = drawHeader(doc, 'Client Roster', firmName);

  // Count docs per client
  const docCount = new Map<string, number>();
  for (const d of documents) {
    if (!d.clientId) continue;
    docCount.set(d.clientId, (docCount.get(d.clientId) ?? 0) + 1);
  }

  // Filter + sort active clients
  const activeClients = clients
    .filter((c) => !c.isArchived)
    .sort((a, b) => {
      const an = a.personalInfo?.lastName ?? '';
      const bn = b.personalInfo?.lastName ?? '';
      return an.localeCompare(bn);
    });

  const rows = activeClients.map((c) => {
    const { last, first } = clientDisplayName(c);
    const pkg = c.packageDetails?.packageType ?? '—';
    const fee = formatCurrencyCents(c.packageDetails?.estimatedFee);
    const bal = formatCurrencyCents(c.packageDetails?.balanceDue);
    const qStatus = qStatusLabel(c.questionnaireProgress?.status);
    const docs = docCount.get(c.id) ?? 0;
    const created = formatTs(c.createdAt);
    return [
      last || '—',
      first || '—',
      c.personalInfo?.email ?? '—',
      pkg === 'foundation'
        ? 'Basic'
        : pkg === 'guardian'
          ? 'Rev. Trust'
          : pkg === 'fortress'
            ? 'Irr. Trust'
            : pkg,
      fee,
      bal,
      qStatus,
      docs === 0 ? '—' : String(docs),
      created,
    ];
  });

  autoTable(doc, {
    startY,
    head: [
      [
        'Last',
        'First',
        'Email',
        'Package',
        'Est. Fee',
        'Balance',
        'Q Status',
        'Docs',
        'Created',
      ],
    ],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      2: { cellWidth: 50 }, // email
      4: { halign: 'right' },
      5: { halign: 'right' },
      7: { halign: 'right' },
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}   ·   ${activeClients.length} active clients`,
        14,
        pageHeight - 8,
      );
    },
  });

  return doc.output('blob');
}

// ── Filename helpers ──────────────────────────────────────────────────────────

export function rosterFilename(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `client-roster-${y}${m}${d}.pdf`;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * pdf-reports.ts (functions)
 *
 * Server-side PDF generation for the weekly analytics digest. Produces two
 * PDFs that get attached to the email:
 *   1. Client roster PDF (landscape)
 *   2. Analytics summary PDF (portrait)
 *
 * Keep the roster output shape in sync with src/utils/pdf-reports.ts so the
 * on-demand download and the digest attachment look identical.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const BRAND_COLOR: [number, number, number] = [26, 54, 93]; // #1a365d

// ── Types (minimal shapes — we only read what we use) ────────────────────────

export interface PdfClient {
  id: string;
  isArchived?: boolean;
  personalInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  packageDetails?: {
    packageType?: string;
    estimatedFee?: number;
    balanceDue?: number;
  };
  questionnaireProgress?: {
    status?: string;
    completedAt?: { seconds: number } | null;
  };
  deadlines?: Array<{ date: string; completed?: boolean }>;
  createdAt?: { seconds: number } | null;
}

export interface PdfDocument {
  clientId?: string;
  status?: string;
}

export interface ReportBranding {
  firmName: string;
  primaryColor?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function brandRgb(branding: ReportBranding): [number, number, number] {
  const hex = branding.primaryColor;
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return BRAND_COLOR;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function formatCurrencyCents(cents: number | undefined | null): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTs(ts: { seconds?: number } | null | undefined): string {
  if (!ts?.seconds) return '—';
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function qStatusLabel(s: string | undefined): string {
  if (s === 'completed') return 'Complete';
  if (s === 'in_progress') return 'In Progress';
  return 'Not Started';
}

function pkgLabel(pkg: string | undefined): string {
  if (pkg === 'foundation') return 'Basic';
  if (pkg === 'guardian') return 'Rev. Trust';
  if (pkg === 'fortress') return 'Irr. Trust';
  return pkg ?? '—';
}

function drawHeader(
  doc: jsPDF,
  title: string,
  branding: ReportBranding,
  subtitle?: string,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const rgb = brandRgb(branding);

  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.rect(0, 0, pageWidth, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(branding.firmName, 14, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  doc.text(dateStr, pageWidth - 14, 14, { align: 'right' });

  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 32);

  if (subtitle) {
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(subtitle, 14, 38);
    return 44;
  }
  return 38;
}

// ── Analytics computation (shared between PDF + inline email) ────────────────

export interface DigestStats {
  activeCount: number;
  packages: { foundation: number; guardian: number; fortress: number; unset: number };
  totalRevenue: number;
  totalBalance: number;
  collectRatePct: number;
  qCompleted: number;
  qInProgress: number;
  qNotStarted: number;
  // This-week deltas
  newClientsThisWeek: number;
  questionnairesCompletedThisWeek: number;
  // Action queues
  readyToDraft: number;
  awaitingReview: number;
  overdueDeadlines: number;
}

export function computeDigestStats(
  clients: PdfClient[],
  documents: PdfDocument[],
): DigestStats {
  const active = clients.filter((c) => !c.isArchived);

  const packages = { foundation: 0, guardian: 0, fortress: 0, unset: 0 };
  let totalRevenue = 0;
  let totalBalance = 0;
  let qCompleted = 0;
  let qInProgress = 0;
  let qNotStarted = 0;

  for (const c of active) {
    const pkg = c.packageDetails?.packageType;
    if (pkg === 'foundation') packages.foundation++;
    else if (pkg === 'guardian') packages.guardian++;
    else if (pkg === 'fortress') packages.fortress++;
    else packages.unset++;

    if (c.packageDetails?.estimatedFee) totalRevenue += c.packageDetails.estimatedFee;
    if (c.packageDetails?.balanceDue) totalBalance += c.packageDetails.balanceDue;

    const qs = c.questionnaireProgress?.status;
    if (qs === 'completed') qCompleted++;
    else if (qs === 'in_progress') qInProgress++;
    else qNotStarted++;
  }

  const collectRatePct =
    totalRevenue > 0
      ? Math.round(((totalRevenue - totalBalance) / totalRevenue) * 100)
      : 0;

  // This-week cutoff
  const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 86_400;
  const newClientsThisWeek = active.filter(
    (c) => (c.createdAt?.seconds ?? 0) >= sevenDaysAgoSec,
  ).length;
  const questionnairesCompletedThisWeek = active.filter(
    (c) => (c.questionnaireProgress?.completedAt?.seconds ?? 0) >= sevenDaysAgoSec,
  ).length;

  // Action queues
  const docsByClient = new Map<string, PdfDocument[]>();
  for (const d of documents) {
    if (!d.clientId) continue;
    const arr = docsByClient.get(d.clientId) ?? [];
    arr.push(d);
    docsByClient.set(d.clientId, arr);
  }

  const reviewStatuses = new Set(['draft', 'review', 'needs_review']);
  let readyToDraft = 0;
  let awaitingReview = 0;
  for (const c of active) {
    const docs = docsByClient.get(c.id) ?? [];
    if (c.questionnaireProgress?.status === 'completed' && docs.length === 0) {
      readyToDraft++;
    }
    if (docs.some((d) => reviewStatuses.has(d.status ?? ''))) {
      awaitingReview++;
    }
  }

  // Overdue deadlines: date < today, not completed
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let overdueDeadlines = 0;
  for (const c of active) {
    for (const d of c.deadlines ?? []) {
      if (d.completed) continue;
      const target = new Date(`${d.date}T00:00:00`);
      if (target.getTime() < todayMs) overdueDeadlines++;
    }
  }

  return {
    activeCount: active.length,
    packages,
    totalRevenue,
    totalBalance,
    collectRatePct,
    qCompleted,
    qInProgress,
    qNotStarted,
    newClientsThisWeek,
    questionnairesCompletedThisWeek,
    readyToDraft,
    awaitingReview,
    overdueDeadlines,
  };
}

// ── Client roster PDF ────────────────────────────────────────────────────────

export function buildClientRosterPdf(
  clients: PdfClient[],
  documents: PdfDocument[],
  branding: ReportBranding,
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const rgb = brandRgb(branding);
  const startY = drawHeader(doc, 'Client Roster', branding);

  const docCount = new Map<string, number>();
  for (const d of documents) {
    if (!d.clientId) continue;
    docCount.set(d.clientId, (docCount.get(d.clientId) ?? 0) + 1);
  }

  const activeClients = clients
    .filter((c) => !c.isArchived)
    .sort((a, b) => {
      const an = a.personalInfo?.lastName ?? '';
      const bn = b.personalInfo?.lastName ?? '';
      return an.localeCompare(bn);
    });

  const rows = activeClients.map((c) => [
    c.personalInfo?.lastName || '—',
    c.personalInfo?.firstName || '—',
    c.personalInfo?.email ?? '—',
    pkgLabel(c.packageDetails?.packageType),
    formatCurrencyCents(c.packageDetails?.estimatedFee),
    formatCurrencyCents(c.packageDetails?.balanceDue),
    qStatusLabel(c.questionnaireProgress?.status),
    (docCount.get(c.id) ?? 0) === 0 ? '—' : String(docCount.get(c.id)),
    formatTs(c.createdAt),
  ]);

  autoTable(doc, {
    startY,
    head: [
      ['Last', 'First', 'Email', 'Package', 'Est. Fee', 'Balance', 'Q Status', 'Docs', 'Created'],
    ],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      2: { cellWidth: 50 },
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

  const ab = doc.output('arraybuffer') as ArrayBuffer;
  return Buffer.from(ab);
}

// ── Analytics summary PDF ────────────────────────────────────────────────────

export function buildAnalyticsSummaryPdf(
  stats: DigestStats,
  branding: ReportBranding,
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const rgb = brandRgb(branding);
  const weekLabel = `Week of ${new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;
  let y = drawHeader(doc, 'Weekly Analytics Summary', branding, weekLabel);

  // Section: Revenue
  autoTable(doc, {
    startY: y,
    head: [['Revenue', '']],
    body: [
      ['Total Revenue', formatCurrencyCents(stats.totalRevenue)],
      ['Outstanding Balance', formatCurrencyCents(stats.totalBalance)],
      ['Collection Rate', `${stats.collectRatePct}%`],
    ],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 50 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Section: Clients
  autoTable(doc, {
    startY: y,
    head: [['Clients', '']],
    body: [
      ['Active Clients', String(stats.activeCount)],
      ['New This Week', String(stats.newClientsThisWeek)],
      ['Basic Estate Plans', String(stats.packages.foundation)],
      ['Revocable Trusts', String(stats.packages.guardian)],
      ['Irrevocable Trusts', String(stats.packages.fortress)],
    ],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 50 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Section: Questionnaires
  autoTable(doc, {
    startY: y,
    head: [['Questionnaires', '']],
    body: [
      ['Completed', String(stats.qCompleted)],
      ['In Progress', String(stats.qInProgress)],
      ['Not Started', String(stats.qNotStarted)],
      ['Completed This Week', String(stats.questionnairesCompletedThisWeek)],
    ],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 50 } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Section: Action Queues
  autoTable(doc, {
    startY: y,
    head: [['Action Queues', '']],
    body: [
      ['Ready to Draft', String(stats.readyToDraft)],
      ['Awaiting Review', String(stats.awaitingReview)],
      ['Overdue Deadlines', String(stats.overdueDeadlines)],
    ],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 50 } },
  });

  const ab = doc.output('arraybuffer') as ArrayBuffer;
  return Buffer.from(ab);
}

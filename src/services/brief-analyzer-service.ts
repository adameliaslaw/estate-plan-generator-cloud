/**
 * src/services/brief-analyzer-service.ts
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';
import type { CitationResult } from './citation-verifier-service';
import { fileToBase64 } from '@/utils/file-helpers';

export interface BriefArgument {
  title: string;
  summary: string;
}

export interface BriefAnalysisResult {
  summary: string;
  arguments: BriefArgument[];
  weaknesses: string[];
  talkingPoints: string[];
  citations: CitationResult[];
  fileName: string;
  analyzedAt: string;
}

interface AnalyzeBriefRequest {
  firmId: string;
  fileBase64: string;
  mimeType: 'application/pdf';
  fileName: string;
}

const fn = httpsCallable<AnalyzeBriefRequest, BriefAnalysisResult>(functions, 'analyzeBrief');

export async function analyzeBrief(
  firmId: string,
  file: File,
): Promise<BriefAnalysisResult> {
  const fileBase64 = await fileToBase64(file);
  const result = await fn({
    firmId,
    fileBase64,
    mimeType: 'application/pdf',
    fileName: file.name,
  });
  return result.data;
}


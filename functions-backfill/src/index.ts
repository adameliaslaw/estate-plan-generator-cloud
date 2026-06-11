/**
 * functions-backfill/src/index.ts
 *
 * Lightweight entry point for embedding backfill functions.
 * This codebase is intentionally separate from the main functions codebase
 * to avoid loading heavy dependencies (chromium, puppeteer, openai, etc.)
 * that cause OOM crashes when all functions share a single entry point.
 *
 * Dependencies: firebase-admin + firebase-functions only (~50 MB vs ~200 MB+).
 */

import * as admin from 'firebase-admin';

admin.initializeApp();

export { backfillEmbeddings, backfillTemplateEmbeddings } from './kb-embeddings';
export { backfillClientEmailLowercase } from './client-email-lowercase';

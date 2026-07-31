/**
 * addMyClause — manual "My Clauses" entries for the Clause Picker.
 *
 * The clause catalog is closed to client SDK writes (#222 sign-off), so
 * attorney-authored clauses are created here, firm-scoped and stamped
 * origin: 'manual'. Manual entries never mix into mined-family state:
 * they carry no switchName, counts, or identity fields, so pipeline
 * re-runs and the review queue ignore them.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { assertFirmStaff } from './auth-guards';

const RequestSchema = z
  .object({
    firmId: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(20000),
    category: z.string().min(1).max(100).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/, 'state must be a two-letter code')
      .optional(),
  })
  .strict();

export const addMyClause = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = RequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { firmId, title, text, category, state } = parsed.data;
    const caller = assertFirmStaff(request, firmId);

    const ref = await getFirestore()
      .collection(`firms/${firmId}/clauseCatalog`)
      .add({
        origin: 'manual',
        title,
        canonicalText: text,
        ...(category !== undefined ? { category } : {}),
        ...(state !== undefined ? { state } : {}),
        status: 'approved',
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    return { clauseId: ref.id };
  },
);

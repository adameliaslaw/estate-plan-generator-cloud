import type { ITEXTFormData, Matter, ReviewCheckpoint } from '../types';
import { DISCLAIMER } from './disclaimer';
import { FormPreconditionError } from './errors';

/**
 * Builds the data model for Form IT-EXT (Application for Extension of Time to File a
 * NJ Transfer Inheritance / Estate Tax Return). Statutory basis: N.J.A.C. 18:26-9.1(b).
 *
 * Everything that determines the extended deadline — the extension flags and the reason
 * — is read from the approved computation snapshot (frozen at compute time), not the live
 * Matter, so the filed IT-EXT can never disagree with the attorney-reviewed deadline.
 * Only cover-page identity fields (decedent, representative) come from the live Matter,
 * matching how buildITRFormData() sources its cover page.
 *
 * Throws if the checkpoint is not approved, if it belongs to a different matter, or if
 * the approved computation recorded no filing extension.
 */
export function buildITEXTFormData(
  matter: Matter,
  approvedCheckpoint: ReviewCheckpoint,
): ITEXTFormData {
  if (approvedCheckpoint.status !== 'approved') {
    throw new FormPreconditionError('Cannot generate IT-EXT form data without an approved review checkpoint.');
  }

  if (approvedCheckpoint.matterId !== matter.matterId) {
    throw new Error(
      `Checkpoint matterId '${approvedCheckpoint.matterId}' does not match ` +
      `matter matterId '${matter.matterId}'. ` +
      'Cannot generate IT-EXT form data from a checkpoint belonging to a different matter.',
    );
  }

  const snap = approvedCheckpoint.computationSnapshot;
  const ext = snap.matterInputs.itExtension;
  if (ext === null || !ext.firstExtension) {
    throw new FormPreconditionError(
      'Cannot generate IT-EXT: no filing extension is recorded in the approved computation. ' +
      'Set matter.itExtension.firstExtension and re-run compute/review before generating an IT-EXT.',
    );
  }

  if (snap.extendedFilingDeadline === null) {
    throw new FormPreconditionError(
      'Cannot generate IT-EXT: the approved computation has no extended filing deadline. ' +
      'Re-run compute and review after setting matter.itExtension.',
    );
  }

  const secondExtension = ext.secondExtension === true;

  return {
    decedentLastName: matter.decedent.lastName,
    decedentFirstName: matter.decedent.firstName,
    ...(matter.decedent.middleName !== undefined
      ? { decedentMiddleName: matter.decedent.middleName }
      : {}),
    decedentSSN: matter.decedent.ssn,
    dateOfDeath: matter.decedent.dateOfDeath,
    countyOfResidence: matter.decedent.countyOfResidence,
    isNJResident: matter.decedent.isNJResident ?? true,

    representative: matter.personalRepresentative,

    originalDeadline: snap.filingDeadline,
    extendedFilingDeadline: snap.extendedFilingDeadline,
    // N.J.A.C. 18:26-9.1(b): +4 months (first) or +6 months total (first + second).
    extensionMonths: secondExtension ? 6 : 4,
    firstExtension: true,
    secondExtension,
    ...(ext.reason !== undefined ? { reason: ext.reason } : {}),

    approvedCheckpointId: approvedCheckpoint.checkpointId,
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * createClientFromName
 *
 * Creates a minimal, firm-scoped client record from a single typed name — used
 * by the inline "➕ Create client" affordance in client-name comboboxes when
 * the user types someone not yet on file.
 *
 * Mirrors the proven name-only creation path in DashboardPage's audio-note
 * flow: the Firestore rules require both firstName and lastName to be
 * non-empty, so a single-word name is stored as the first name with a
 * "(New Client)" placeholder last name. No email is required at this layer.
 */

import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { COLLECTIONS } from '@/config/constants';

export interface CreatedClient {
  id: string;
  firstName: string;
  lastName: string;
}

export async function createClientFromName(
  firmId: string,
  createdBy: string,
  typedName: string,
): Promise<CreatedClient> {
  const nameParts = typedName.trim().split(/\s+/);

  let firstName: string;
  let lastName: string;
  if (nameParts.length === 1) {
    firstName = nameParts[0];
    lastName = '(New Client)';
  } else {
    firstName = nameParts[0] || '';
    lastName = nameParts.slice(1).join(' ') || '';
  }

  const ref = doc(collection(db, COLLECTIONS.CLIENTS(firmId)));
  await setDoc(ref, {
    firstName,
    lastName,
    personalInfo: { firstName, lastName },
    firmId,
    status: 'active',
    isArchived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy,
  });

  return { id: ref.id, firstName, lastName };
}

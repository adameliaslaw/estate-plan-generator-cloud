/**
 * functions/src/wills-drive-client.ts
 *
 * Google Drive file fetcher for the Wills ingestion pipeline.
 * Uses Application Default Credentials (the Cloud Function's service account),
 * which must be granted Viewer access to the Drive folder by Adam.
 */

import { google } from 'googleapis';

export interface DriveFileResult {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  createdTime: string;   // ISO 8601
  modifiedTime: string;  // ISO 8601
}

let _driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (!_driveClient) {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    _driveClient = google.drive({ version: 'v3', auth });
  }
  return _driveClient;
}

export async function fetchDriveFile(fileId: string): Promise<DriveFileResult> {
  const drive = getDriveClient();

  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,createdTime,modifiedTime',
  });

  const content = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  return {
    bytes: Buffer.from(content.data as ArrayBuffer),
    mimeType: meta.data.mimeType ?? 'application/octet-stream',
    fileName: meta.data.name ?? fileId,
    fileSizeBytes: parseInt(meta.data.size ?? '0', 10),
    createdTime: meta.data.createdTime ?? new Date().toISOString(),
    modifiedTime: meta.data.modifiedTime ?? new Date().toISOString(),
  };
}

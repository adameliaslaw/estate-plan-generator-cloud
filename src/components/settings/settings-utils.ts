/** Mask an API key showing only the last 4 characters. */
export function maskApiKey(key: string | undefined): string {
  if (!key || key.length < 4) return '';
  return `••••••••${key.slice(-4)} `;
}

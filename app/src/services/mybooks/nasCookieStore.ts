/**
 * Per-host cookie jar for NAS remote-access sessions.
 *
 * Cookies captured from the embedded NAS login webview live in a different
 * cookie store than `@tauri-apps/plugin-http`'s internal jar (the webview
 * uses the system browser engine; plugin-http uses its own reqwest-based
 * client) — see `nasWebviewBridge.ts`. We persist them here, keyed by host,
 * so `fetchMyBooks` can attach them as an explicit `Cookie` header.
 */

const STORAGE_KEY = 'mybooks_nas_cookies';

interface NasCookieRecord {
  cookieHeader: string;
  capturedAt: number;
}

const normalizeHostKey = (host: string): string => host.trim().toLowerCase();

const readAll = (): Record<string, NasCookieRecord> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NasCookieRecord>) : {};
  } catch {
    return {};
  }
};

const writeAll = (records: Record<string, NasCookieRecord>): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};

export function setNasCookies(host: string, cookieHeader: string): void {
  const records = readAll();
  records[normalizeHostKey(host)] = { cookieHeader, capturedAt: Date.now() };
  writeAll(records);
}

export function getNasCookies(host: string): string | null {
  const records = readAll();
  return records[normalizeHostKey(host)]?.cookieHeader ?? null;
}

export function clearNasCookies(host: string): void {
  const records = readAll();
  delete records[normalizeHostKey(host)];
  writeAll(records);
}

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { getStoredMyBooksAccessCode } from '@/utils/credentialStorage';
import { mergeTauriMyBooksCookie, extractCookieHeaderFromResponse } from './tauriCookieStore';
import { SILENT_ACCESS_CODE_REFRESH_ENABLED } from './constants';

interface AccessResponse {
  err: string;
}

/**
 * Silently re-validates a remembered access code against `/api/access` so
 * `mybooks_tauri_cookie` picks up a fresh `invited` cookie, for the case
 * `AccessCodeDialog` never runs at all: a user who was already invited at
 * login time never hits `not_invited`, so the dialog never fires and
 * `mybooks_tauri_cookie` — which only gets `invited` merged in from that
 * dialog's own success response, `LoginDialog`'s sign-in capture, or an
 * incidental Set-Cookie on some other successful call — can end up missing
 * it forever. Ordinary API calls (`/user/info`, `/categories`, …) never
 * resend `invited`, so nothing else opportunistically refreshes it either.
 * Only works if the user previously checked "remember access code"; there is
 * no way to read plugin-http's own (already-authenticated) internal cookie
 * jar to recover the value otherwise. No-op, and errors are swallowed, on
 * anything short of a clean success — this call must never disrupt the
 * caller's own flow.
 */
export async function refreshTauriAccessCodeCookie(host: string): Promise<void> {
  if (!SILENT_ACCESS_CODE_REFRESH_ENABLED) return;
  if (!isTauriAppPlatform()) return;
  const code = getStoredMyBooksAccessCode();
  if (!code) return;

  try {
    const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
    const response = await tauriFetch(`${normalizedHost}/api/access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ invite_code: code }),
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
    const result = (await response.json()) as AccessResponse;
    if (result.err !== 'ok') return;
    const cookie = extractCookieHeaderFromResponse(response);
    if (cookie) mergeTauriMyBooksCookie(cookie);
  } catch {
    // Best-effort refresh — the user is already logged in either way.
  }
}

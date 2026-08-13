import { hasEmbedReturnUrl } from '@/utils/embedReturn';

/**
 * Fire-and-forget relay of a client-side error to the server log (see
 * src/app/api/mybooks/client-log/route.ts), so it shows up in `docker logs`
 * next to the rest of MyReader's server output — browser console errors
 * never reach it on their own. Gated on `hasEmbedReturnUrl`, so this only
 * ever fires for books opened via pages/readerx/open.tsx; every other app
 * form (Tauri, standalone web) is unaffected.
 */
export const reportEmbedError = (bookHash: string, message: string): void => {
  if (typeof window === 'undefined' || !hasEmbedReturnUrl(bookHash)) return;
  fetch('/api/mybooks/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookHash, message }),
    keepalive: true,
  }).catch(() => {});
};

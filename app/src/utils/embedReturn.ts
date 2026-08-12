import { BOOK_IDS_SEPARATOR } from '@/services/constants';

const EMBED_RETURN_KEY_PREFIX = 'reader-embed:returnUrl:';

/**
 * Stashes the "return to MyBooks" URL for a book opened via
 * pages/readerx/open.tsx, so the reader's "go to library" action can
 * redirect there instead once the reader page (no query params of its own)
 * takes over.
 */
export const setEmbedReturnUrl = (bookHash: string, returnUrl: string): void => {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(`${EMBED_RETURN_KEY_PREFIX}${bookHash}`, returnUrl);
};

/** Reads and clears the stashed return URL, if any, for a single use. */
export const consumeEmbedReturnUrl = (bookHash: string): string | null => {
  if (typeof window === 'undefined') return null;
  const key = `${EMBED_RETURN_KEY_PREFIX}${bookHash}`;
  const value = sessionStorage.getItem(key);
  if (value !== null) sessionStorage.removeItem(key);
  return value;
};

/**
 * Non-consuming check for whether `bookHash` was opened via the embedded
 * reader flow. Used to gate embedded-only side effects (e.g. relaying a
 * client-side error to the server log — see embedClientLog.ts) without
 * spending the one-time return URL that closeReaderWindowOrGoToLibrary still
 * needs afterwards.
 */
export const hasEmbedReturnUrl = (bookHash: string): boolean => {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(`${EMBED_RETURN_KEY_PREFIX}${bookHash}`) !== null;
};

/**
 * Looks up the stashed "return to MyBooks" URL for whichever book the
 * `/reader` route in `pathname`/`search` is for, matching both URL shapes
 * `navigateToReader` can produce (`/reader/:ids` and `/reader?ids=`, see
 * nav.ts). Used by the global error boundary (src/app/error.tsx): if the
 * reader crashes while opening an embedded book (e.g. "Book not found"), its
 * "go home" action must land back in MyBooks, not MyReader's own `/library`
 * — in the merged single-origin deployment `/library` isn't routed to
 * MyReader at all (see document/MyReader_Embedded_WebApp.md §12.3), so that
 * request falls through to MyBooks and mid-navigates the browser away.
 */
export const resolveEmbedReturnUrlFromLocation = (
  pathname: string,
  search: string,
): string | null => {
  const pathMatch = pathname.match(/^\/reader\/([^/?]+)/);
  const idsParam = pathMatch?.[1]
    ? decodeURIComponent(pathMatch[1])
    : new URLSearchParams(search).get('ids');
  if (!idsParam) return null;
  const bookHash = idsParam.split(BOOK_IDS_SEPARATOR)[0];
  return bookHash ? consumeEmbedReturnUrl(bookHash) : null;
};

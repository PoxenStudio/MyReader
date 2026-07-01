const EMBED_RETURN_KEY_PREFIX = 'reader-embed:returnUrl:';

/**
 * Stashes the "return to MyBooks" URL for a book opened via
 * pages/reader-embed/open.tsx, so the reader's "go to library" action can
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

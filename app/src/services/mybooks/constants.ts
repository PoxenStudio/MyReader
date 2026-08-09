/**
 * Flag of sync feature
 */
export const ENABLE_SYNC_FEATURE = true;

export const ENABLE_UPLOAD_ALL_IN_TRANSFER_QUEUE = false;

/**
 * Kill switch for `refreshTauriAccessCodeCookie`'s silent `/api/access`
 * re-validation. Disabled for now: it was found to silently re-populate the
 * `invited` cookie right after login using a remembered access code, even
 * when the user just logged out specifically to clear it — undermining
 * logout's cookie-clearing intent. Flip to `true` once that interaction is
 * resolved (e.g. logout also clears the remembered access code).
 */
export const SILENT_ACCESS_CODE_REFRESH_ENABLED = false;

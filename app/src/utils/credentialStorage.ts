/**
 * Lightweight obfuscation for credentials we persist to localStorage (e.g.
 * the "remember me" MyReader password). This is NOT cryptographic security —
 * anything running same-origin JS can still call `decodeCredential` — but it
 * keeps the raw password from appearing in plaintext in localStorage,
 * browser devtools exports, backups, etc.
 */

const OBFUSCATION_KEY = 'readest-credential-v1';

const xorWithKey = (input: string, key: string): string => {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
};

export const encodeCredential = (value: string): string => {
  const bytes = unescape(encodeURIComponent(value));
  return btoa(xorWithKey(bytes, OBFUSCATION_KEY));
};

export const decodeCredential = (encoded: string): string | null => {
  try {
    const bytes = xorWithKey(atob(encoded), OBFUSCATION_KEY);
    return decodeURIComponent(escape(bytes));
  } catch {
    return null;
  }
};

export const MYBOOKS_PASSWORD_KEY = 'mybooks_password';
const MYBOOKS_SESSION_PASSWORD_KEY = 'mybooks_session_password';

/** Persist the MyReader "remember me" password in obfuscated form. */
export const setStoredMyBooksPassword = (password: string): void => {
  localStorage.setItem(MYBOOKS_PASSWORD_KEY, encodeCredential(password));
};

/** Read back the MyReader "remember me" password, or `null` if absent/unreadable. */
export const getStoredMyBooksPassword = (): string | null => {
  const encoded = localStorage.getItem(MYBOOKS_PASSWORD_KEY);
  if (!encoded) return null;
  return decodeCredential(encoded);
};

/** Persist the MyReader password for the current session only (cleared when app closes). */
export const setSessionMyBooksPassword = (password: string): void => {
  sessionStorage.setItem(MYBOOKS_SESSION_PASSWORD_KEY, encodeCredential(password));
};

/** Read back the MyReader session password, or `null` if absent/unreadable. */
export const getSessionMyBooksPassword = (): string | null => {
  const encoded = sessionStorage.getItem(MYBOOKS_SESSION_PASSWORD_KEY);
  if (!encoded) return null;
  return decodeCredential(encoded);
};

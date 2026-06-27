import { WebDAVConnectionType, WebDAVSettings } from '@/types/settings';
import { getStoredMyBooksPassword, getSessionMyBooksPassword } from '@/utils/credentialStorage';

export interface WebDAVConnectFormValues {
  type: WebDAVConnectionType;
  serverUrl: string;
  username: string;
  password: string;
  /** Already passed through `normalizeRootPath` by the caller. */
  rootPath: string;
}

/** Fixed remote root used for the "MyReader" storage option. */
export const MYBOOKS_WEBDAV_ROOT_PATH = '/books/reader/';

const MYBOOKS_HOST_KEY = 'mybooks_host';
const MYBOOKS_USERNAME_KEY = 'mybooks_username';

export interface MyBooksWebDAVCredentials {
  serverUrl: string;
  username: string;
  password: string;
  rootPath: string;
}

/**
 * Read the currently signed-in MyReader account's server/username/password
 * from localStorage (the same keys the MyReader login page writes — see
 * `src/app/auth/page.tsx`). Returns `null` if the user isn't signed in to
 * MyReader or didn't opt into "remember me" (no password persisted).
 */
export const getMyBooksWebDAVCredentials = (): MyBooksWebDAVCredentials | null => {
  if (typeof window === 'undefined') return null;
  const serverUrl = localStorage.getItem(MYBOOKS_HOST_KEY);
  const username = localStorage.getItem(MYBOOKS_USERNAME_KEY);
  const password = getStoredMyBooksPassword() ?? getSessionMyBooksPassword();
  if (!serverUrl || !username || !password) return null;
  return { serverUrl, username, password, rootPath: MYBOOKS_WEBDAV_ROOT_PATH };
};

/**
 * Resolve the credentials/root path a WebDAV connection should actually use.
 *
 * For `type: 'mybooks'` the persisted settings deliberately don't carry
 * `serverUrl`/`username`/`password`/`rootPath` — they're filled in here from
 * the live MyReader login. For `type: 'custom'` (or unset, for settings
 * written before this field existed), the persisted values are returned
 * unchanged.
 */
export const resolveWebDAVSettings = (settings: WebDAVSettings): WebDAVSettings => {
  if (settings.type !== 'mybooks') return settings;
  const creds = getMyBooksWebDAVCredentials();
  if (!creds) return settings;
  return { ...settings, ...creds };
};

/**
 * Build the updated `webdav` block for a successful Connect submit.
 *
 * The form's Connect handler only owns the credential/path fields the user
 * just submitted. Everything else — `deviceId`, `syncBooks`, `strategy`,
 * `syncProgress`, `syncNotes`, `lastSyncedAt`, `syncLog` — was earned by
 * prior use and MUST be preserved across a disconnect/reconnect cycle.
 *
 * Spreading `previous` first lets the form fields shadow the captured
 * credentials while every bookkeeping field rides through untouched. The
 * `enabled: true` flag is set last so a previously-disabled connection
 * comes back online without otherwise mutating user preferences.
 *
 * Pulled out as a pure helper specifically to unit-test the "reconnect
 * preserves prior state" invariant: the inline version in WebDAVForm
 * regressed in PR #4204 by replacing the whole webdav block, which
 * silently rotated the deviceId and dropped the diagnostic syncLog.
 *
 * For `type: 'mybooks'`, credentials/root path are intentionally NOT
 * persisted — they're resolved at use-time via {@link resolveWebDAVSettings}
 * from whatever MyReader account happens to be signed in.
 */
export const buildWebDAVConnectSettings = (
  previous: Partial<WebDAVSettings> | undefined,
  form: WebDAVConnectFormValues,
): WebDAVSettings => {
  if (form.type === 'mybooks') {
    return {
      ...(previous ?? {}),
      enabled: true,
      type: 'mybooks',
      serverUrl: '',
      username: '',
      password: '',
      rootPath: '',
    } as WebDAVSettings;
  }
  return {
    ...(previous ?? {}),
    enabled: true,
    type: 'custom',
    serverUrl: form.serverUrl.trim(),
    username: form.username,
    password: form.password,
    rootPath: form.rootPath,
  } as WebDAVSettings;
};

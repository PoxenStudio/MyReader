import { describe, test, expect, afterEach } from 'vitest';
import {
  buildWebDAVConnectSettings,
  getMyBooksWebDAVCredentials,
  resolveWebDAVSettings,
  MYBOOKS_WEBDAV_ROOT_PATH,
} from '@/services/webdav/webdavConnectSettings';
import { setStoredMyBooksPassword } from '@/utils/credentialStorage';
import type { WebDAVSettings, WebDAVSyncLogEntry } from '@/types/settings';

describe('buildWebDAVConnectSettings', () => {
  test('applies form fields onto a blank previous state', () => {
    const result = buildWebDAVConnectSettings(undefined, {
      type: 'custom',
      serverUrl: '  https://dav.example.com  ',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/MyReader',
    });
    expect(result).toEqual({
      enabled: true,
      type: 'custom',
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/MyReader',
    });
  });

  test('preserves prior bookkeeping fields across reconnect', () => {
    // Simulates the disconnect → reconnect flow: the user previously
    // synced (deviceId minted, syncBooks toggled on, history populated),
    // disabled WebDAV, and is now reconnecting with the same credentials.
    const log: WebDAVSyncLogEntry[] = [
      {
        id: 'log-1',
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_001_500,
        status: 'success',
        trigger: 'manual',
        totalBooks: 3,
        booksDownloaded: 0,
        filesUploaded: 1,
        filesAlreadyInSync: 2,
        configsUploaded: 3,
        configsDownloaded: 0,
        coversUploaded: 0,
        failures: 0,
        summary: 'Sync complete',
      },
    ];
    const previous: WebDAVSettings = {
      enabled: false,
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/MyReader',
      syncProgress: true,
      syncNotes: true,
      syncBooks: true,
      strategy: 'send',
      deviceId: 'device-uuid-9f3c',
      lastSyncedAt: 1_700_000_001_500,
      syncLog: log,
    };

    const next = buildWebDAVConnectSettings(previous, {
      type: 'custom',
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/MyReader',
    });

    expect(next.enabled).toBe(true);
    // Stable per-device id MUST survive — losing it makes the next sync
    // look like a brand-new device and breaks cross-device clobber
    // detection in `RemoteBookConfig.writerDeviceId`.
    expect(next.deviceId).toBe('device-uuid-9f3c');
    expect(next.syncBooks).toBe(true);
    expect(next.strategy).toBe('send');
    expect(next.syncProgress).toBe(true);
    expect(next.syncNotes).toBe(true);
    expect(next.lastSyncedAt).toBe(1_700_000_001_500);
    expect(next.syncLog).toEqual(log);
  });

  test('updates the credentials when the user reconnects to a different account', () => {
    const previous: WebDAVSettings = {
      enabled: false,
      serverUrl: 'https://old.example.com',
      username: 'alice',
      password: 'old-pw',
      rootPath: '/Old',
      deviceId: 'device-keep',
      syncBooks: false,
    };
    const next = buildWebDAVConnectSettings(previous, {
      type: 'custom',
      serverUrl: 'https://new.example.com/',
      username: 'bob',
      password: 'new-pw',
      rootPath: '/New',
    });
    expect(next.serverUrl).toBe('https://new.example.com/');
    expect(next.username).toBe('bob');
    expect(next.password).toBe('new-pw');
    expect(next.rootPath).toBe('/New');
    // The deviceId is intentionally NOT rotated even when the user
    // reconnects to a different server/account: it identifies the
    // physical device, not the remote account. A user moving between
    // self-hosted instances still wants their device to be recognised
    // by whichever server it's currently talking to.
    expect(next.deviceId).toBe('device-keep');
    expect(next.syncBooks).toBe(false);
  });

  test('does not persist credentials for the mybooks type', () => {
    const previous: WebDAVSettings = {
      enabled: false,
      type: 'custom',
      serverUrl: 'https://old.example.com',
      username: 'alice',
      password: 'old-pw',
      rootPath: '/Old',
      deviceId: 'device-keep',
      syncBooks: true,
    };
    const next = buildWebDAVConnectSettings(previous, {
      type: 'mybooks',
      serverUrl: 'ignored',
      username: 'ignored',
      password: 'ignored',
      rootPath: 'ignored',
    });
    expect(next.type).toBe('mybooks');
    expect(next.enabled).toBe(true);
    expect(next.serverUrl).toBe('');
    expect(next.username).toBe('');
    expect(next.password).toBe('');
    expect(next.rootPath).toBe('');
    // Bookkeeping fields still carry through.
    expect(next.deviceId).toBe('device-keep');
    expect(next.syncBooks).toBe(true);
  });
});

describe('getMyBooksWebDAVCredentials', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('returns null when not signed in to MyReader', () => {
    expect(getMyBooksWebDAVCredentials()).toBeNull();
  });

  test('returns null when password was not remembered', () => {
    localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    localStorage.setItem('mybooks_username', 'alice');
    expect(getMyBooksWebDAVCredentials()).toBeNull();
  });

  test('returns server/username/password with the fixed root path', () => {
    localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    localStorage.setItem('mybooks_username', 'alice');
    setStoredMyBooksPassword('hunter2');
    expect(getMyBooksWebDAVCredentials()).toEqual({
      serverUrl: 'https://mybooks.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: MYBOOKS_WEBDAV_ROOT_PATH,
    });
  });
});

describe('resolveWebDAVSettings', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('returns custom settings unchanged', () => {
    const settings: WebDAVSettings = {
      enabled: true,
      type: 'custom',
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/MyReader',
    };
    expect(resolveWebDAVSettings(settings)).toEqual(settings);
  });

  test('fills in mybooks credentials from the current login', () => {
    localStorage.setItem('mybooks_host', 'https://mybooks.example.com');
    localStorage.setItem('mybooks_username', 'alice');
    setStoredMyBooksPassword('hunter2');
    const settings: WebDAVSettings = {
      enabled: true,
      type: 'mybooks',
      serverUrl: '',
      username: '',
      password: '',
      rootPath: '',
      syncBooks: true,
    };
    expect(resolveWebDAVSettings(settings)).toEqual({
      ...settings,
      serverUrl: 'https://mybooks.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: MYBOOKS_WEBDAV_ROOT_PATH,
    });
  });

  test('returns mybooks settings unchanged when not signed in', () => {
    const settings: WebDAVSettings = {
      enabled: true,
      type: 'mybooks',
      serverUrl: '',
      username: '',
      password: '',
      rootPath: '',
    };
    expect(resolveWebDAVSettings(settings)).toEqual(settings);
  });
});

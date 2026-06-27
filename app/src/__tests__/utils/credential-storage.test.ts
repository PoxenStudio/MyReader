import { describe, test, expect, afterEach } from 'vitest';
import {
  encodeCredential,
  decodeCredential,
  setStoredMyBooksPassword,
  getStoredMyBooksPassword,
  MYBOOKS_PASSWORD_KEY,
} from '@/utils/credentialStorage';

describe('encodeCredential / decodeCredential', () => {
  test('round-trips ASCII passwords', () => {
    const encoded = encodeCredential('hunter2');
    expect(encoded).not.toBe('hunter2');
    expect(decodeCredential(encoded)).toBe('hunter2');
  });

  test('round-trips unicode passwords', () => {
    const password = '密码🔒pässwörd';
    const encoded = encodeCredential(password);
    expect(encoded).not.toBe(password);
    expect(decodeCredential(encoded)).toBe(password);
  });

  test('returns null for unreadable/garbage input', () => {
    expect(decodeCredential('not-base64!!')).toBeNull();
  });
});

describe('setStoredMyBooksPassword / getStoredMyBooksPassword', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('stores the password obfuscated, not in plaintext', () => {
    setStoredMyBooksPassword('hunter2');
    expect(localStorage.getItem(MYBOOKS_PASSWORD_KEY)).not.toBe('hunter2');
    expect(getStoredMyBooksPassword()).toBe('hunter2');
  });

  test('returns null when nothing is stored', () => {
    expect(getStoredMyBooksPassword()).toBeNull();
  });
});

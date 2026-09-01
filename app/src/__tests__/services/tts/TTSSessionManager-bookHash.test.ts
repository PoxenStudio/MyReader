import { describe, expect, it } from 'vitest';
import { getBookHashFromKey } from '@/services/tts/TTSSessionManager';
import { getBookHash } from '@/utils/book';

describe('getBookHashFromKey', () => {
  it('recovers a hash that itself contains a dash', () => {
    // bookKey format is `${hash}-${uniqueId()}`, uniqueId is 7 base-36 chars.
    const hash = 'abc-def123';
    const bookKey = `${hash}-${'a1b2c3d'}`;
    expect(getBookHashFromKey(bookKey)).toBe(hash);
  });

  it('agrees with the canonical getBookHash helper', () => {
    const hash = 'abc-def123';
    const bookKey = `${hash}-${'a1b2c3d'}`;
    expect(getBookHashFromKey(bookKey)).toBe(getBookHash(bookKey));
  });
});

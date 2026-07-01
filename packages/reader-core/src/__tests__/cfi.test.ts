import { describe, expect, it } from 'vitest';
import { isCfiInLocation } from '../cfi';

describe('isCfiInLocation', () => {
  it('matches a CFI against its own range', () => {
    const cfi = 'epubcfi(/6/4!/4/2/1:0)';
    expect(isCfiInLocation(cfi, cfi)).toBe(true);
  });

  it('returns false for missing input', () => {
    expect(isCfiInLocation('', 'epubcfi(/6/4!/4/2/1:0)')).toBe(false);
    expect(isCfiInLocation('epubcfi(/6/4!/4/2/1:0)', null)).toBe(false);
  });
});

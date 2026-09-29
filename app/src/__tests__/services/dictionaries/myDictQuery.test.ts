import { describe, it, expect } from 'vitest';
import { pickVocabEntry, type MyDictResult } from '@/services/dictionaries/providers/myDictQuery';

const hit = (word: string, dictionary_id: number): MyDictResult => ({
  dictionary_id,
  dictionary_name: 'D',
  word,
  definition: '<p>x</p>',
});

describe('pickVocabEntry', () => {
  it('prefers the exact headword match over a prefix hit', () => {
    // MyDict 查询是前缀匹配：查 ran 会带回 ranch/rancid，选词头才是词库里的条目
    const results = [hit('ranch', 4), hit('ran', 7), hit('rancid', 4)];
    expect(pickVocabEntry(results, 'ran')?.word).toBe('ran');
    expect(pickVocabEntry(results, 'ran')?.dictionary_id).toBe(7);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(pickVocabEntry([hit('Hello', 1)], '  hello ')?.word).toBe('Hello');
  });

  it('falls back to the first hit when no headword matches', () => {
    expect(pickVocabEntry([hit('ranch', 4), hit('rancid', 4)], 'ran')?.word).toBe('ranch');
  });

  it('returns undefined for no results', () => {
    expect(pickVocabEntry([], 'ran')).toBeUndefined();
  });
});

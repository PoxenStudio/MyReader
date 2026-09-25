import { describe, it, expect } from 'vitest';
import { audioCandidates } from '@/services/dictionaries/dictAudio';

describe('audioCandidates', () => {
  it('falls back .spx → same-name .mp3 → .opus → the original .spx', () => {
    expect(audioCandidates('/dict-res/28/res/SPX/J39806.spx')).toEqual([
      '/dict-res/28/res/SPX/J39806.mp3',
      '/dict-res/28/res/SPX/J39806.opus',
      '/dict-res/28/res/SPX/J39806.spx',
    ]);
  });

  it('keeps natively playable formats as-is', () => {
    expect(audioCandidates('/dict-res/9/res/song32/a.mp3')).toEqual(['/dict-res/9/res/song32/a.mp3']);
    expect(audioCandidates('/dict-res/9/res/song48/a.opus')).toEqual(['/dict-res/9/res/song48/a.opus']);
  });
});

import { describe, expect, test } from 'vitest';
import { parseSubtitle, findActiveCueIndex } from '@/services/audiobook/audioSubtitle';

describe('parseSubtitle', () => {
  test('parses standard SRT with HH:MM:SS,mmm timestamps', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,500',
      'Hello there',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,250',
      'Second line',
      '',
    ].join('\n');

    const cues = parseSubtitle(srt);
    expect(cues).toEqual([
      { start: 1, end: 4.5, text: 'Hello there' },
      { start: 5, end: 7.25, text: 'Second line' },
    ]);
  });

  test('parses cross-hour timestamps (>=1 hour)', () => {
    const srt = ['1', '01:02:03,500 --> 01:02:10,000', 'Later chapter', ''].join('\n');
    const cues = parseSubtitle(srt);
    expect(cues).toEqual([{ start: 3723.5, end: 3730, text: 'Later chapter' }]);
  });

  test('parses WebVTT-style timestamps that omit the hour (MM:SS.mmm)', () => {
    const vtt = ['1', '00:01.000 --> 00:04.500', 'VTT style cue', ''].join('\n');
    const cues = parseSubtitle(vtt);
    expect(cues).toEqual([{ start: 1, end: 4.5, text: 'VTT style cue' }]);
  });

  test('sorts out-of-order blocks by start time', () => {
    const srt = [
      '2',
      '00:00:05,000 --> 00:00:06,000',
      'Second',
      '',
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'First',
      '',
    ].join('\n');
    const cues = parseSubtitle(srt);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  test('skips malformed blocks (no timestamp line, empty text, or end <= start)', () => {
    const srt = [
      'not a real block',
      'still not a timestamp',
      '',
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '',
      '',
      '2',
      '00:00:05,000 --> 00:00:03,000',
      'end before start',
      '',
      '3',
      '00:00:10,000 --> 00:00:12,000',
      'valid cue',
      '',
    ].join('\n');
    const cues = parseSubtitle(srt);
    expect(cues).toEqual([{ start: 10, end: 12, text: 'valid cue' }]);
  });

  test('returns an empty array for empty input', () => {
    expect(parseSubtitle('')).toEqual([]);
  });
});

describe('findActiveCueIndex', () => {
  const cues = [
    { start: 0, end: 2, text: 'a' },
    { start: 2, end: 5, text: 'b' },
    { start: 8, end: 10, text: 'c' },
  ];

  test('finds the cue containing the given time', () => {
    expect(findActiveCueIndex(cues, 0)).toBe(0);
    expect(findActiveCueIndex(cues, 1.9)).toBe(0);
    expect(findActiveCueIndex(cues, 2)).toBe(1);
    expect(findActiveCueIndex(cues, 4.999)).toBe(1);
    expect(findActiveCueIndex(cues, 9)).toBe(2);
  });

  test('returns -1 for times in a gap between cues or out of range', () => {
    expect(findActiveCueIndex(cues, 6)).toBe(-1);
    expect(findActiveCueIndex(cues, -1)).toBe(-1);
    expect(findActiveCueIndex(cues, 100)).toBe(-1);
  });

  test('returns -1 for an empty cue list', () => {
    expect(findActiveCueIndex([], 5)).toBe(-1);
  });
});

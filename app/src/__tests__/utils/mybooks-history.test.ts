import { describe, test, expect, beforeEach } from 'vitest';
import {
  getMyBooksHostHistory,
  addMyBooksHostToHistory,
  getMyBooksUsernameHistory,
  addMyBooksUsernameToHistory,
} from '@/utils/mybooksHistory';

describe('MyBooks host/username history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns an empty list when nothing has been saved', () => {
    expect(getMyBooksHostHistory()).toEqual([]);
    expect(getMyBooksUsernameHistory()).toEqual([]);
  });

  test('adds an entry and reads it back, most recent first', () => {
    addMyBooksHostToHistory('https://a.example.com');
    addMyBooksHostToHistory('https://b.example.com');

    expect(getMyBooksHostHistory()).toEqual(['https://b.example.com', 'https://a.example.com']);
  });

  test('moves a re-added entry to the front instead of duplicating it', () => {
    addMyBooksHostToHistory('https://a.example.com');
    addMyBooksHostToHistory('https://b.example.com');
    addMyBooksHostToHistory('https://a.example.com');

    expect(getMyBooksHostHistory()).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  test('caps the history at 10 entries, dropping the oldest', () => {
    for (let i = 0; i < 12; i++) {
      addMyBooksHostToHistory(`https://host-${i}.example.com`);
    }

    const history = getMyBooksHostHistory();
    expect(history).toHaveLength(10);
    expect(history[0]).toBe('https://host-11.example.com');
    expect(history).not.toContain('https://host-0.example.com');
    expect(history).not.toContain('https://host-1.example.com');
  });

  test('ignores empty values', () => {
    addMyBooksHostToHistory('');
    expect(getMyBooksHostHistory()).toEqual([]);
  });

  test('keeps host and username histories independent', () => {
    addMyBooksHostToHistory('https://a.example.com');
    addMyBooksUsernameToHistory('alice');

    expect(getMyBooksHostHistory()).toEqual(['https://a.example.com']);
    expect(getMyBooksUsernameHistory()).toEqual(['alice']);
  });
});

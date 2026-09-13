import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GAP_MS,
  ActiveReadingTracker,
  MAX_DAILY_SECONDS,
  utcDateString,
} from '@/services/mybooks/activeReadingTracker';

describe('utcDateString', () => {
  it('formats as YYYY-MM-DD in UTC regardless of local timezone', () => {
    // 2026-01-01T00:30:00Z: a local timezone west of UTC would still be
    // "2025-12-31" locally, but the tracker must bucket by UTC.
    const ts = Date.UTC(2026, 0, 1, 0, 30, 0);
    expect(utcDateString(ts)).toBe('2026-01-01');
  });
});

describe('ActiveReadingTracker.tick', () => {
  it('does not count the first tick (no prior tick to measure elapsed time against)', () => {
    const tracker = new ActiveReadingTracker({}, 1000);
    const changed = tracker.tick(true, 1000);
    expect(changed).toBe(false);
    expect(tracker.isEmpty()).toBe(true);
  });

  it('accumulates elapsed seconds across consecutive active ticks', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    tracker.tick(true, t0 + 20_000);
    expect(tracker.getPending()).toEqual({ '2026-01-01': 20 });
  });

  it('does not count ticks while the window is inactive', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0);
    tracker.tick(true, t0);
    tracker.tick(false, t0 + 10_000); // backgrounded
    tracker.tick(true, t0 + 20_000); // foregrounded again
    // the 10s while backgrounded must not be counted, and the tick right
    // after resuming also isn't counted (its "previous tick" was inactive)
    expect(tracker.isEmpty()).toBe(true);
  });

  it('does not count a tick once the gap since the last interaction exceeds ACTIVE_GAP_MS', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0);
    tracker.tick(true, t0);
    const idleAt = t0 + ACTIVE_GAP_MS + 1_000;
    const changed = tracker.tick(true, idleAt);
    expect(changed).toBe(false);
    expect(tracker.isEmpty()).toBe(true);
  });

  it('resumes counting once a fresh interaction lands within the gap window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0);
    tracker.tick(true, t0);
    tracker.noteInteraction(t0 + 5_000);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()).toEqual({ '2026-01-01': 10 });
  });

  it('splits accumulation across the UTC day boundary into separate buckets', () => {
    const beforeMidnight = Date.UTC(2025, 11, 31, 23, 59, 50);
    const tracker = new ActiveReadingTracker({}, beforeMidnight);
    tracker.tick(true, beforeMidnight);
    tracker.tick(true, beforeMidnight + 10_000); // crosses into 2026-01-01
    const pending = tracker.getPending();
    expect(pending['2025-12-31']).toBeUndefined();
    expect(pending['2026-01-01']).toBe(10);
  });

  it('caps a single day at MAX_DAILY_SECONDS', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({ '2026-01-01': MAX_DAILY_SECONDS - 5 }, t0);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()['2026-01-01']).toBe(MAX_DAILY_SECONDS);
  });
});

describe('ActiveReadingTracker.clearSent', () => {
  it('subtracts only the acked amount, keeping seconds accumulated while the push was in flight', () => {
    const tracker = new ActiveReadingTracker({ '2026-01-01': 130 });
    tracker.clearSent({ '2026-01-01': 100 });
    expect(tracker.getPending()).toEqual({ '2026-01-01': 30 });
  });

  it('removes the day entirely once fully acked', () => {
    const tracker = new ActiveReadingTracker({ '2026-01-01': 100 });
    tracker.clearSent({ '2026-01-01': 100 });
    expect(tracker.isEmpty()).toBe(true);
  });

  it('is a no-op for dates that were never pending', () => {
    const tracker = new ActiveReadingTracker({ '2026-01-01': 50 });
    tracker.clearSent({ '2026-01-02': 999 });
    expect(tracker.getPending()).toEqual({ '2026-01-01': 50 });
  });
});

describe('ActiveReadingTracker.toReadingSecondsPayload', () => {
  it('maps every pending day to a {book_hash, date, seconds} entry', () => {
    const tracker = new ActiveReadingTracker({ '2026-01-01': 100, '2026-01-02': 200 });
    const payload = tracker.toReadingSecondsPayload('cloud-1-epub');
    expect(payload).toEqual(
      expect.arrayContaining([
        { book_hash: 'cloud-1-epub', date: '2026-01-01', seconds: 100 },
        { book_hash: 'cloud-1-epub', date: '2026-01-02', seconds: 200 },
      ]),
    );
    expect(payload).toHaveLength(2);
  });

  it('omits zero-second entries', () => {
    const tracker = new ActiveReadingTracker({ '2026-01-01': 0 });
    expect(tracker.toReadingSecondsPayload('cloud-1-epub')).toEqual([]);
  });
});

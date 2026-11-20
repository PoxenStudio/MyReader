import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GAP_MS,
  ActiveReadingTracker,
  MAX_DAILY_SECONDS,
  siteDateString,
} from '@/services/mybooks/activeReadingTracker';

const UTC = 'UTC';
const SHANGHAI = 'Asia/Shanghai';

describe('siteDateString', () => {
  it('uses the site timezone day instead of the UTC day', () => {
    // 2026-10-30T16:30Z = 北京 2026-10-31 00:30：UTC 日还停在 30 号。
    // 按 UTC 分桶正是这次要修的 bug——东八区凌晨的阅读会被算到前一天。
    const ts = Date.UTC(2026, 9, 30, 16, 30, 0);
    expect(siteDateString(ts, SHANGHAI)).toBe('2026-10-31');
    expect(siteDateString(ts, UTC)).toBe('2026-10-30');
  });

  it('handles negative offsets', () => {
    // 2026-01-01T01:00Z = 圣保罗 2025-12-31 22:00
    const ts = Date.UTC(2026, 0, 1, 1, 0, 0);
    expect(siteDateString(ts, 'America/Sao_Paulo')).toBe('2025-12-31');
  });

  it('follows DST instead of a fixed offset', () => {
    // 纽约：同一 UTC 钟点，冬季 EST(-5) 落在前一天、夏季 EDT(-4) 落在当天
    expect(siteDateString(Date.UTC(2026, 0, 15, 4, 30), 'America/New_York')).toBe('2026-01-14');
    expect(siteDateString(Date.UTC(2026, 6, 15, 4, 30), 'America/New_York')).toBe('2026-07-15');
  });

  it('falls back to the UTC day when the server does not send a timezone', () => {
    // 老服务端（没有 sys.timezone）按 UTC 日统计，客户端跟着用 UTC 才对齐；
    // 退回设备本地日会在"UTC 站点 + 非 UTC 设备"这种组合上把正确的时间记错一天。
    const ts = Date.UTC(2026, 9, 30, 16, 30, 0);
    for (const tz of [undefined, null, '']) {
      expect(siteDateString(ts, tz)).toBe('2026-10-30');
    }
    expect(siteDateString(ts)).toBe('2026-10-30');
  });

  it('falls back to the browser day when the timezone name is invalid', () => {
    // 服务端有值但浏览器不认（老 WebView 缺 tzdata / 名字拼错）：只能猜设备本地日
    const ts = Date.UTC(2026, 0, 1, 12, 0, 0);
    const local = new Date(ts);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`;
    expect(siteDateString(ts, 'Not/AZone')).toBe(expected);
  });
});

describe('ActiveReadingTracker.tick', () => {
  it('does not count the first tick (no prior tick to measure elapsed time against)', () => {
    const tracker = new ActiveReadingTracker({}, 1000, UTC);
    const changed = tracker.tick(true, 1000);
    expect(changed).toBe(false);
    expect(tracker.isEmpty()).toBe(true);
  });

  it('accumulates elapsed seconds across consecutive active ticks', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0, UTC);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    tracker.tick(true, t0 + 20_000);
    expect(tracker.getPending()).toEqual({ '2026-01-01': 20 });
  });

  it('does not count ticks while the window is inactive', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0, UTC);
    tracker.tick(true, t0);
    tracker.tick(false, t0 + 10_000); // backgrounded
    tracker.tick(true, t0 + 20_000); // foregrounded again
    // the 10s while backgrounded must not be counted, and the tick right
    // after resuming also isn't counted (its "previous tick" was inactive)
    expect(tracker.isEmpty()).toBe(true);
  });

  it('does not count a tick once the gap since the last interaction exceeds ACTIVE_GAP_MS', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0, UTC);
    tracker.tick(true, t0);
    const idleAt = t0 + ACTIVE_GAP_MS + 1_000;
    const changed = tracker.tick(true, idleAt);
    expect(changed).toBe(false);
    expect(tracker.isEmpty()).toBe(true);
  });

  it('resumes counting once a fresh interaction lands within the gap window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({}, t0, UTC);
    tracker.tick(true, t0);
    tracker.noteInteraction(t0 + 5_000);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()).toEqual({ '2026-01-01': 10 });
  });

  it('buckets early-morning reading by the site day, not the UTC day', () => {
    // 北京 2026-10-31 00:30 = UTC 2026-10-30 16:30
    const t0 = Date.UTC(2026, 9, 30, 16, 30, 0);
    const tracker = new ActiveReadingTracker({}, t0, SHANGHAI);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()).toEqual({ '2026-10-31': 10 });
  });

  it('splits accumulation across the site day boundary into separate buckets', () => {
    // 北京 2025-12-31 23:59:50 = UTC 2025-12-31 15:59:50
    const beforeMidnight = Date.UTC(2025, 11, 31, 15, 59, 50);
    const tracker = new ActiveReadingTracker({}, beforeMidnight, SHANGHAI);
    tracker.tick(true, beforeMidnight);
    tracker.tick(true, beforeMidnight + 10_000); // crosses into 2026-01-01 local
    const pending = tracker.getPending();
    expect(pending['2025-12-31']).toBeUndefined();
    expect(pending['2026-01-01']).toBe(10);
  });

  it('follows setTimezone for seconds accumulated afterwards', () => {
    const t0 = Date.UTC(2026, 9, 30, 16, 30, 0);
    const tracker = new ActiveReadingTracker({}, t0, UTC);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()).toEqual({ '2026-10-30': 10 });

    tracker.setTimezone(SHANGHAI);
    tracker.tick(true, t0 + 20_000);
    expect(tracker.getPending()).toEqual({ '2026-10-30': 10, '2026-10-31': 10 });
  });

  it('caps a single day at MAX_DAILY_SECONDS', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const tracker = new ActiveReadingTracker({ '2026-01-01': MAX_DAILY_SECONDS - 5 }, t0, UTC);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()['2026-01-01']).toBe(MAX_DAILY_SECONDS);
  });

  it('applies the daily cap per date key when the timezone changes mid-session', () => {
    // 封顶按"日期键"算：切到新时区后新键从 0 开始，旧键保持已封顶的值
    const t0 = Date.UTC(2026, 9, 30, 16, 30, 0);
    const tracker = new ActiveReadingTracker({ '2026-10-30': MAX_DAILY_SECONDS - 5 }, t0, UTC);
    tracker.tick(true, t0);
    tracker.tick(true, t0 + 10_000);
    expect(tracker.getPending()['2026-10-30']).toBe(MAX_DAILY_SECONDS);

    tracker.setTimezone(SHANGHAI);
    tracker.tick(true, t0 + 20_000);
    expect(tracker.getPending()).toEqual({
      '2026-10-30': MAX_DAILY_SECONDS,
      '2026-10-31': 10,
    });
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

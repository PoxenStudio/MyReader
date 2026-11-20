/**
 * 客户端本地"活跃阅读"计时——覆盖心跳推算完全看不到的场景（尤其是离线阅读），见
 * document/Reading_Stats_Design.md 的离线阅读扩展。判定口径复用服务端
 * `HEARTBEAT_MAX_GAP`（60s）：最近一次翻页/滚动/交互距现在超过这个窗口就不计时，
 * 避免把"开着书但人已经走开"算进去。
 *
 * 分桶日期必须是**站点时区**下的一天：新版 MyBooks 服务端的网页心跳和仪表盘都按
 * sys.timezone 切天（webserver/site_time.py）。这里若按 UTC 分桶，东八区读者本地
 * 00:00–07:59 的阅读会被上报成前一天——统计页「今日时长」从 0 点起一直不涨，连击、
 * 热力图、周/月归属也跟着错位。站点时区名由 /user/info 的 sys.timezone 下发，
 * 创建 tracker 时传进来。
 */

export const ACTIVE_GAP_MS = 60_000;
export const TICK_INTERVAL_MS = 10_000;
export const PERSIST_INTERVAL_MS = 30_000;
export const KEEPALIVE_PUSH_MS = 60_000;
// 与服务端 MANUAL_READING_MAX_SECONDS 对齐，防止本地计时器出错（比如设备休眠期间时钟跳变）
// 把某一天的秒数攒到不合理的量级。
export const MAX_DAILY_SECONDS = 18 * 3600;

// 值为 null 表示"这个时区名已知不合法"，避免每 10 秒的 tick 重复抛一次 RangeError
const dateFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function utcDateString(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function localDateString(now: number): string {
  const local = new Date(now);
  return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;
}

/**
 * `now` 在 `timezone`（IANA 名，如 Asia/Shanghai）下是哪一天，格式 YYYY-MM-DD。
 *
 * 三种情况要分开：
 * - 字段缺失/空（undefined、null、''）：服务端早于 site_time.py，那时它按 **UTC 日**
 *   切天，客户端跟着用 UTC 才对齐。退回设备本地日会在"UTC 站点 + 非 UTC 设备"上
 *   把本来正确的时间记错一天。
 * - 有值：按 IANA 名算。formatter 按时区名缓存，tick 每 10 秒一次不必重复构造。
 * - 有值但浏览器不认（老 WebView 缺 tzdata、名字拼错）：只能猜设备本地日，并把这个
 *   名字记成"已知非法"，避免每次都抛异常。
 */
export function siteDateString(now: number = Date.now(), timezone?: string | null): string {
  if (!timezone) return utcDateString(now);

  let formatter = dateFormatterCache.get(timezone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      formatter = null;
    }
    dateFormatterCache.set(timezone, formatter);
  }
  if (formatter) {
    const parts = formatter.formatToParts(new Date(now));
    const pick = (type: string) => parts.find((part) => part.type === type)?.value;
    const [y, m, d] = [pick('year'), pick('month'), pick('day')];
    if (y && m && d) return `${y}-${m}-${d}`;
  }
  return localDateString(now);
}

export interface ReadingSecondsEntry {
  book_hash: string;
  date: string;
  seconds: number;
}

/**
 * 一本书的本地阅读计时状态。不做任何网络/存储 IO——持久化和上报都交给调用方
 * （见 useNativeSync.ts 的接入），这里只管"这段时间算不算阅读、算进哪一天"。
 */
export class ActiveReadingTracker {
  private pending: Record<string, number>;
  private lastTickAt: number | null = null;
  private lastInteractionAt: number;
  private timezone: string | null;

  constructor(
    initialPending: Record<string, number> = {},
    now: number = Date.now(),
    timezone: string | null = null,
  ) {
    this.pending = { ...initialPending };
    this.lastInteractionAt = now;
    this.timezone = timezone;
  }

  /**
   * 更新站点时区（管理员改了 site_timezone，或切到了另一台服务器）。只影响之后新攒的
   * 秒数：已经落在旧日期键里的 pending 保持原样，它们记录的是当时上报口径下的那一天。
   */
  setTimezone(timezone: string | null | undefined): void {
    this.timezone = timezone ?? null;
  }

  /** 翻页/滚动/高亮等任意"用户仍在读"的信号。 */
  noteInteraction(now: number = Date.now()): void {
    this.lastInteractionAt = now;
  }

  /**
   * 定期调用（见 TICK_INTERVAL_MS）。`isWindowActive` 为 false（后台/失焦）时不计时，
   * 但仍要刷新 lastTickAt，否则恢复前台后会把整段后台时间也计进去。
   * 返回是否有新增秒数（调用方可据此决定要不要立即持久化）。
   */
  tick(isWindowActive: boolean, now: number = Date.now()): boolean {
    const previousTickAt = this.lastTickAt;
    // Any break in the streak (backgrounded, or idle too long) must reset
    // lastTickAt to null rather than leave it at some past timestamp — a
    // later tick would otherwise measure elapsed time all the way back to
    // that stale timestamp and wrongly credit the entire backgrounded/idle
    // gap as reading time. Resetting makes the next tick behave exactly
    // like the very first tick ever (0 contribution, nothing to compare
    // against yet).
    if (!isWindowActive) {
      this.lastTickAt = null;
      return false;
    }
    if (previousTickAt === null) {
      this.lastTickAt = now;
      return false;
    }
    if (now - this.lastInteractionAt > ACTIVE_GAP_MS) {
      this.lastTickAt = null;
      return false;
    }

    const elapsedSeconds = Math.round((now - previousTickAt) / 1000);
    this.lastTickAt = now;
    if (elapsedSeconds <= 0) return false;

    const date = siteDateString(now, this.timezone);
    const current = this.pending[date] ?? 0;
    this.pending[date] = Math.min(current + elapsedSeconds, MAX_DAILY_SECONDS);
    return true;
  }

  getPending(): Record<string, number> {
    return { ...this.pending };
  }

  isEmpty(): boolean {
    return Object.keys(this.pending).length === 0;
  }

  /**
   * 上报成功后调用：按"发出去时的快照"扣减，而不是整段清零——请求在途期间
   * 计时器仍可能继续累加同一天的秒数，直接清零会把这部分也丢掉。
   */
  clearSent(sent: Record<string, number>): void {
    for (const [date, seconds] of Object.entries(sent)) {
      const remaining = (this.pending[date] ?? 0) - seconds;
      if (remaining > 0) this.pending[date] = remaining;
      else delete this.pending[date];
    }
  }

  toReadingSecondsPayload(bookHash: string): ReadingSecondsEntry[] {
    return Object.entries(this.pending)
      .filter(([, seconds]) => seconds > 0)
      .map(([date, seconds]) => ({ book_hash: bookHash, date, seconds }));
  }
}

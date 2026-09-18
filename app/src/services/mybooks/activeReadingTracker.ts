/**
 * 客户端本地"活跃阅读"计时——覆盖心跳推算完全看不到的场景（尤其是离线阅读），见
 * document/Reading_Stats_Design.md 的离线阅读扩展。判定口径复用服务端
 * `HEARTBEAT_MAX_GAP`（60s）：最近一次翻页/滚动/交互距现在超过这个窗口就不计时，
 * 避免把"开着书但人已经走开"算进去。按 UTC 日期分桶，与服务端 `Reading.date`
 * 的存储语义保持一致——上报前的时区转换由这个模块完成，不依赖调用方记得转换。
 */

export const ACTIVE_GAP_MS = 60_000;
export const TICK_INTERVAL_MS = 10_000;
export const PERSIST_INTERVAL_MS = 30_000;
export const KEEPALIVE_PUSH_MS = 60_000;
// 与服务端 MANUAL_READING_MAX_SECONDS 对齐，防止本地计时器出错（比如设备休眠期间时钟跳变）
// 把某一天的秒数攒到不合理的量级。
export const MAX_DAILY_SECONDS = 18 * 3600;

export function utcDateString(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
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

  constructor(initialPending: Record<string, number> = {}, now: number = Date.now()) {
    this.pending = { ...initialPending };
    this.lastInteractionAt = now;
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

    const date = utcDateString(now);
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

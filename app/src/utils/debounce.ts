interface DebounceOptions {
  emitLast?: boolean;
  /**
   * Upper bound (ms) on how long the trailing timer can keep getting pushed
   * back before the call is forced through. Without this, calls arriving
   * faster than `delay` apart reset the timer forever and the function never
   * runs — e.g. `useNativeSync`'s push debounce (15s) was starved for
   * minutes by continuous page-turn events each landing well under 15s
   * apart, so `pushSync` never got a quiet gap to fire in.
   */
  maxWait?: number;
}

/**
 * Debounces a function by waiting `delay` ms after the last call before executing it.
 * If `emitLast` is false, it cancels the call instead of delaying it.
 * If `maxWait` is set, the call is forced through after at most `maxWait` ms
 * from the first call in a burst, even if calls keep resetting `delay`.
 *
 * @returns A debounced function with additional `flush` and `cancel` methods.
 */
export const debounce = <T extends (...args: Parameters<T>) => void | Promise<void>>(
  func: T,
  delay: number,
  options: DebounceOptions = {},
): ((...args: Parameters<T>) => void) & { flush: () => void; cancel: () => void } => {
  // Merge with defaults rather than relying on the parameter default, so a
  // caller passing e.g. `{ maxWait }` without `emitLast` doesn't silently
  // flip to the emitLast:false branch.
  const { emitLast = true, maxWait } = options;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let maxTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const clearTimers = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (maxTimeout) {
      clearTimeout(maxTimeout);
      maxTimeout = null;
    }
  };

  const debounced = (...args: Parameters<T>): void => {
    lastArgs = args;
    if (timeout) {
      clearTimeout(timeout);
    }

    if (emitLast) {
      timeout = setTimeout(() => {
        timeout = null;
        if (maxTimeout) {
          clearTimeout(maxTimeout);
          maxTimeout = null;
        }
        if (lastArgs) {
          func(...(lastArgs as Parameters<T>));
          lastArgs = null;
        }
      }, delay);
    } else {
      timeout = setTimeout(() => {
        timeout = null;
        if (maxTimeout) {
          clearTimeout(maxTimeout);
          maxTimeout = null;
        }
        func(...args);
      }, delay);
    }

    // Only arm the maxWait timer once per burst — it tracks time since the
    // *first* call, not the latest one, so it isn't reset by `debounced()`
    // calls the way `timeout` is.
    if (maxWait && !maxTimeout) {
      maxTimeout = setTimeout(() => {
        maxTimeout = null;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (lastArgs) {
          func(...(lastArgs as Parameters<T>));
          lastArgs = null;
        }
      }, maxWait);
    }
  };

  /**
   * Immediately executes the last pending debounced function call.
   */
  debounced.flush = () => {
    if (timeout || maxTimeout) {
      clearTimers();
      if (lastArgs) {
        func(...(lastArgs as Parameters<T>));
        lastArgs = null;
      }
    }
  };

  /**
   * Cancels the pending debounced function call.
   */
  debounced.cancel = () => {
    clearTimers();
    lastArgs = null;
  };

  return debounced;
};

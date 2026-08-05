/**
 * Diagnostic logger for MyBooks Native Sync (`useNativeSync`).
 *
 * Added to chase down reports that opening a cloud book sometimes doesn't
 * pick up the server's reading progress. The pull-on-open is async and runs
 * concurrently with several local writers (the view's initial relocate, the
 * progress auto-save debounce, the sync hook's own push debounce), so a
 * plain text trace of what each side saw and when is the fastest way to
 * tell, from a real user's logs, which race actually fired.
 *
 * Left on unconditionally for now — the bug reportedly needs real (and
 * apparently sometimes slow) network conditions to reproduce, so gating
 * this behind a dev-only flag would make it useless for the reports that
 * matter. Once the race is confirmed and fixed, dial this back down to
 * warn-level only (or remove it).
 */

const PREFIX = '[SYNC]';

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export function syncLog(bookKey: string, event: string, data?: Record<string, unknown>): void {
  if (data !== undefined) {
    console.log(`${PREFIX} ${ts()} [${bookKey}] ${event}`, data);
  } else {
    console.log(`${PREFIX} ${ts()} [${bookKey}] ${event}`);
  }
}

export function syncWarn(bookKey: string, event: string, data?: Record<string, unknown>): void {
  if (data !== undefined) {
    console.warn(`${PREFIX} ${ts()} [${bookKey}] ${event}`, data);
  } else {
    console.warn(`${PREFIX} ${ts()} [${bookKey}] ${event}`);
  }
}

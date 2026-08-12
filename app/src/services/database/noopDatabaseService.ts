import { DatabaseService, DatabaseExecResult, DatabaseRow } from '@/types/database';

/**
 * No-op DatabaseService for deployments that opt out of local persistence
 * (see `isLocalDbDisabled()` in `@/services/environment`) — currently the
 * MyBooks-embedded single-book reader, which only needs in-page reading
 * state plus sync push/pull with MyBooks, never a local turso database.
 *
 * Every read reports an empty result and every write silently no-ops, which
 * downstream callers (statistics, TTS/translator/OPDS/Hardcover caches, the
 * Reedy assistant's memory) already treat as "nothing cached/recorded yet" —
 * none of them require persistence to behave correctly, just to be faster
 * or remember things across sessions. `migrate()` also degrades cleanly:
 * `PRAGMA user_version` reads back as unset, so migrations "apply" against
 * a throwaway no-op transaction and are simply never persisted.
 *
 * Swapping this in (see `WebAppService.openDatabase`) is what lets
 * `scripts/build-docker-dist.sh` strip `@readest/turso-database-wasm` (and
 * its ~12MB wasm blob) out of the embedded-reader Docker bundle entirely —
 * this class never imports it, so nothing in that code path can reach it.
 */
export class NoopDatabaseService implements DatabaseService {
  async execute(): Promise<DatabaseExecResult> {
    return { rowsAffected: 0, lastInsertId: 0 };
  }

  async select<T extends DatabaseRow = DatabaseRow>(): Promise<T[]> {
    return [];
  }

  async batch(): Promise<void> {}

  async close(): Promise<void> {}
}

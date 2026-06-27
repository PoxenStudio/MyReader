import { invoke } from "@tauri-apps/api/core";

/** Cipher types for encryption */
export type Cipher = "aes256cbc";

/** Encryption configuration */
export interface EncryptionConfig {
  /** Cipher to use for encryption */
  cipher: Cipher;
  /** Encryption key as bytes */
  key: number[] | Uint8Array;
}

/** Options for loading a database */
export interface LoadOptions {
  /**
   * Database path.
   * - Local file: `"sqlite:myapp.db"`
   * - Pure remote (Turso): `"turso://mydb-org.turso.io"`
   */
  path: string;
  /** Encryption configuration (local databases only) */
  encryption?: EncryptionConfig;
  /**
   * Remote Turso URL for embedded replica mode.
   * When set, the database operates as an embedded replica:
   * a local SQLite file kept in sync with the remote.
   * Requires the `replication` feature in Cargo.toml.
   *
   * @example "turso://mydb-org.turso.io"
   */
  syncUrl?: string;
  /**
   * Auth token for Turso / remote connections.
   * Required when `syncUrl` is set or when `path` is a remote URL.
   */
  authToken?: string;
  /**
   * Optional list of experimental features to enable.
   * @example ["index_method"] // enables FTS and vector search
   */
  experimental?: string[];
}

/** Result of an execute operation */
export interface QueryResult {
  /** Number of rows affected */
  rowsAffected: number;
  /** Last inserted row ID */
  lastInsertId: number;
}

/**
 * **Database**
 *
 * The `Database` class serves as the primary interface for
 * communicating with the turso plugin.
 */
export class Database {
  /** The database path */
  path: string;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * **load**
   *
   * A static initializer which connects to the underlying database and
   * returns a `Database` instance once a connection to the database is established.
   *
   * # Path Format
   *
   * The path is relative to `tauri::path::BaseDirectory::AppConfig` and must start with `sqlite:`.
   *
   * @example
   * ```ts
   * // Simple load
   * const db = await Database.load("sqlite:test.db");
   *
   * // With encryption
   * const db = await Database.load({
   *   path: "sqlite:encrypted.db",
   *   encryption: {
   *     cipher: "aes-256-cbc",
   *     key: [1, 2, 3, ...] // 32 bytes for AES-256
   *   }
   * });
   * ```
   */
  static async load(pathOrOptions: string | LoadOptions): Promise<Database> {
    const options =
      typeof pathOrOptions === "string"
        ? { path: pathOrOptions }
        : pathOrOptions;

    const _path = await invoke<string>("plugin:turso|load", { options });
    return new Database(_path);
  }

  /**
   * **execute**
   *
   * Passes a SQL expression to the database for execution.
   *
   * @example
   * ```ts
   * // INSERT example
   * const result = await db.execute(
   *   "INSERT INTO todos (id, title, status) VALUES ($1, $2, $3)",
   *   [todos.id, todos.title, todos.status]
   * );
   * // UPDATE example
   * const result = await db.execute(
   *   "UPDATE todos SET title = $1, completed = $2 WHERE id = $3",
   *   [todos.title, todos.status, todos.id]
   * );
   * ```
   */
  async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    const result = await invoke<QueryResult>("plugin:turso|execute", {
      db: this.path,
      query,
      values: bindValues ?? [],
    });
    return result;
  }

  /**
   * **select**
   *
   * Passes in a SELECT query to the database for execution.
   *
   * @example
   * ```ts
   * const result = await db.select<{ id: number; title: string }[]>(
   *   "SELECT * FROM todos WHERE id = $1",
   *   [id]
   * );
   * ```
   */
  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    const result = await invoke<T>("plugin:turso|select", {
      db: this.path,
      query,
      values: bindValues ?? [],
    });
    return result;
  }

  /**
   * **close**
   *
   * Closes the database connection pool.
   *
   * @example
   * ```ts
   * const success = await db.close()
   * ```
   *
   * @param db - Optionally state the name of a database if you are managing more than one. Otherwise, all database pools will be in scope.
   */
  /**
   * **batch**
   *
   * Executes multiple SQL statements atomically inside a single transaction.
   * If any statement fails the entire batch is rolled back.
   *
   * Statements must not use bound parameters — for parameterised queries use
   * `execute()` individually. Intended for DDL and bulk inserts/updates where
   * partial failure is unacceptable.
   *
   * @example
   * ```ts
   * await db.batch([
   *   "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
   *   "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT)",
   *   "CREATE INDEX idx_posts_user ON posts(user_id)",
   * ]);
   * ```
   */
  async batch(queries: string[]): Promise<void> {
    await invoke("plugin:turso|batch", { db: this.path, queries });
  }

  /**
   * **sync**
   *
   * Syncs an embedded replica with its remote Turso database.
   * Call this when you want to pull the latest remote changes, e.g. on app
   * resume or after a network reconnect.
   *
   * No-op for local-only databases (returns without error).
   * Requires the `replication` feature in Cargo.toml.
   *
   * @example
   * ```ts
   * const db = await Database.load({
   *   path: 'sqlite:local.db',
   *   syncUrl: 'turso://mydb-org.turso.io',
   *   authToken: 'my-token',
   * });
   * // ... later, pull latest remote changes
   * await db.sync();
   * ```
   */
  async sync(): Promise<void> {
    await invoke("plugin:turso|sync", { db: this.path });
  }

  async close(db?: string): Promise<boolean> {
    const success = await invoke<boolean>("plugin:turso|close", { db });
    return success;
  }
}

/** Plugin configuration info */
export interface ConfigInfo {
  /** Whether encryption is enabled */
  encrypted: boolean;
}

/**
 * Get plugin configuration info
 * 
 * @returns ConfigInfo with encryption status
 */
export async function getConfig(): Promise<ConfigInfo> {
  return invoke<ConfigInfo>("plugin:turso|get_config");
}

// Re-export for drizzle integration
export { createDrizzleProxy } from "./drizzle";

// Re-export migration utility
export { migrate } from "./migrate";
export type { MigrationFiles, MigrateOptions } from "./migrate";

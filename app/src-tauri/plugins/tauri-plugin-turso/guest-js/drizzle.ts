import { invoke } from '@tauri-apps/api/core'

/**
 * Callback function type for drizzle-orm/sqlite-proxy.
 * Supports all methods: 'all', 'run', 'get', 'values'
 */
export type SqliteProxyCallback = (
  sql: string,
  params: unknown[],
  method: 'all' | 'run' | 'get' | 'values'
) => Promise<{ rows: unknown[] }>

interface LoadOptions {
  path: string
  encryption?: {
    cipher: 'aes256cbc'
    key: number[] | Uint8Array
  }
}

/**
 * Shared implementation for both proxy variants.
 *
 * Keeps a `loaded` flag to avoid re-opening the connection on every query.
 * If the connection is closed externally (via `Database.close()`), the next
 * query will fail with a "not loaded" error from Rust — at that point the
 * caller should reinitialise via `Database.load()` and recreate the proxy.
 */
function createProxy(options: LoadOptions): SqliteProxyCallback {
  let loaded = false

  return async (sql: string, params: unknown[], method: 'all' | 'run' | 'get' | 'values') => {
    if (!loaded) {
      await invoke<string>('plugin:turso|load', { options })
      loaded = true
    }

    const isSelect = /^\s*(\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*SELECT\b/i.test(sql)

    if (isSelect || method === 'all' || method === 'get' || method === 'values') {
      const rows = await invoke<Record<string, unknown>[]>('plugin:turso|select', {
        db: options.path,
        query: sql,
        values: params as unknown[],
      })

      // Transform rows to the array-per-row format Drizzle expects.
      // IndexMap on the Rust side guarantees column insertion order is preserved.
      const transformedRows = rows.map((row) => Object.values(row))

      if (method === 'get') {
        return { rows: transformedRows[0] ? [transformedRows[0]] : [] }
      }
      // 'all' and 'values' both return all rows as arrays
      return { rows: transformedRows }
    }

    // INSERT / UPDATE / DELETE / DDL
    await invoke('plugin:turso|execute', {
      db: options.path,
      query: sql,
      values: params as unknown[],
    })
    return { rows: [] }
  }
}

/**
 * Creates a callback compatible with drizzle-orm/sqlite-proxy.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/sqlite-proxy';
 * import { createDrizzleProxy } from 'tauri-plugin-turso-api';
 * import * as schema from './schema';
 *
 * const db = drizzle(createDrizzleProxy('sqlite:test.db'), { schema });
 * ```
 */
export function createDrizzleProxy(dbPath: string): SqliteProxyCallback {
  return createProxy({ path: dbPath })
}

/**
 * Creates a callback with encryption support.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/sqlite-proxy';
 * import { createDrizzleProxyWithEncryption } from 'tauri-plugin-turso-api';
 *
 * const db = drizzle(
 *   createDrizzleProxyWithEncryption({
 *     path: 'sqlite:encrypted.db',
 *     encryption: { cipher: 'aes256cbc', key: myKey },
 *   }),
 *   { schema }
 * );
 * ```
 */
export function createDrizzleProxyWithEncryption(options: LoadOptions): SqliteProxyCallback {
  return createProxy(options)
}

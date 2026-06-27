import { invoke } from '@tauri-apps/api/core'

/**
 * A map of migration file paths to their SQL content.
 * Typically produced by Vite's `import.meta.glob` at build time.
 *
 * @example
 * ```ts
 * const migrations = import.meta.glob('./drizzle/*.sql', {
 *   eager: true,
 *   query: '?raw',
 *   import: 'default',
 * }) satisfies MigrationFiles
 * ```
 */
export type MigrationFiles = Record<string, string>

export interface MigrateOptions {
  /**
   * Name of the table used to track applied migrations.
   * @default '__drizzle_migrations'
   */
  migrationsTable?: string
}

interface ParsedMigration {
  filename: string
  sql: string
  index: number
}

function parseMigrations(files: MigrationFiles): ParsedMigration[] {
  const migrations: ParsedMigration[] = []

  for (const [path, sql] of Object.entries(files)) {
    // Match drizzle-kit naming: 0000_xxx.sql, 0001_xxx.sql, etc.
    const match = path.match(/(\d+)[_\-].*\.sql$/)
    if (match && sql) {
      migrations.push({
        filename: path.split('/').pop()!,
        sql: sql as string,
        index: parseInt(match[1]!, 10),
      })
    }
  }

  return migrations.sort((a, b) => a.index - b.index)
}

/**
 * Runs pending Drizzle ORM migrations against a turso database.
 *
 * Because the Tauri plugin runs inside a browser context, standard
 * drizzle-kit migrate (which reads from the filesystem) cannot be used.
 * Instead, bundle your migration SQL files at build time with Vite's
 * `import.meta.glob` and pass them here.
 *
 * Call this AFTER `Database.load()` and BEFORE any queries.
 *
 * @param dbPath - The database path (e.g. "sqlite:app.db")
 * @param migrationFiles - SQL file contents keyed by path, from `import.meta.glob`
 * @param options - Optional configuration
 *
 * @example
 * ```ts
 * import { Database, migrate } from 'tauri-plugin-turso-api'
 *
 * // Bundle migrations at build time (glob pattern relative to this file)
 * const migrations = import.meta.glob('../drizzle/*.sql', {
 *   eager: true,
 *   query: '?raw',
 *   import: 'default',
 * })
 *
 * await Database.load('sqlite:app.db')
 * await migrate('sqlite:app.db', migrations)
 * ```
 */
export async function migrate(
  dbPath: string,
  migrationFiles: MigrationFiles,
  options: MigrateOptions = {},
): Promise<void> {
  const table = options.migrationsTable ?? '__drizzle_migrations'

  // Ensure migrations tracking table exists
  await invoke('plugin:turso|execute', {
    db: dbPath,
    query: `CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    values: [],
  })

  // Get already-applied migrations
  const applied = await invoke<Array<{ hash: string }>>('plugin:turso|select', {
    db: dbPath,
    query: `SELECT hash FROM ${table}`,
    values: [],
  })
  const appliedSet = new Set(applied.map((r) => r.hash))

  // Parse and sort migration files
  const migrations = parseMigrations(migrationFiles)

  for (const migration of migrations) {
    if (appliedSet.has(migration.filename)) {
      continue
    }

    // Split on semicolons to get individual statements.
    // Note: this is a naive split — semicolons inside string literals will
    // cause incorrect splits. drizzle-kit generated SQL does not produce this.
    const statements = migration.sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // Record the migration in the same transaction as the schema changes so
    // a partial failure leaves no trace. One invoke for the entire migration.
    const safeName = migration.filename.replace(/'/g, "''")
    statements.push(`INSERT INTO ${table} (hash) VALUES ('${safeName}')`)

    await invoke('plugin:turso|batch', {
      db: dbPath,
      queries: statements,
    })
  }
}

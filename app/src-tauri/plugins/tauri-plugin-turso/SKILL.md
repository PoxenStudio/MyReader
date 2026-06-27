---
name: tauri-plugin-turso
description: Use tauri-plugin-turso for SQLite database access in Tauri apps with Drizzle ORM, browser-safe migrations, optional AES-256-CBC encryption, and Turso embedded replica sync. Use when working on this plugin's source, writing apps that consume it, adding schema changes, debugging migration or query errors, configuring encryption, or setting up Turso remote sync.
version: 1.1.0
license: MIT
metadata:
  tags:
    - tauri
    - sqlite
    - turso
    - drizzle-orm
    - encryption
    - migrations
    - turso
    - replication
---

# tauri-plugin-turso

SQLite plugin for Tauri apps via turso. Provides encryption, Drizzle ORM integration, a browser-safe migration runner, and Turso embedded replica sync.

## Key Files

```
guest-js/index.ts          — Database class, getConfig, re-exports
guest-js/drizzle.ts        — createDrizzleProxy, createDrizzleProxyWithEncryption
guest-js/migrate.ts        — migrate() function
src/commands.rs            — Rust command handlers: load, execute, select, batch, sync, close
src/wrapper.rs             — DbConnection (local / replica / remote, catch_unwind protection)
src/desktop.rs             — Config struct, base_path resolution
src/lib.rs                 — Plugin init, command registration
src/error.rs               — Error types incl. OperationNotSupported
examples/todo-list/        — Two-panel demo: local SQLite (left) + Turso sync (right)
```

## Critical: Why a Custom Migrator Exists

`drizzle-orm/sqlite-proxy/migrator` calls `readMigrationFiles()` which reads from the filesystem at runtime. That API does not exist in a Tauri WebView (browser context). The plugin's `migrate()` function instead receives SQL content that Vite bundles into the app at build time via `import.meta.glob`.

## Startup Sequence (always in this order)

```typescript
// 1. Open/create the database file
await Database.load('sqlite:myapp.db');

// 2. Run pending migrations — must come before any table queries
await migrate('sqlite:myapp.db', migrations);

// 3. Now safe to use Drizzle
const db = drizzle(createDrizzleProxy('sqlite:myapp.db'), { schema });
```

Querying before `migrate()` causes "no such table" errors.

## Full Usage Pattern

### schema.ts

```typescript
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  completed: integer('completed').notNull().default(0),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

export type Todo = typeof todos.$inferSelect;
```

### drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/schema.ts',
  out: './drizzle',
});
```

### Generate migrations

```bash
npx drizzle-kit generate
# or
bun run db:generate
```

This creates `drizzle/0000_xxx.sql`, `drizzle/0001_xxx.sql`, etc. Commit these files.

### App startup (Svelte example)

```typescript
import { Database, migrate, createDrizzleProxy } from 'tauri-plugin-turso-api';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

// import.meta.glob path is relative to this source file
const migrations = import.meta.glob<string>('../drizzle/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const dbPath = 'sqlite:myapp.db';
await Database.load(dbPath);
await migrate(dbPath, migrations);

const db = drizzle(createDrizzleProxy(dbPath), { schema });
```

## Database Location

Relative paths resolve against `base_path` in the Rust plugin config:
- **Default**: `std::env::current_dir()` — where the Tauri process is launched from
- **Custom**: set `base_path: Some(PathBuf::from(...))` in `Config`
- Absolute paths are used as-is
- `:memory:` → in-memory database

Relative paths containing `..` are normalised and validated. A path that would escape `base_path` (e.g. `sqlite:../../etc/passwd`) is rejected with `InvalidDbUrl`.

The demo app (`src-tauri/src/lib.rs`) explicitly sets `base_path: Some(cwd)` so the DB lands next to where `bun run tauri dev` is invoked.

## Encryption

### Option 1: Plugin-level (recommended — key stays in Rust)

```rust
// src-tauri/src/lib.rs
let config = tauri_plugin_turso::Config {
    base_path: Some(cwd),
    encryption: Some(tauri_plugin_turso::EncryptionConfig {
        cipher: tauri_plugin_turso::Cipher::Aes256Cbc,
        key: my_32_byte_vec, // Vec<u8>
    }),
};
tauri::Builder::default()
    .plugin(tauri_plugin_turso::init_with_config(config))
    ...
```

The demo reads the key from `LIBSQL_ENCRYPTION_KEY` env var and pads/truncates to 32 bytes.

### Option 2: Per-database (key passed from frontend)

```typescript
const db = await Database.load({
  path: 'sqlite:secrets.db',
  encryption: {
    cipher: 'aes256cbc',
    key: Array.from(myUint8Array32), // must be exactly 32 bytes
  },
});
```

### With Drizzle + encryption

```typescript
const db = drizzle(
  createDrizzleProxyWithEncryption({
    path: 'sqlite:encrypted.db',
    encryption: { cipher: 'aes256cbc', key: myKey },
  }),
  { schema }
);
```

## Adding a New Column / Table (Migration Workflow)

1. Edit `src/lib/schema.ts`
2. Run `npx drizzle-kit generate` — creates a new numbered `.sql` file in `drizzle/`
3. Commit the new migration file
4. On next app launch, `migrate()` detects and applies it automatically

Never manually edit existing migration files. Add new ones only.

## Turso Embedded Replica

For local-first apps that sync with Turso cloud. Local reads are instant; writes go to the remote.

### Enable

In your app's `Cargo.toml`:
```toml
tauri-plugin-turso = { path = "...", features = ["replication"] }
```

### Usage

```typescript
const db = await Database.load({
  path: 'sqlite:local.db',           // local replica file
  syncUrl: 'turso://mydb-org.turso.io',
  authToken: 'your-turso-auth-token',
});

await migrate(db.path, migrations);

// Pull latest remote changes (on resume, reconnect, or user request)
await db.sync();
```

`Database.load()` does an initial sync automatically. Use separate local files for local-only and replica databases — mixing them causes a "metadata file missing" error.

### Troubleshooting Turso

| Symptom | Cause | Fix |
|---------|-------|-----|
| `loading` stuck forever | Bad URL causes turso to panic internally; IPC never responds | Plugin catches this via `catch_unwind` and returns a proper error |
| `no such table` after connecting | `__drizzle_migrations` has stale records from a previous run | Drop `todos` and `__drizzle_migrations`, re-run `migrate()` |
| "invalid local state: db file exists but metadata file does not" | Plain SQLite file being opened as an embedded replica | Use a separate `dbFile` for each mode |

## batch() — Atomic DDL / DML

Execute multiple SQL statements in a single transaction. Use for DDL or bulk inserts. **Do not use bound parameters** (`$1` placeholders) — use `execute()` for parameterised queries.

```typescript
await db.batch([
  'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
  'CREATE INDEX idx_name ON users(name)',
]);
```

> **Note**: `execute_batch()` from turso does not correctly route writes through the embedded replica layer. The plugin uses individual `execute()` calls inside an explicit `BEGIN`/`COMMIT` instead.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `no such table: todos` | `migrate()` not called before queries, or migration files missing | Check startup sequence; run `drizzle-kit generate` |
| `DatabaseNotLoaded` | Query sent before `Database.load()` | Call `Database.load()` first |
| `DatabaseNotLoaded` after close | `createDrizzleProxy` `loaded` flag doesn't reset on external close | Recreate the proxy after calling `Database.close()` |
| `Migration X failed` | Bad SQL in a migration file | Check the `.sql` file; fix schema definition |
| `path '...' escapes the base directory` | Relative path contains `..` that exits `base_path` | Use a path that stays within the configured base directory |
| DB file not found | Wrong working directory | Check `base_path` config or launch directory |
| Encryption error on open | Wrong key for existing encrypted DB | Use exact same key as when DB was created |
| `turso panicked building the database` | Malformed `syncUrl` (spaces, wrong scheme, etc.) | Trim the URL; ensure it starts with `turso://` or `https://` |
| `operation not supported: sync requires replication feature` | `db.sync()` called without `replication` feature | Add `features = ["replication"]` to `Cargo.toml` |

## Plugin Architecture

```
Frontend (TS)                    Rust Plugin
─────────────────                ─────────────────────────
Database.load()      ──invoke──▶ commands::load()
  migrate()          ──invoke──▶ commands::batch() (DDL in transaction)
  db.execute()       ──invoke──▶ commands::execute()
  db.select()        ──invoke──▶ commands::select()
  db.batch()         ──invoke──▶ commands::batch()
  db.sync()          ──invoke──▶ commands::sync()
  db.close()         ──invoke──▶ commands::close()
                                   │
                                 wrapper::DbConnection
                                   │ catch_unwind (panic → proper Error)
                                   ├── open_local()    — TursoBuilder::new_local
                                   ├── open_replica()  — new_remote_replica + initial sync
                                   └── open_remote()   — TursoBuilder::new_remote
                                   ▼
                                 turso (SQLite / Turso)
```

## Building the JS Package

After changing `guest-js/` files:

```bash
npm run build   # at repo root — runs rollup, outputs dist-js/
```

The demo app references the plugin as `file:../../` so it picks up the built output automatically.

## Permissions

Every Tauri command needs a permission. Default set in `permissions/default.toml`. To allow all commands in a capability:

```json
{
  "permissions": [
    "turso:allow-load",
    "turso:allow-execute",
    "turso:allow-select",
    "turso:allow-close"
  ]
}
```

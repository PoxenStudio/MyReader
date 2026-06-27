# PROJECT KNOWLEDGE BASE: tauri-plugin-turso

## OVERVIEW

Tauri v2 plugin wrapping the `turso` crate (v0.5.0) for local SQLite databases with optional AES-256-CBC encryption, Drizzle ORM integration, and browser-safe migrations. The Rust backend uses `turso::Builder` for local-only connections; the TypeScript frontend talks to it via Tauri IPC (`plugin:turso|<cmd>`).

FTS (Tantivy-based full-text search) and vector search are supported via `turso_core` with the `fts` feature and `experimental_index_method`.

## STRUCTURE

```
.
├── src/              # Rust plugin source
│   ├── lib.rs        # Plugin init, command registration (Builder::new("turso"))
│   ├── commands.rs   # Tauri command handlers: load, execute, select, batch, close, ping, get_config
│   ├── wrapper.rs    # DbConnection — turso::Builder/Connection/Database wrapper
│   ├── models.rs     # Serde types: LoadOptions, EncryptionConfig, QueryResult
│   ├── error.rs      # thiserror enum (Turso, Io, InvalidDbUrl, etc.), impl Serialize
│   ├── decode.rs     # turso::Value → serde_json::Value conversion
│   ├── desktop.rs    # Desktop Config struct, Turso state (base_path, encryption)
│   └── mobile.rs     # Mobile stub (re-uses desktop Config)
├── guest-js/         # TypeScript API
│   ├── index.ts      # Database class, LoadOptions, QueryResult, getConfig()
│   ├── drizzle.ts    # createDrizzleProxy() for drizzle-orm/sqlite-proxy
│   └── migrate.ts    # Browser-safe migration runner (import.meta.glob)
├── permissions/      # Tauri permission definitions (default.toml)
├── build.rs          # tauri_plugin::Builder for command permission gen
├── Cargo.toml        # turso 0.5.0 + turso_core 0.5.0 (fts feature)
└── package.json      # JS package: tauri-plugin-turso-api
```

## CODE MAP

| Symbol                      | Type   | Location               | Role                                              |
| --------------------------- | ------ | ---------------------- | ------------------------------------------------- |
| `init` / `init_with_config` | fn     | `src/lib.rs:25`        | Plugin entry, registers commands and managed state |
| `load`                      | cmd    | `src/commands.rs:16`   | Open DB connection, idempotent per path            |
| `execute`                   | cmd    | `src/commands.rs:49`   | SQL that doesn't return rows → `QueryResult`       |
| `select`                    | cmd    | `src/commands.rs:67`   | SQL that returns rows → `Vec<IndexMap>`            |
| `batch`                     | cmd    | `src/commands.rs:85`   | Multiple statements in BEGIN/COMMIT transaction    |
| `close`                     | cmd    | `src/commands.rs:102`  | Close one or all connections                       |
| `get_config`                | cmd    | `src/commands.rs:134`  | Returns `{ encrypted: bool }`                      |
| `DbConnection`              | struct | `src/wrapper.rs:14`    | Wraps `turso::Connection` + `turso::Database`      |
| `DbConnection::connect`     | fn     | `src/wrapper.rs:22`    | Builder setup with experimental features           |
| `resolve_local_path`        | fn     | `src/wrapper.rs:64`    | Path normalization, `..` escape prevention         |
| `json_to_params`            | fn     | `src/wrapper.rs:161`   | `Vec<JsonValue>` → `Vec<turso::Value>`             |
| `DbInstances`               | struct | `src/wrapper.rs:195`   | `Arc<Mutex<HashMap<String, Arc<DbConnection>>>>`   |
| `Turso`                     | struct | `src/desktop.rs:26`    | Managed state: base_path + default encryption      |
| `Error`                     | enum   | `src/error.rs:5`       | Plugin error types (Turso, Io, InvalidDbUrl, etc.) |
| `Database`                  | class  | `guest-js/index.ts:54` | Frontend API (load, execute, select, batch, close) |
| `createDrizzleProxy`        | fn     | `guest-js/drizzle.ts`  | sqlite-proxy callback for Drizzle ORM              |
| `migrate`                   | fn     | `guest-js/migrate.ts`  | Browser-safe Drizzle migration runner              |

## KEY TYPES (Rust)

```rust
// models.rs
LoadOptions { path: String, encryption: Option<EncryptionConfig>, experimental: Vec<String> }
EncryptionConfig { cipher: String, hexkey: String }  // → turso::EncryptionOpts
QueryResult { rows_affected: u64, last_insert_id: i64 }

// wrapper.rs — turso crate types used
turso::Builder::new_local(&path)   // create builder
    .experimental_index_method(true)  // enable FTS/vector
    .with_encryption(opts)            // AES-256-CBC
    .build().await → Database
Database::connect() → Connection
Connection::execute(sql, params) → u64 (rows affected)
Connection::query(sql, params) → Rows (iterate with .next().await)
Connection::last_insert_rowid() → i64
Vec<turso::Value> implements IntoParams (sealed trait)
turso::Value { Null, Integer(i64), Real(f64), Text(String), Blob(Vec<u8>) }
```

## EXPERIMENTAL FEATURES

`LoadOptions.experimental` accepts feature strings mapped in `wrapper.rs:34`:

| String                 | Builder method                           | Purpose                        |
| ---------------------- | ---------------------------------------- | ------------------------------ |
| `"index_method"`       | `.experimental_index_method(true)`       | FTS (Tantivy) + vector search  |
| `"encryption"`         | `.experimental_encryption(true)`         | Database encryption            |
| `"triggers"`           | `.experimental_triggers(true)`           | SQL triggers                   |
| `"attach"`             | `.experimental_attach(true)`             | ATTACH DATABASE                |
| `"custom_types"`       | `.experimental_custom_types(true)`       | Custom column types            |
| `"materialized_views"` | `.experimental_materialized_views(true)` | Materialized views             |

FTS requires both `experimental: ["index_method"]` at load time AND the `turso_core` crate compiled with `features = ["fts"]` (which pulls in Tantivy).

## CONVENTIONS

**Rust:**
- Errors use `thiserror` and must impl `Serialize` for Tauri IPC
- Release mutex locks before awaiting — clone `Arc<DbConnection>` inside block, then use outside
- Path resolution: strip `sqlite:` prefix, normalize `..`, reject paths escaping `base_path`
- Feature-gate encryption with `#[cfg(feature = "encryption")]`
- `batch()` uses explicit `BEGIN`/`COMMIT`/`ROLLBACK` (not `execute_batch`)

**TypeScript:**
- All IPC calls use `invoke<T>("plugin:turso|command", args)`
- Drizzle proxy transforms `IndexMap` rows (column-order preserved) to array-per-row format
- Migrations bundled at build time via Vite `import.meta.glob` (no runtime fs access)

## PERMISSIONS

Default permissions in `permissions/default.toml`:
`allow-load`, `allow-execute`, `allow-batch`, `allow-select`, `allow-close`, `allow-get-config`

Capabilities reference the plugin as `turso:default`.

## CARGO DEPENDENCIES

- `turso = "0.5.0"` (default-features = false) — main SDK
- `turso_core = "0.5.0"` (features = ["fts"]) — enables Tantivy FTS via Cargo feature unification

## STARTUP SEQUENCE

```typescript
import { Database, migrate, createDrizzleProxy } from 'tauri-plugin-turso';

const db = await Database.load('sqlite:app.db');
await migrate('sqlite:app.db', migrations);  // BEFORE any queries
const drizzleDb = drizzle(createDrizzleProxy('sqlite:app.db'), { schema });
```

## ANTI-PATTERNS

- **DON'T** use `drizzle-orm/sqlite-proxy/migrator` — it reads filesystem at runtime (WebView has no fs)
- **DON'T** query before `migrate()` — causes "no such table" errors
- **DON'T** hold mutex lock across `.await` — clone Arc first, release lock, then await
- **DON'T** pass encryption keys from frontend if avoidable — use plugin-level `Config` instead
- **DON'T** use `turso::Params` directly — use `Vec<turso::Value>` which implements `IntoParams`

# Tauri Plugin turso

A Tauri plugin for [turso](https://github.com/tursodatabase/turso) with built-in AES-256-CBC encryption, Drizzle ORM support, and a browser-compatible migration runner.

## Try the Example App

The fastest way to understand the full workflow (Drizzle ORM, browser-safe migrations, optional encryption, and Turso sync) is to run the demo app.

![Todo List Demo App](examples/todo-list/todo-list.png)

```bash
# build js plugin API package first
pnpm install
pnpm build

# run the example app
cd examples/todo-list
pnpm install
pnpm run tauri dev
```

For a complete walkthrough, see [`examples/todo-list/README.md`](examples/todo-list/README.md).

---

## Table of Contents

- [Try the Example App](#try-the-example-app)
- [Why this plugin?](#why-this-plugin)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Database Location](#database-location)
- [Drizzle ORM Integration](#drizzle-orm-integration)
- [Migrations](#migrations)
- [Encryption](#encryption)
- [API Reference](#api-reference)
- [Permissions](#permissions)
- [Comparison with @tauri-apps/plugin-sql](#comparison-with-tauri-appsplugin-sql)
- [Turso / Remote Database](#turso--remote-database)
- [Bundle Size](#bundle-size)
- [Using AI to Integrate This Plugin](#using-ai-to-integrate-this-plugin)
- [Project Structure](#project-structure)

## Why this plugin?

### 1. Rust ORMs are painful for app development

Using raw SQL in Rust is verbose, and Rust ORMs (Diesel, SeaORM) require schema definitions in Rust, don't compose well with TypeScript frontends, and add significant build complexity. For Tauri apps where the real logic lives in TypeScript, you want to write database code in TypeScript too.

### 2. Drizzle ORM without a Node.js runtime

Drizzle ORM is excellent — type-safe queries, a clean migration system, great ergonomics. But it normally requires a Node.js or Bun runtime to open database files directly. Tauri's WebView has no such runtime.

This plugin solves that with Drizzle's [sqlite-proxy](https://orm.drizzle.team/docs/get-started-sqlite#http-proxy) pattern: Drizzle generates SQL, the proxy sends it via Tauri's `invoke()` to the Rust plugin, and the Rust plugin executes it with turso. Your TypeScript code uses full Drizzle ORM with zero Node.js dependency.

### 3. Migrations that work inside a WebView

Drizzle's built-in migrator reads `.sql` files from disk at runtime using Node's `fs` module — which doesn't exist in a browser/WebView context. Two workarounds exist:

- **Tauri resource folder** — bundle files as app resources and read them via Tauri's asset protocol. Works but requires extra Tauri config.
- **Vite `import.meta.glob`** _(this plugin's approach)_ — Vite bundles the SQL file contents directly into the JavaScript at build time. No runtime filesystem access needed, no extra config.

```typescript
// Vite resolves these at build time — the SQL text is inlined into the JS bundle
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

await migrate("sqlite:myapp.db", migrations);
```

The `migrate()` function in this plugin receives the pre-loaded SQL strings, tracks applied migrations in a `__drizzle_migrations` table, and runs pending ones in order.

### 4. Encryption built in

`@tauri-apps/plugin-sql` (which uses sqlx) has no encryption support. This plugin uses turso's native AES-256-CBC encryption with no extra native libraries or FFI wrappers required.

---

## Features

- **Full SQLite compatibility** via turso
- **Native encryption** — AES-256-CBC, configured once at the plugin level or per-database
- **Drizzle ORM integration** — sqlite-proxy pattern with `createDrizzleProxy`
- **Migration runner** — browser-safe `migrate()` that bundles SQL files at build time via Vite
- **API compatible** with `@tauri-apps/plugin-sql` where applicable
- **Cross-platform**: macOS, Windows, Linux, iOS, Android
  **Tested on**
  - [x] MacOS
  - [x] Windows
  - [x] Linux
  - [ ] iOS
  - [ ] Android

---

## Installation

### Rust

```toml
[dependencies]
tauri-plugin-turso = "0.1.0"
```

### JavaScript / TypeScript

```bash
npm install tauri-plugin-turso-api
# or
pnpm add tauri-plugin-turso-api
```

---

## Quick Start

### 1. Register the plugin (Rust)

```rust
// src-tauri/src/lib.rs

// Default: databases resolve relative to current working directory
tauri::Builder::default()
    .plugin(tauri_plugin_turso::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

To store databases in a fixed location:

```rust
use std::path::PathBuf;

let config = tauri_plugin_turso::Config {
    base_path: Some(PathBuf::from("/path/to/data")),
    encryption: None,
};

tauri::Builder::default()
    .plugin(tauri_plugin_turso::init_with_config(config))
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

### 2. Use the Database class (TypeScript)

```typescript
import { Database } from "tauri-plugin-turso-api";

const db = await Database.load("sqlite:myapp.db");

await db.execute("INSERT INTO users (name) VALUES ($1)", ["Alice"]);

const users = await db.select<{ id: number; name: string }[]>(
  "SELECT * FROM users",
);

await db.close();
```

---

## Database Location

Relative paths (e.g. `sqlite:myapp.db`) resolve against `base_path`:

- **Default**: `std::env::current_dir()` — the directory you launch the Tauri process from
- **Custom**: set `base_path` in the plugin config (see above)
- **Absolute paths** are used as-is
- **In-memory**: `sqlite::memory:`

Relative paths are normalised (`..` components are folded) and must remain within `base_path`. A path that would escape it (e.g. `sqlite:../../secret`) is rejected with an error.

---

## Drizzle ORM Integration

### Setup

```typescript
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createDrizzleProxy } from "tauri-plugin-turso-api";
import * as schema from "./schema";

const db = drizzle(createDrizzleProxy("sqlite:myapp.db"), { schema });

const users = await db.select().from(schema.users);
```

`createDrizzleProxy` lazily loads the database connection on first use, so you don't need to call `Database.load()` separately when using it.

### With Encryption

```typescript
import { createDrizzleProxyWithEncryption } from "tauri-plugin-turso-api";

const db = drizzle(
  createDrizzleProxyWithEncryption({
    path: "sqlite:encrypted.db",
    encryption: {
      cipher: "aes256cbc",
      key: myKey32Bytes, // number[] | Uint8Array, 32 bytes
    },
  }),
  { schema },
);
```

---

## Migrations

The standard `drizzle-orm/sqlite-proxy/migrator` reads from the filesystem at runtime, which doesn't work inside a Tauri WebView. This plugin ships a `migrate()` function that instead accepts SQL content pre-bundled by Vite's `import.meta.glob`.

### Workflow

**1. Define your schema** (`src/lib/schema.ts`):

```typescript
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});
```

**2. Configure drizzle-kit** (`drizzle.config.ts`):

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
});
```

**3. Generate migration files**:

```bash
npx drizzle-kit generate
# creates drizzle/0000_init.sql, drizzle/0001_add_column.sql, etc.
```

**4. Run migrations on startup**:

```typescript
import { Database, migrate } from "tauri-plugin-turso-api";

// Vite bundles these SQL files into the app at build time
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Startup sequence: load → migrate → query
await Database.load("sqlite:myapp.db");
await migrate("sqlite:myapp.db", migrations);

// Now safe to query
const db = drizzle(createDrizzleProxy("sqlite:myapp.db"), { schema });
```

### How `migrate()` works

- Creates a `__drizzle_migrations` tracking table if it doesn't exist
- Parses migration filenames by their numeric prefix (`0000_`, `0001_`, etc.)
- Applies only pending migrations in order
- Records each applied migration by filename

### Adding schema changes

```bash
# 1. Edit src/lib/schema.ts
# 2. Generate new migration
npx drizzle-kit generate
# 3. New migration runs automatically on next app launch
```

### Options

```typescript
await migrate("sqlite:myapp.db", migrations, {
  migrationsTable: "__my_migrations", // default: '__drizzle_migrations'
});
```

---

## Encryption

### Plugin-level encryption (applies to all databases)

Configure once in Rust — the frontend never handles the key:

```rust
let config = tauri_plugin_turso::Config {
    base_path: None,
    encryption: Some(tauri_plugin_turso::EncryptionConfig {
        cipher: tauri_plugin_turso::Cipher::Aes256Cbc,
        key: my_32_byte_key, // Vec<u8>, exactly 32 bytes
    }),
};
```

### Per-database encryption (from the frontend)

```typescript
const key = new Uint8Array(32);
crypto.getRandomValues(key);

const db = await Database.load({
  path: "sqlite:secrets.db",
  encryption: {
    cipher: "aes256cbc",
    key: Array.from(key), // number[] or Uint8Array
  },
});
```

**Security notes:**

- AES-256-CBC requires exactly 32 bytes
- Store keys in the OS keychain or secure storage — lost key = lost data
- Plugin-level encryption is preferred; it keeps keys out of JavaScript

---

## API Reference

### `Database.load(pathOrOptions)`

```typescript
// Simple
const db = await Database.load("sqlite:myapp.db");

// With encryption
const db = await Database.load({
  path: "sqlite:myapp.db",
  encryption: { cipher: "aes256cbc", key: myKey },
});
```

### `db.execute(query, values?)`

```typescript
const result = await db.execute("INSERT INTO todos (title) VALUES ($1)", [
  "Buy milk",
]);
// result.rowsAffected, result.lastInsertId
```

### `db.select<T>(query, values?)`

```typescript
const rows = await db.select<{ id: number; title: string }[]>(
  "SELECT * FROM todos WHERE completed = $1",
  [0],
);
```

### `db.batch(queries)`

Executes multiple SQL statements atomically in a single transaction. Use for DDL or bulk DML. Statements must not use bound parameters (`$1` placeholders) — use `execute()` for parameterised queries.

```typescript
await db.batch([
  "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  "CREATE INDEX idx_users_name ON users(name)",
]);
```

### `db.sync()`

Pulls the latest changes from the Turso remote into the local replica. No-op for local-only databases (returns without error). Requires the `replication` feature.

```typescript
await db.sync();
```

### `db.close()`

```typescript
await db.close();
```

### `migrate(dbPath, migrationFiles, options?)`

```typescript
import { migrate } from "tauri-plugin-turso-api";

const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

await migrate("sqlite:myapp.db", migrations);
```

### `createDrizzleProxy(dbPath)`

Returns a sqlite-proxy callback for use with `drizzle()`. Lazy-loads the connection.

### `createDrizzleProxyWithEncryption(options)`

Same as above but with encryption config.

### `getConfig()`

```typescript
import { getConfig } from "tauri-plugin-turso-api";

const { encrypted } = await getConfig();
```

---

## Permissions

Add to your `tauri.conf.json`:

```json
{
  "plugins": {
    "turso": {}
  }
}
```

Or configure granular capabilities:

```json
{
  "identifier": "turso:default",
  "permissions": [
    "turso:allow-load",
    "turso:allow-batch",
    "turso:allow-execute",
    "turso:allow-select",
    "turso:allow-close"
  ]
}
```

---

## Comparison with @tauri-apps/plugin-sql

| Feature            | tauri-plugin-turso     | @tauri-apps/plugin-sql |
| ------------------ | ----------------------- | ---------------------- |
| SQLite             | ✅ turso               | ✅ sqlx                |
| Encryption         | ✅ AES-256-CBC built-in | ❌                     |
| Drizzle ORM        | ✅                      | ✅                     |
| Migration runner   | ✅ browser-safe         | ❌                     |
| MySQL / PostgreSQL | ❌                      | ✅                     |
| API compatibility  | Partial                 | Full                   |

---

## Turso / Remote Database

The plugin supports two remote connection modes powered by turso.

### Embedded Replica

A local SQLite file stays in sync with a Turso cloud database. Queries read from the local file (fast, offline-capable), writes sync to the remote.

> ⚠️ **Limitation: Embedded replica encryption is currently broken on `main`**
> Due to an upstream turso bug, local encryption is **silently disabled** when using embedded replicas (`syncUrl`). The V2 sync protocol (which Turso always uses) switches to a code path that drops the `encryption_config`, leaving the local replica file **unencrypted** even if you pass an `encryption` config. See [Issue #1](https://github.com/HuakunShen/tauri-plugin-turso/issues/1) for details.
>
> **Fix available on [`fix/sync-encryption`](../../tree/fix/sync-encryption) branch:**
> That branch vendors a [fork of turso](https://github.com/HuakunShen/turso) that threads `encryption_config` through the V2 sync path and encrypts the bootstrapped replica via `sqlite3_rekey`. It works but cannot be published to crates.io (path dependencies are not allowed). Use it via git:
>
> ```toml
> tauri-plugin-turso = { git = "https://github.com/HuakunShen/tauri-plugin-turso", branch = "fix/sync-encryption", features = ["replication", "encryption"] }
> ```
>
> **Workarounds (on `main`):**
>
> - Use the **`fix/sync-encryption` branch** (recommended if you need encrypted replicas)
> - Use **pure remote mode** (no local file) if you don't need offline access
> - Use **local-only databases** with encryption for sensitive local data
> - Accept the unencrypted replica (Turso access control still protects the remote data)

**1. Enable the `replication` feature** in your app's `Cargo.toml`:

```toml
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }
```

**2. Load with `syncUrl` and `authToken`:**

```typescript
import { Database, migrate } from "tauri-plugin-turso-api";

const db = await Database.load({
  path: "sqlite:local.db", // local replica file
  syncUrl: "turso://mydb-org.turso.io",
  authToken: "your-turso-auth-token",
});

// Sync on demand (e.g. on app resume / network reconnect)
await db.sync();
```

On `Database.load()`, an initial sync pulls the latest data from Turso into the local file. Subsequent `sync()` calls pull incremental changes.

**With Drizzle ORM:**

```typescript
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

const db = await Database.load({
  path: "sqlite:local.db",
  syncUrl: "turso://mydb-org.turso.io",
  authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN,
});

await migrate(db.path, migrations);

const drizzleDb = drizzle(createDrizzleProxy(db.path), { schema });
```

---

### Pure Remote

All queries execute on Turso directly — no local file. Requires network for every query.

**Enable the `remote` feature:**

```toml
tauri-plugin-turso = { version = "0.1.0", features = ["remote"] }
```

```typescript
const db = await Database.load({
  path: "turso://mydb-org.turso.io",
  authToken: "your-turso-auth-token",
});
```

For most Tauri apps, **embedded replica is the better choice** — it works offline and is significantly faster for reads.

> **Note on `batch()` with embedded replicas**: turso's `execute_batch()` does not correctly route writes through the embedded replica layer in some versions. The plugin uses individual `execute()` calls inside an explicit `BEGIN`/`COMMIT` transaction to avoid this.

> **Note on URL validation**: turso's builder calls `unwrap()` internally on the sync URL and can panic on a malformed value (e.g. leading/trailing whitespace, wrong scheme). The plugin wraps this in `catch_unwind` so a bad URL surfaces as a proper error instead of hanging the IPC indefinitely.

---

## Bundle Size

Based on the included Todo List demo app (macOS, aarch64, release build):

| Format           | With encryption | Without encryption |
| ---------------- | --------------- | ------------------ |
| `.app` bundle    | 15 MB           | 15 MB              |
| `.dmg` installer | 6.0 MB          | 5.9 MB             |

Disabling encryption saves essentially nothing — the AES cipher code is negligible compared to the SQLite native library that's always present. The `encryption` feature flag still exists to avoid compiling encryption-related code if you want to enforce at compile time that no database can be encrypted.

### Disabling encryption

Encryption is a default feature. To opt out, disable default features and select only what you need:

**`Cargo.toml`** (in your Tauri app):

```toml
tauri-plugin-turso = { version = "0.1.0", default-features = false, features = ["core"] }
```

**Available features:**

| Feature       | Default | Description                                  |
| ------------- | ------- | -------------------------------------------- |
| `core`        | ✅      | Local SQLite databases (always required)     |
| `encryption`  | ✅      | AES-256-CBC encryption via turso            |
| `replication` | ❌      | turso replication support (adds TLS)        |
| `remote`      | ❌      | Remote database support (planned, see below) |

When `encryption` is disabled, passing an `EncryptionConfig` to `Database.load()` returns an error at runtime. The TypeScript API surface is unchanged — no rebuild of your JS code needed.

---

## Using AI to Integrate This Plugin

A `SKILL.md` file is included at the root of this repository. It contains structured context about the plugin's architecture, startup sequence, migration workflow, encryption patterns, and common errors — written for AI coding assistants (Claude Code, Cursor, Copilot, etc.).

### With Claude Code

Copy `SKILL.md` into your project's `.claude/skills/tauri-plugin-turso/` directory:

```bash
mkdir -p .claude/skills/tauri-plugin-turso
cp /path/to/tauri-plugin-turso/SKILL.md .claude/skills/tauri-plugin-turso/
```

Claude Code discovers skills automatically. Once copied, you can prompt naturally:

> "Add a `notes` table to my Tauri app using tauri-plugin-turso. Include the schema, migration, and startup sequence."

Claude will apply the correct startup order, use `import.meta.glob` for migrations, and handle the drizzle proxy pattern without extra guidance.

### With other AI tools

Paste the contents of `SKILL.md` directly into your system prompt or context window, then describe what you want to build. The skill covers enough context for the AI to generate correct, working code on the first attempt.

---

## Project Structure

```
tauri-plugin-turso/
├── src/                    # Rust plugin
│   ├── lib.rs              # Plugin init, command registration
│   ├── commands.rs         # load, execute, select, close, ping
│   ├── wrapper.rs          # DbConnection around turso
│   ├── decode.rs           # turso::Value → serde_json::Value
│   ├── models.rs           # Cipher, EncryptionConfig, QueryResult
│   ├── error.rs            # Error types
│   ├── desktop.rs          # Desktop config & base_path
│   └── mobile.rs           # Mobile stub
├── guest-js/               # TypeScript source
│   ├── index.ts            # Database class, getConfig, re-exports
│   ├── drizzle.ts          # createDrizzleProxy, createDrizzleProxyWithEncryption
│   └── migrate.ts          # migrate() — browser-safe migration runner
├── permissions/            # Tauri permission files
├── examples/todo-list/     # Demo: Todo app with Drizzle + migrations (15 MB .app / 6 MB .dmg)
├── SKILL.md                # AI skill context for Claude Code and other assistants
├── build.rs
├── Cargo.toml
└── package.json
```

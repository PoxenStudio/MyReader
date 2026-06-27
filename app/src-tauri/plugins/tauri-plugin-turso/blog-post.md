# Building a Local-First Tauri App with Drizzle ORM, Encryption, and Turso Sync

I've been building desktop apps with [Tauri](https://tauri.app/) for a while now, and one thing that consistently caused friction was the database layer. Tauri's official `@tauri-apps/plugin-sql` gets you SQLite, but it has no encryption support and no Drizzle integration that actually works inside a WebView. So I built my own plugin — `tauri-plugin-turso` — and this post covers why I built it, the design decisions I made, and a few genuinely weird bugs I ran into along the way.

---

## The Problem with Databases in Tauri

Tauri apps run your UI in a WebView. That WebView is essentially a browser — it has no Node.js `fs` module, no native bindings, no ability to open SQLite files directly. All access to the filesystem has to go through Tauri's IPC layer: your TypeScript code calls `invoke()`, and a Rust command handler does the actual work.

The official plugin, `@tauri-apps/plugin-sql`, handles this. It's fine for basic use. But I kept running into three walls:

**1. No encryption.** The plugin uses sqlx under the hood, and sqlx doesn't support SQLite encryption. If you want an encrypted database — say, to protect user data if the device is lost — you're on your own.

**2. Drizzle ORM's migrator doesn't work in a WebView.** I love Drizzle. Type-safe queries, a clean migration workflow, great ergonomics. But Drizzle's built-in migrator calls `readMigrationFiles()`, which uses Node's `fs` module at runtime. That API doesn't exist in a WebView. You hit a wall immediately when you try to use `drizzle-kit migrate` in a Tauri app.

**3. No Turso support.** I wanted to build local-first apps — data lives on disk, works offline, but syncs to a cloud database when connected. Turso's embedded replica mode does exactly this, but `@tauri-apps/plugin-sql` has no concept of it.

---

## Why turso

[turso](https://github.com/tursodatabase/turso) is Turso's fork of SQLite. For the purposes of a Tauri plugin, it offers three things the standard sqlite3 crate doesn't:

- **Native encryption** via the `encryption` feature flag — AES-256-CBC, no extra native libraries
- **Embedded replica mode** — local SQLite file that syncs bidirectionally with Turso cloud
- **A clean async Rust API** with a builder pattern that makes the three modes (local, replica, remote) easy to configure

The Rust API looks like this:

```rust
// Local only
let db = Builder::new_local("myapp.db").build().await?;

// Embedded replica (local file + Turso sync)
let db = Builder::new_remote_replica("local.db", "turso://mydb.turso.io", "token")
    .build().await?;

// Initial sync on connect
db.sync().await?;
```

---

## Making Drizzle Work in a WebView

Drizzle has a lesser-known driver called [sqlite-proxy](https://orm.drizzle.team/docs/get-started-sqlite#http-proxy). Instead of opening a database file directly, you give Drizzle a callback function. Drizzle generates SQL queries, calls your function with them, and you return the results. It was designed for HTTP-based SQLite proxies, but it works perfectly for Tauri's `invoke()` pattern.

```typescript
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { invoke } from "@tauri-apps/api/core";

const proxy = async (sql: string, params: unknown[], method: string) => {
  if (method === "run") {
    const result = await invoke("plugin:turso|execute", { db: path, query: sql, values: params });
    return { rows: [] };
  }
  const rows = await invoke("plugin:turso|select", { db: path, query: sql, values: params });
  return { rows: rows.map(Object.values) };
};

const db = drizzle(proxy, { schema });
```

The plugin exports `createDrizzleProxy(path)` which wraps this pattern. You get full Drizzle — type-safe queries, joins, transactions, all of it — running against a local SQLite file via Rust, inside a Tauri WebView.

---

## Solving the Migration Problem

Once Drizzle works, you want migrations. The standard `drizzle-kit migrate` reads `.sql` files from disk at runtime. In a WebView: no filesystem, no `fs`, dead end.

The solution is Vite's `import.meta.glob`. Instead of reading files at runtime, Vite inlines the SQL file contents directly into the JavaScript bundle at build time:

```typescript
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",      // import as raw string
  import: "default",
});
```

This gives you an object like `{ "./drizzle/0000_init.sql": "CREATE TABLE ...", ... }`. You pass it to `migrate()`, which tracks applied migrations in a `__drizzle_migrations` table and runs pending ones in order:

```typescript
await Database.load("sqlite:myapp.db");
await migrate("sqlite:myapp.db", migrations);

// Now safe to use Drizzle
const db = drizzle(createDrizzleProxy("sqlite:myapp.db"), { schema });
```

The order matters. Querying before `migrate()` runs gives you "no such table" errors.

---

## Encryption

The plugin supports two modes:

**Plugin-level encryption** — configured once in Rust, applies to all databases. The key never touches JavaScript:

```rust
let config = tauri_plugin_turso::Config {
    base_path: Some(cwd),
    encryption: Some(EncryptionConfig {
        cipher: Cipher::Aes256Cbc,
        key: std::env::var("DB_KEY")
            .map(|k| k.into_bytes())
            .unwrap_or_default(),
    }),
};

tauri::Builder::default()
    .plugin(tauri_plugin_turso::init_with_config(config))
```

**Per-database encryption** — key passed from the frontend:

```typescript
const db = await Database.load({
  path: "sqlite:secrets.db",
  encryption: {
    cipher: "aes256cbc",
    key: Array.from(myUint8Key32Bytes),
  },
});
```

Plugin-level is the better choice for most apps — it keeps the key in Rust where JavaScript can't inspect it.

---

## Turso Embedded Replica

This is where things get interesting. Turso's embedded replica mode maintains a local SQLite file that stays in sync with a Turso cloud database. Reads come from the local file (fast, offline-capable). Writes go to the remote. You pull the latest changes manually with `sync()`.

For a Tauri app, this is the ideal architecture. Your app works offline by default. When the user is connected, you sync on launch and on demand.

```typescript
const db = await Database.load({
  path: "sqlite:local.db",
  syncUrl: "turso://mydb-org.turso.io",
  authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN,
});

// migrations run against the local replica
await migrate(db.path, migrations);

// pull latest remote changes
await db.sync();
```

`Database.load()` does an initial sync automatically on connect. Subsequent `db.sync()` calls pull incremental changes.

---

## The Weird Bugs

Building this plugin involved a few bugs that were interesting enough to be worth writing up.

### Bug 1: The IPC That Never Responded

After adding Turso support, I noticed that connecting with a badly-formatted URL caused the app to hang indefinitely on the loading spinner. The Rust terminal showed a panic:

```
thread 'tokio-runtime-worker' panicked at turso-0.9.29/src/database/builder.rs:409:66:
called `Result::unwrap()` on an `Err` value: http::Error(InvalidUri(InvalidFormat))
```

turso's builder calls `unwrap()` internally when parsing the sync URL. This isn't a bug in the user's code — it's turso panicking on an `Err` it should have returned. In Tauri, a panic inside an async command handler causes the IPC response to never be sent. The JavaScript `await` hangs forever. There's no timeout, no rejection — just silence.

The fix is `catch_unwind` from the `futures` crate:

```rust
use futures::FutureExt;
use std::panic::AssertUnwindSafe;

let db = AssertUnwindSafe(async move {
    // ... turso builder calls ...
})
.catch_unwind()
.await
.map_err(|_| Error::InvalidDbUrl(
    "turso panicked — check your URL format".into()
))??;
```

The double `??` unwraps the panic result first (converted to `Error`), then the inner `Result<Database, Error>`. Now a bad URL gives a real error message instead of hanging.

### Bug 2: `execute_batch` Silently Failing with Embedded Replicas

The migration runner originally used `execute_batch()` from turso to run multiple SQL statements atomically. This worked fine for local databases. With an embedded replica, migrations appeared to succeed — no errors — but the tables didn't actually get created. The Drizzle migrations table would record the migration as applied, then the next query would fail with "no such table".

After a lot of debugging, it turned out that `execute_batch()` doesn't correctly route writes through the embedded replica's write path in turso 0.9.x. Individual `execute()` calls inside an explicit `BEGIN`/`COMMIT` do work:

```rust
pub async fn batch(&self, queries: Vec<String>) -> Result<(), Error> {
    self.conn.execute("BEGIN", Params::None).await?;
    for query in &queries {
        if let Err(e) = self.conn.execute(query.as_str(), Params::None).await {
            let _ = self.conn.execute("ROLLBACK", Params::None).await;
            return Err(Error::Turso(e));
        }
    }
    if let Err(e) = self.conn.execute("COMMIT", Params::None).await {
        let _ = self.conn.execute("ROLLBACK", Params::None).await;
        return Err(Error::Turso(e));
    }
    Ok(())
}
```

Tedious, but it works reliably.

### Bug 3: The `$state` That Wasn't

This one was a Svelte 5 mistake in the demo app. I had `let dbInstance: Database | null = null` — a plain mutable variable, not a `$state`. The code that checked `{#if dbInstance}` in the template to show the "Reset DB" button was therefore non-reactive. Setting `dbInstance` in `onMount` had no effect on the template.

```svelte
<!-- Before: dbInstance not reactive, button never shows -->
let dbInstance: Database | null = null;

<!-- After: reactive, button appears when DB is loaded -->
let dbInstance = $state<Database | null>(null);
```

Svelte 5 doesn't warn about this in all cases — if the variable is set in `onMount` and never re-assigned elsewhere, you might not get a warning. The template just silently doesn't update.

### Bug 4: Error State That Ate the Form

The CRUD error handling set `error = "Failed to add: ..."` on failures. The template used `{:else if error}` to show an error alert — which meant any failed add/toggle/delete replaced the entire todo form with the alert. The user had to refresh to get the form back.

The fix was to stop mixing fatal errors (load failure — should block the UI) with transient errors (write failure — should be a notification). Toast notifications handle the transient case; `error` state is now only set on fatal load failures.

---

## The Demo App

The plugin ships with a two-panel demo that makes the local vs. remote difference tangible:

- **Left panel**: Local SQLite. Writes are instant.
- **Right panel**: Turso embedded replica. Enter your `syncUrl` and auth token, click Connect. Writes go to Turso — you can watch the latency.

Both panels share the same `TodoList.svelte` component. The difference is just which props are passed:

```svelte
<!-- Local: instant writes -->
<TodoList dbFile="todos.db" position="bottom-left" />

<!-- Turso: network-latency writes -->
<TodoList
  dbFile="todos-turso.db"
  syncUrl={appliedSyncUrl}
  authToken={appliedAuthToken}
  position="bottom-right"
  onDisconnect={handleDisconnect}
/>
```

The `position` prop routes sonner toasts to different corners so you can see which panel's events are which.

---

## Installation

If you want to try it:

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-turso = "0.1.0"

# For Turso sync:
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }
```

```bash
npm install tauri-plugin-turso-api
```

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_turso::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

The source is on GitHub. Contributions welcome, especially testing on Windows and Linux.

---

## What's Next

A few things I'd like to add:

- **Auto-sync on network reconnect** — Tauri has network status events; `db.sync()` could fire automatically
- **Conflict visibility** — embedded replica is last-write-wins with no conflict UI
- **iOS/Android testing** — the mobile stubs exist but haven't been verified

If you're building a Tauri app and have hit the same walls with the official SQL plugin, give it a try.

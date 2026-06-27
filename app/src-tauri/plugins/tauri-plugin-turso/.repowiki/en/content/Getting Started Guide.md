# Getting Started Guide

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [Cargo.toml](file://Cargo.toml)
- [package.json](file://package.json)
- [examples/todo-list/](file://examples/todo-list/)
- [SKILL.md](file://SKILL.md)
</cite>

## Table of Contents

1. [Installation](#installation)
2. [Basic Usage](#basic-usage)
3. [Drizzle ORM Setup](#drizzle-orm-setup)
4. [Migration Workflow](#migration-workflow)
5. [Encryption Setup](#encryption-setup)
6. [Turso Sync Setup](#turso-sync-setup)

## Installation

### Rust Dependency

Add to your Tauri app's `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-turso = "0.1.0"
```

For specific features:

```toml
# With replication support (Turso embedded replica)
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }

# Without encryption (default has encryption)
tauri-plugin-turso = { version = "0.1.0", default-features = false, features = ["core"] }

# With all features
tauri-plugin-turso = { version = "0.1.0", features = ["core", "encryption", "replication", "remote"] }
```

**Section sources**

- [Cargo.toml](file://Cargo.toml#L26-L31)
- [README.md](file://README.md#L66-L76)

### JavaScript Dependency

```bash
npm install tauri-plugin-turso-api
# or
pnpm add tauri-plugin-turso-api
# or
yarn add tauri-plugin-turso-api
```

**Section sources**

- [README.md](file://README.md#L78-L84)

### Tauri Configuration

Add the plugin to your `tauri.conf.json`:

```json
{
  "plugins": {
    "turso": {}
  }
}
```

Or configure granular permissions in a capability file:

```json
{
  "identifier": "turso:default",
  "permissions": [
    "turso:allow-load",
    "turso:allow-batch",
    "turso:allow-execute",
    "turso:allow-select",
    "turso:allow-close",
    "turso:allow-sync"
  ]
}
```

**Section sources**

- [README.md](file://README.md#L280-L295)
- [permissions/default.toml](file://permissions/default.toml)

## Basic Usage

### Rust Setup

Initialize the plugin in your Tauri app's main library:

```rust
// src-tauri/src/lib.rs
use tauri_plugin_turso::Config;
use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_turso::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

With custom configuration:

```rust
pub fn run() {
    let cwd = std::env::current_dir().expect("failed to get cwd");
    
    let config = Config {
        base_path: Some(cwd),
        encryption: None,
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_turso::init_with_config(config))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Section sources**

- [README.md](file://README.md#L86-L112)

### TypeScript Usage

```typescript
import { Database } from "tauri-plugin-turso-api";

// Load database
const db = await Database.load("sqlite:myapp.db");

// Execute a query
await db.execute(
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)"
);

// Insert data
const result = await db.execute(
  "INSERT INTO users (name) VALUES ($1)",
  ["Alice"]
);
console.log(`Inserted user with ID: ${result.lastInsertId}`);

// Select data
const users = await db.select<Array<{ id: number; name: string }>>(
  "SELECT * FROM users WHERE name = $1",
  ["Alice"]
);

// Batch operations
await db.batch([
  "CREATE INDEX idx_name ON users(name)",
  "INSERT INTO users (name) VALUES ('Bob')",
  "INSERT INTO users (name) VALUES ('Charlie')",
]);

// Close when done
await db.close();
```

**Section sources**

- [README.md](file://README.md#L114-L132)

## Drizzle ORM Setup

### 1. Install Drizzle

```bash
npm install drizzle-orm
npm install -D drizzle-kit
```

### 2. Define Schema

```typescript
// src/lib/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

**Section sources**

- [README.md](file://README.md#L150-L169)

### 3. Configure Drizzle Kit

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
});
```

**Section sources**

- [README.md](file://README.md#L171-L180)

### 4. Setup Database Connection

```typescript
// src/lib/db.ts
import { Database, migrate, createDrizzleProxy } from "tauri-plugin-turso-api";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

// Bundle migrations
const migrations = import.meta.glob<string>("../../drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

const dbPath = "sqlite:app.db";

// Initialize function to be called on app startup
export async function initializeDb() {
  // 1. Load database
  await Database.load(dbPath);
  
  // 2. Run migrations
  await migrate(dbPath, migrations);
  
  // 3. Create Drizzle instance
  const db = drizzle(createDrizzleProxy(dbPath), { schema });
  
  return db;
}
```

**Section sources**

- [README.md](file://README.md#L196-L220)

### 5. Use in Application

```typescript
// src/App.svelte (or your framework)
import { initializeDb } from "./lib/db";
import { users } from "./lib/schema";

let db;

onMount(async () => {
  db = await initializeDb();
  
  // Now you can use Drizzle with full type safety
  const allUsers = await db.select().from(users);
  
  await db.insert(users).values({
    name: "Alice",
    email: "alice@example.com",
  });
});
```

**Section sources**

- [SKILL.md](file://SKILL.md#L95-L115)

## Migration Workflow

### Generate Migrations

After modifying your schema:

```bash
npx drizzle-kit generate
```

This creates SQL files in the `drizzle/` directory:

```
drizzle/
├── 0000_initial.sql
├── 0001_add_posts_table.sql
└── meta/
    ├── 0000_snapshot.json
    └── _journal.json
```

**Section sources**

- [README.md](file://README.md#L221-L232)

### Commit Migrations

Always commit migration files to version control:

```bash
git add drizzle/
git commit -m "feat: add posts table migration"
```

### Apply Migrations

Migrations are applied automatically on app startup via the `migrate()` function:

```typescript
await Database.load(dbPath);
await migrate(dbPath, migrations); // Applies any pending migrations
```

The migration system:
1. Creates `__drizzle_migrations` table if not exists
2. Checks which migrations have already been applied
3. Runs pending migrations in order
4. Records each applied migration

**Section sources**

- [guest-js/migrate.ts](file://guest-js/migrate.ts)

## Encryption Setup

### Plugin-Level Encryption (Recommended)

Configure encryption once in Rust:

```rust
use tauri_plugin_turso::{Config, EncryptionConfig, Cipher};

pub fn run() {
    // Get key from environment (32 bytes for AES-256)
    let key = std::env::var("LIBSQL_ENCRYPTION_KEY")
        .expect("LIBSQL_ENCRYPTION_KEY not set")
        .into_bytes();
    
    // Ensure exactly 32 bytes
    let mut key_bytes = vec![0u8; 32];
    key_bytes[..key.len().min(32)].copy_from_slice(&key[..key.len().min(32)]
    );
    
    let config = Config {
        base_path: Some(std::env::current_dir().unwrap()),
        encryption: Some(EncryptionConfig {
            cipher: Cipher::Aes256Cbc,
            key: key_bytes,
        }),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_turso::init_with_config(config))
        // ...
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Benefits:
- Key never leaves Rust process
- Frontend has no access to encryption key
- More secure for production applications

**Section sources**

- [README.md](file://README.md#L240-L261)

### Per-Database Encryption

For user-provided keys:

```typescript
import { Database, createDrizzleProxyWithEncryption } from "tauri-plugin-turso-api";

// Generate or get 32-byte key
const key = new Uint8Array(32);
crypto.getRandomValues(key);

// Load encrypted database
const db = await Database.load({
  path: "sqlite:secrets.db",
  encryption: {
    cipher: "aes256cbc",
    key: Array.from(key), // Convert to number[]
  },
});

// Or with Drizzle
const proxy = createDrizzleProxyWithEncryption({
  path: "sqlite:secrets.db",
  encryption: {
    cipher: "aes256cbc",
    key: Array.from(key),
  },
});
```

**Important**:
- Key must be exactly 32 bytes for AES-256-CBC
- Store key securely (OS keychain, secure storage)
- Lost key = lost data (no recovery possible)

**Section sources**

- [README.md](file://README.md#L262-L285)

## Turso Sync Setup

### Enable Replication Feature

Add to your app's `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }
```

**Section sources**

- [Cargo.toml](file://Cargo.toml#L30)
- [README.md](file://README.md#L310-L318)

### Configure Connection

```typescript
import { Database, migrate, createDrizzleProxy } from "tauri-plugin-turso-api";

const db = await Database.load({
  path: "sqlite:local.db",                    // Local replica file
  syncUrl: "turso://mydb-org.turso.io",     // Turso database URL
  authToken: process.env.VITE_TURSO_AUTH_TOKEN, // Auth token
});

// Run migrations on local replica
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});
await migrate(db.path, migrations);

// Use with Drizzle
const drizzleDb = drizzle(createDrizzleProxy(db.path), { schema });

// Sync manually when needed (e.g., on app resume)
await db.sync();
```

### How It Works

1. **Initial Load**: Downloads full database from Turso to local file
2. **Reads**: Happen locally (fast, works offline)
3. **Writes**: Automatically sync to Turso
4. **Manual Sync**: Call `db.sync()` to pull latest changes from remote

**Best practices**:
- Use separate database files for local-only and replica modes
- Call `db.sync()` periodically or on network reconnect
- Handle sync errors gracefully

**Section sources**

- [README.md](file://README.md#L319-L360)

### Environment Variables

For development, use a `.env` file:

```env
VITE_TURSO_AUTH_TOKEN=your-token-here
```

Access in TypeScript:

```typescript
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;
```

**Section sources**

- [README.md](file://README.md#L335-L347)

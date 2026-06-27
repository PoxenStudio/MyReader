# AGENTS.md — guest-js/

TypeScript frontend API for tauri-plugin-turso.

## STRUCTURE

| File | Purpose | Lines |
|------|---------|-------|
| `index.ts` | `Database` class, `getConfig()` | 233 |
| `drizzle.ts` | `createDrizzleProxy()`, encryption variant | 103 |
| `migrate.ts` | `migrate()` — browser-safe migration runner | 131 |

## WHERE TO LOOK

| Task | File | Pattern |
|------|------|---------|
| Add Database method | `index.ts` | Add to `class Database`, call `invoke("plugin:turso\|cmd")` |
| Modify Drizzle integration | `drizzle.ts` | Proxy callback transforms row format |
| Change migration logic | `migrate.ts` | Parses filenames, sorts by numeric prefix |
| Export new symbol | `index.ts` bottom | `export { X } from "./file"` |

## CONVENTIONS

- **Invoke pattern**: `invoke<T>("plugin:turso|command", { args })`
- **Load options**: `string | { path, encryption?, syncUrl?, authToken? }`
- **Drizzle proxy**: Returns `{ rows: unknown[] }`, transforms `IndexMap` → array-per-row
- **Migrations**: Expects `Record<string, string>` from `import.meta.glob(..., { eager: true, query: '?raw' })`
- **Encryption key**: `number[] | Uint8Array`, exactly 32 bytes for AES-256-CBC

## ANTI-PATTERNS

- **DON'T** use filesystem APIs — Tauri WebView has no `fs` module
- **DON'T** call `drizzle-orm/sqlite-proxy/migrator` — it uses `readMigrationFiles()` which fails in browser
- **DON'T** query before `migrate()` — tables don't exist yet
- **DON'T** modify `loaded` flag in proxy externally — if DB closed, recreate proxy instance

## STARTUP PATTERN

```typescript
import { Database, migrate, createDrizzleProxy } from 'tauri-plugin-turso-api';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

// 1. Bundle migrations at build time
const migrations = import.meta.glob<string>('../drizzle/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// 2. Load → migrate → use
const dbPath = 'sqlite:app.db';
await Database.load(dbPath);
await migrate(dbPath, migrations);
const db = drizzle(createDrizzleProxy(dbPath), { schema });
```

## MIGRATION FILENAME PARSING

```typescript
// Matches: 0000_init.sql, 0001_add_column.sql
const match = path.match(/(\d+)[_\-].*\.sql$/);
const index = parseInt(match[1], 10);
```

Files sorted by numeric prefix before execution.

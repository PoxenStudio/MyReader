# Technology Stack

<cite>
**Referenced Files in This Document**
- [Cargo.toml](file://Cargo.toml)
- [package.json](file://package.json)
- [tsconfig.json](file://tsconfig.json)
- [rollup.config.js](file://rollup.config.js)
- [build.rs](file://build.rs)
</cite>

## Table of Contents

1. [Rust Stack](#rust-stack)
2. [TypeScript Stack](#typescript-stack)
3. [Build Tools](#build-tools)
4. [Development Tools](#development-tools)

## Rust Stack

### Core Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.10.0 | Tauri framework core |
| `turso` | 0.9.29 | SQLite/turso database client |
| `serde` | 1.0 | Serialization/deserialization |
| `serde_json` | 1.0 | JSON serialization |
| `thiserror` | 2.0 | Error handling macros |
| `tokio` | 1.x | Async runtime |
| `futures` | 0.3 | Async utilities |
| `indexmap` | 2.x | Ordered map for query results |
| `bytes` | 1.x | Byte handling for encryption |

**Section sources**

- [Cargo.toml](file://Cargo.toml#L12-L22)

### Build Dependencies

```toml
[build-dependencies]
tauri-plugin = { version = "2.5.3", features = ["build"] }
```

The `tauri-plugin` build dependency provides the plugin build tooling.

**Section sources**

- [Cargo.toml](file://Cargo.toml#L23-L25)

### Feature Flags

| Feature | Default | Dependencies | Description |
|---------|---------|--------------|-------------|
| `core` | ✅ | `turso/core` | Local SQLite databases |
| `encryption` | ✅ | `turso/encryption`, `bytes` | AES-256-CBC encryption |
| `replication` | ❌ | `turso/replication`, `turso/tls` | Turso embedded replica |
| `remote` | ❌ | `turso/remote`, `turso/tls` | Pure remote connections |

**Feature configuration**:

```toml
# Default (core + encryption)
tauri-plugin-turso = "0.1.0"

# With replication
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }

# Without encryption
tauri-plugin-turso = { version = "0.1.0", default-features = false, features = ["core"] }

# All features
tauri-plugin-turso = { version = "0.1.0", features = ["core", "encryption", "replication", "remote"] }
```

**Section sources**

- [Cargo.toml](file://Cargo.toml#L26-L31)

### Rust Version

Minimum supported Rust version: **1.77.2**

```toml
[package]
rust-version = "1.77.2"
edition = "2021"
```

**Section sources**

- [Cargo.toml](file://Cargo.toml#L6-L8)

## TypeScript Stack

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@tauri-apps/api` | ^2.0.0 | Tauri API bindings |

**Section sources**

- [package.json](file://package.json#L30-L32)

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@rollup/plugin-typescript` | ^12.0.0 | Rollup TypeScript plugin |
| `rollup` | ^4.9.6 | Module bundler |
| `tslib` | ^2.6.2 | TypeScript runtime library |
| `typescript` | ^5.3.3 | TypeScript compiler |

**Section sources**

- [package.json](file://package.json#L33-L38)

### Module System

The package uses ES modules with CommonJS compatibility:

```json
{
  "type": "module",
  "main": "./dist-js/index.cjs",
  "module": "./dist-js/index.js",
  "exports": {
    ".": {
      "import": "./dist-js/index.js",
      "require": "./dist-js/index.cjs"
    }
  }
}
```

**Section sources**

- [package.json](file://package.json#L10-L20)

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Section sources**

- [tsconfig.json](file://tsconfig.json)

### Integration Dependencies

While not direct dependencies of the plugin, these are commonly used alongside:

| Package | Purpose |
|---------|---------|
| `drizzle-orm` | ORM for type-safe SQL |
| `drizzle-kit` | Migration generation tool |

**Installation**:

```bash
npm install drizzle-orm
npm install -D drizzle-kit
```

**Section sources**

- [README.md](file://README.md#L150-L158)

## Build Tools

### Rust Build

Standard Cargo build:

```bash
cargo build
cargo build --release
```

Plugin-specific build handled by `build.rs`:

```rust
const COMMANDS: &[&str] = &[
    "load", "execute", "select", "close", 
    "ping", "get_config"
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
```

**Section sources**

- [build.rs](file://build.rs)

### JavaScript Build

Rollup configuration for dual-format output:

```javascript
export default {
  input: "guest-js/index.ts",
  output: [
    { file: "dist-js/index.js", format: "esm" },
    { file: "dist-js/index.cjs", format: "cjs" },
  ],
  plugins: [
    typescript({
      declaration: true,
      declarationDir: "dist-js",
    }),
  ],
  external: [/^@tauri-apps\/api/],
};
```

**Build commands**:

```bash
npm run build     # Runs rollup -c
```

**Section sources**

- [rollup.config.js](file://rollup.config.js)
- [package.json](file://package.json#L26)

## Development Tools

### Recommended IDE Setup

- **Rust**: rust-analyzer extension
- **TypeScript**: VS Code with TypeScript support

### Development Workflow

1. **Rust changes**: Standard `cargo check` / `cargo build`
2. **TypeScript changes**: Run `npm run build` to compile
3. **Testing**: Use the example app in `examples/todo-list/`

### Example App

The `examples/todo-list` directory contains a complete working example:

```bash
cd examples/todo-list
bun install
bun run tauri dev
```

**Section sources**

- [README.md](file://README.md#L450-L470)

### Version Management

| Component | Version | Location |
|-----------|---------|----------|
| Rust Plugin | 0.1.0 | `Cargo.toml` |
| JS Package | 0.1.0 | `package.json` |

Both are kept in sync for releases.

**Section sources**

- [Cargo.toml](file://Cargo.toml#L3)
- [package.json](file://package.json#L3)

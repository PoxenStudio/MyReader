# Tauri turso 插件

一个用于 [turso](https://github.com/tursodatabase/turso) 的 Tauri 插件，内置 AES-256-CBC 加密、Drizzle ORM 支持，以及浏览器兼容的迁移运行器。

## 试用示例应用

理解完整工作流程（Drizzle ORM、浏览器安全迁移、可选加密和 Turso 同步）的最快方式是运行演示应用。

![Todo List 演示应用](examples/todo-list/todo-list.png)

```bash

# 先构建 JS 插件 API 包

pnpm install

pnpm build



# 运行示例应用

cd examples/todo-list

pnpm install

pnpm run tauri dev

```

完整的操作指南，请参见 [`examples/todo-list/README.md`](examples/todo-list/README.md)。

---

## 目录

- [试用示例应用](#试用示例应用)

- [为什么选择这个插件？](#为什么选择这个插件)

- [功能特性](#功能特性)

- [安装](#安装)

- [快速开始](#快速开始)

- [数据库位置](#数据库位置)

- [Drizzle ORM 集成](#drizzle-orm-集成)

- [迁移](#迁移)

- [加密](#加密)

- [API 参考](#api-参考)

- [权限](#权限)

- [与 @tauri-apps/plugin-sql 的比较](#与-tauri-appspluginsql-的比较)

- [Turso / 远程数据库](#turso--远程数据库)

- [包大小](#包大小)

- [使用 AI 集成此插件](#使用-ai-集成此插件)

- [项目结构](#项目结构)

---

## 为什么选择这个插件？

## 目录

- [为什么选择这个插件？](#为什么选择这个插件)

- [功能特性](#功能特性)

- [安装](#安装)

- [快速开始](#快速开始)

- [数据库位置](#数据库位置)

- [Drizzle ORM 集成](#drizzle-orm-集成)

- [迁移](#迁移)

- [加密](#加密)

- [API 参考](#api-参考)

- [权限](#权限)

- [与 @tauri-apps/plugin-sql 的比较](#与-tauri-appspluginsql-的比较)

- [Turso / 远程数据库](#turso--远程数据库)

- [包大小](#包大小)

- [使用 AI 集成此插件](#使用-ai-集成此插件)

- [项目结构](#项目结构)

## 为什么选择这个插件？

## 为什么选择这个插件？

### 1. Rust ORM 在应用开发中很痛苦

在 Rust 中使用原始 SQL 很冗长，而 Rust ORM（Diesel、SeaORM）需要在 Rust 中定义模式，与 TypeScript 前端配合不佳，并且增加了显著的构建复杂性。对于真正的业务逻辑在 TypeScript 中的 Tauri 应用，你也希望在 TypeScript 中编写数据库代码。

### 2. 无需 Node.js 运行时的 Drizzle ORM

Drizzle ORM 非常出色 —— 类型安全的查询、简洁的迁移系统、出色的开发体验。但它通常需要 Node.js 或 Bun 运行时来直接打开数据库文件。Tauri 的 WebView 没有这样的运行时。

这个插件通过 Drizzle 的 [sqlite-proxy](https://orm.drizzle.team/docs/get-started-sqlite#http-proxy) 模式解决了这个问题：Drizzle 生成 SQL，代理通过 Tauri 的 `invoke()` 将其发送到 Rust 插件，Rust 插件使用 turso 执行它。你的 TypeScript 代码使用完整的 Drizzle ORM，零 Node.js 依赖。

### 3. 在 WebView 中工作的迁移

Drizzle 内置的迁移器使用 Node 的 `fs` 模块在运行时从磁盘读取 `.sql` 文件 —— 这在浏览器/WebView 环境中不存在。有两种解决方法：

- **Tauri 资源文件夹** —— 将文件打包为应用资源，通过 Tauri 的 asset 协议读取。可以工作，但需要额外的 Tauri 配置。
- **Vite `import.meta.glob`** *(这个插件的方法)* —— Vite 在构建时将 SQL 文件内容直接打包到 JavaScript 中。无需运行时文件系统访问，无需额外配置。

```typescript
// Vite 在构建时解析这些 —— SQL 文本被内联到 JS 包中
const migrations = import.meta.glob<string>("./drizzle/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
});

await migrate("sqlite:myapp.db", migrations);
```

这个插件中的 `migrate()` 函数接收预加载的 SQL 字符串，在 `__drizzle_migrations` 表中跟踪已应用的迁移，并按顺序运行待处理的迁移。

### 4. 内置加密

`@tauri-apps/plugin-sql`（使用 sqlx）不支持加密。这个插件使用 turso 的原生 AES-256-CBC 加密，无需额外的原生库或 FFI 包装器。

---

## 功能特性

- **完整的 SQLite 兼容性** 通过 turso
- **原生加密** —— AES-256-CBC，可在插件级别或每个数据库配置
- **Drizzle ORM 集成** —— sqlite-proxy 模式与 `createDrizzleProxy`
- **迁移运行器** —— 浏览器安全的 `migrate()`，通过 Vite 在构建时打包 SQL 文件
- **API 兼容** 适用于 `@tauri-apps/plugin-sql`（在适用的地方）
- **跨平台**：macOS、Windows、Linux、iOS、Android
    **已测试**
    - [x] MacOS
    - [x] Windows

    - [x] Linux
    - [ ] Linux
    - [ ] iOS
    - [ ] Android

---

## 安装

### Rust

```toml
[dependencies]
tauri-plugin-turso = "0.1.0"
```

### JavaScript / TypeScript

```bash
npm install tauri-plugin-turso-api
# 或
pnpm add tauri-plugin-turso-api
```

---

## 快速开始

### 1. 注册插件（Rust）

```rust
// src-tauri/src/lib.rs

// 默认：数据库相对于当前工作目录解析
tauri::Builder::default()
    .plugin(tauri_plugin_turso::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

要在固定位置存储数据库：

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

### 2. 使用 Database 类（TypeScript）

```typescript
import { Database } from 'tauri-plugin-turso-api';

const db = await Database.load('sqlite:myapp.db');

await db.execute(
  'INSERT INTO users (name) VALUES ($1)',
  ['Alice']
);

const users = await db.select<{ id: number; name: string }[]>(
  'SELECT * FROM users'
);

await db.close();
```

---

## 数据库位置

相对路径（例如 `sqlite:myapp.db`）相对于 `base_path` 解析：

- **默认**：`std::env::current_dir()` —— 你启动 Tauri 进程的目录
- **自定义**：在插件配置中设置 `base_path`（见上文）
- **绝对路径** 按原样使用
- **内存中**：`sqlite::memory:`

相对路径被规范化（`..` 组件被折叠）并且必须保持在 `base_path` 内。会逸出的路径（例如 `sqlite:../../secret`）将被拒绝并返回错误。

---

## Drizzle ORM 集成

### 设置

```typescript
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { createDrizzleProxy } from 'tauri-plugin-turso-api';
import * as schema from './schema';

const db = drizzle(createDrizzleProxy('sqlite:myapp.db'), { schema });

const users = await db.select().from(schema.users);
```

`createDrizzleProxy` 在首次使用时延迟加载数据库连接，因此使用它时无需单独调用 `Database.load()`。

### 使用加密

```typescript
import { createDrizzleProxyWithEncryption } from 'tauri-plugin-turso-api';

const db = drizzle(
  createDrizzleProxyWithEncryption({
    path: 'sqlite:encrypted.db',
    encryption: {
      cipher: 'aes256cbc',
      key: myKey32Bytes, // number[] | Uint8Array, 32 字节
    },
  }),
  { schema }
);
```

---

## 迁移

标准的 `drizzle-orm/sqlite-proxy/migrator` 在运行时从文件系统读取，这在 Tauri WebView 中无法工作。这个插件提供了一个 `migrate()` 函数，它接受由 Vite 的 `import.meta.glob` 预打包的 SQL 内容。

### 工作流程

**1. 定义你的模式** (`src/lib/schema.ts`)：

```typescript
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});
```

**2. 配置 drizzle-kit** (`drizzle.config.ts`)：

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/schema.ts',
  out: './drizzle',
});
```

**3. 生成迁移文件**：

```bash
npx drizzle-kit generate
# 创建 drizzle/0000_init.sql, drizzle/0001_add_column.sql, 等等
```

**4. 在启动时运行迁移**：

```typescript
import { Database, migrate } from 'tauri-plugin-turso-api';

// Vite 在构建时将这些 SQL 文件打包到应用中
const migrations = import.meta.glob<string>('./drizzle/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// 启动顺序：加载 → 迁移 → 查询
await Database.load('sqlite:myapp.db');
await migrate('sqlite:myapp.db', migrations);

// 现在可以安全地查询
const db = drizzle(createDrizzleProxy('sqlite:myapp.db'), { schema });
```

### `migrate()` 如何工作

- 如果不存在，创建 `__drizzle_migrations` 跟踪表
- 通过数字前缀解析迁移文件名（`0000_`、`0001_` 等）
- 仅按顺序应用待处理的迁移
- 通过文件名记录每个已应用的迁移

### 添加模式更改

```bash
# 1. 编辑 src/lib/schema.ts
# 2. 生成新迁移
npx drizzle-kit generate
# 3. 新迁移在下次应用启动时自动运行
```

### 选项

```typescript
await migrate('sqlite:myapp.db', migrations, {
  migrationsTable: '__my_migrations', // 默认：'__drizzle_migrations'
});
```

---

## 加密

### 插件级别加密（应用于所有数据库）

在 Rust 中配置一次 —— 前端从不处理密钥：

```rust
let config = tauri_plugin_turso::Config {
    base_path: None,
    encryption: Some(tauri_plugin_turso::EncryptionConfig {
        cipher: tauri_plugin_turso::Cipher::Aes256Cbc,
        key: my_32_byte_key, // Vec<u8>, 正好 32 字节
    }),
};
```

### 每个数据库加密（从前端）

```typescript
const key = new Uint8Array(32);
crypto.getRandomValues(key);

const db = await Database.load({
  path: 'sqlite:secrets.db',
  encryption: {
    cipher: 'aes256cbc',
    key: Array.from(key), // number[] 或 Uint8Array
  },
});
```

**安全注意事项：**
- AES-256-CBC 需要正好 32 字节
- 将密钥存储在操作系统钥匙串或安全存储中 —— 丢失密钥 = 丢失数据
- 首选插件级别加密；它将密钥排除在 JavaScript 之外

---

## API 参考

### `Database.load(pathOrOptions)`

```typescript
// 简单用法
const db = await Database.load('sqlite:myapp.db');

// 使用加密
const db = await Database.load({
  path: 'sqlite:myapp.db',
  encryption: { cipher: 'aes256cbc', key: myKey },
});
```

### `db.execute(query, values?)`

```typescript
const result = await db.execute(
  'INSERT INTO todos (title) VALUES ($1)',
  ['Buy milk']
);
// result.rowsAffected, result.lastInsertId
```

### `db.select<T>(query, values?)`

```typescript
const rows = await db.select<{ id: number; title: string }[]>(
  'SELECT * FROM todos WHERE completed = $1',
  [0]
);
```

### `db.batch(queries)`

在单个事务中原子执行多个 SQL 语句。用于 DDL 或批量 DML。语句不能使用绑定参数（`$1` 占位符）—— 对参数化查询使用 `execute()`。

```typescript
await db.batch([
  'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
  'CREATE INDEX idx_users_name ON users(name)',
]);
```

### `db.sync()`

从 Turso 远程拉取最新更改到本地副本。对纯本地数据库无操作（无错误返回）。需要 `replication` 功能。

```typescript
await db.sync();
```

### `db.close()`

```typescript
await db.close();
```

### `migrate(dbPath, migrationFiles, options?)`

```typescript
import { migrate } from 'tauri-plugin-turso-api';

const migrations = import.meta.glob<string>('./drizzle/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});

await migrate('sqlite:myapp.db', migrations);
```

### `createDrizzleProxy(dbPath)`

返回一个用于 `drizzle()` 的 sqlite-proxy 回调。延迟加载连接。

### `createDrizzleProxyWithEncryption(options)`

同上，但带加密配置。

### `getConfig()`

```typescript
import { getConfig } from 'tauri-plugin-turso-api';

const { encrypted } = await getConfig();
```

---

## 权限

添加到你的 `tauri.conf.json`：

```json
{
  "plugins": {
    "turso": {}
  }
}
```

或配置细粒度能力：

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

## 与 @tauri-apps/plugin-sql 的比较

| 功能 | tauri-plugin-turso | @tauri-apps/plugin-sql |
|---------|---------------------|------------------------|
| SQLite | ✅ turso | ✅ sqlx |
| 加密 | ✅ 内置 AES-256-CBC | ❌ |
| Drizzle ORM | ✅ | ✅ |
| 迁移运行器 | ✅ 浏览器安全 | ❌ |
| MySQL / PostgreSQL | ❌ | ✅ |
| API 兼容性 | 部分 | 完整 |

---

## Turso / 远程数据库

该插件支持两种由 turso 提供支持的远程连接模式。

### 嵌入式副本（推荐用于 Tauri）

本地 SQLite 文件与 Turso 云数据库保持同步。查询从本地文件读取（快速、离线可用），写入同步到远程。

> ⚠️ **限制：嵌入式副本加密目前在 `main` 分支上存在问题**

> 由于上游 turso 的一个 bug，当使用嵌入式副本（`syncUrl`）时，本地加密被**静默禁用**。V2 同步协议（Turso 始终使用）切换到了一条丢弃 `encryption_config` 的代码路径，导致即使传递了 `encryption` 配置，本地副本文件仍然**未加密**。详情请参见 [Issue #1](https://github.com/HuakunShen/tauri-plugin-turso/issues/1)。

>

> **[`fix/sync-encryption`](../../tree/fix/sync-encryption) 分支上有可用的修复：**

> 该分支使用了 [turso 的一个 fork](https://github.com/HuakunShen/turso)，它将 `encryption_config` 传递到 V2 同步路径，并通过 `sqlite3_rekey` 加密引导的副本。它可以工作，但无法发布到 crates.io（不允许路径依赖）。通过 git 使用它：

>

> ```toml

> tauri-plugin-turso = { git = "https://github.com/HuakunShen/tauri-plugin-turso", branch = "fix/sync-encryption", features = ["replication", "encryption"] }

> ```

>

> **（在 `main` 分支上）的变通方案：**

>

> - 使用 **`fix/sync-encryption` 分支**（如果你需要加密的副本，这是推荐的）

> - 如果你不需要离线访问，使用**纯远程模式**（没有本地文件）

> - 对敏感的本地数据使用**纯本地数据库**并启用加密

> - 接受未加密的副本（Turso 访问控制仍然保护远程数据）

**1. 在你的应用 `Cargo.toml` 中启用 `replication` 功能**：

**1. 在你的应用 `Cargo.toml` 中启用 `replication` 功能**：

```toml
tauri-plugin-turso = { version = "0.1.0", features = ["replication"] }
```

**2. 使用 `syncUrl` 和 `authToken` 加载：**

```typescript
import { Database, migrate } from 'tauri-plugin-turso-api';

const db = await Database.load({
  path: 'sqlite:local.db',           // 本地副本文件
  syncUrl: 'turso://mydb-org.turso.io',
  authToken: 'your-turso-auth-token',
});

// 按需同步（例如在应用恢复 / 网络重连时）
await db.sync();
```

在 `Database.load()` 时，初始同步将最新数据从 Turso 拉取到本地文件。后续的 `sync()` 调用拉取增量更改。

**使用 Drizzle ORM：**

```typescript
const migrations = import.meta.glob<string>('./drizzle/*.sql', {
  eager: true, query: '?raw', import: 'default',
});

const db = await Database.load({
  path: 'sqlite:local.db',
  syncUrl: 'turso://mydb-org.turso.io',
  authToken: import.meta.env.VITE_TURSO_AUTH_TOKEN,
});

await migrate(db.path, migrations);

const drizzleDb = drizzle(createDrizzleProxy(db.path), { schema });
```

---

### 纯远程

所有查询直接在 Turso 上执行 —— 没有本地文件。每个查询都需要网络。

**启用 `remote` 功能：**

```toml
tauri-plugin-turso = { version = "0.1.0", features = ["remote"] }
```

```typescript
const db = await Database.load({
  path: 'turso://mydb-org.turso.io',
  authToken: 'your-turso-auth-token',
});
```

对于大多数 Tauri 应用，**嵌入式副本是更好的选择** —— 它离线工作，读取速度明显更快。

> **关于 `batch()` 与嵌入式副本的注意事项**：在某些版本中，turso 的 `execute_batch()` 不能正确地通过嵌入式副本层路由写入。该插件使用显式 `BEGIN`/`COMMIT` 事务内的单个 `execute()` 调用来避免这个问题。

> **关于 URL 验证的注意事项**：turso 的构建器在内部对同步 URL 调用 `unwrap()`，格式错误的值（例如前导/尾随空格、错误的协议）可能导致 panic。该插件将其包装在 `catch_unwind` 中，因此错误的 URL 会作为适当的错误显示，而不是无限期挂起 IPC。

---

## 包大小

基于包含的 Todo List 演示应用（macOS、aarch64、release 构建）：

| 格式 | 带加密 | 不带加密 |
|--------|----------------|--------------------|
| `.app` 包 | 15 MB | 15 MB |
| `.dmg` 安装程序 | 6.0 MB | 5.9 MB |

禁用加密基本上节省不了什么 —— 与始终存在的 SQLite 原生库相比，AES 密码代码可以忽略不计。`encryption` 功能标志仍然存在，以避免编译加密相关代码，如果你想在编译时强制没有数据库可以被加密。

### 禁用加密

加密是默认功能。要选择退出，请禁用默认功能并仅选择你需要的：

**`Cargo.toml`**（在你的 Tauri 应用中）：

```toml
tauri-plugin-turso = { version = "0.1.0", default-features = false, features = ["core"] }
```

**可用功能：**

| 功能 | 默认 | 描述 |
|---------|---------|-------------|
| `core` | ✅ | 本地 SQLite 数据库（始终需要）|
| `encryption` | ✅ | 通过 turso 的 AES-256-CBC 加密 |
| `replication` | ❌ | turso 复制支持（添加 TLS）|
| `remote` | ❌ | 远程数据库支持（计划中，见下文）|

当 `encryption` 被禁用时，向 `Database.load()` 传递 `EncryptionConfig` 将在运行时返回错误。TypeScript API 表面保持不变 —— 无需重新构建你的 JS 代码。

---

## 使用 AI 集成此插件

仓库根目录包含一个 `SKILL.md` 文件。它包含有关插件架构、启动顺序、迁移工作流、加密模式和常见错误的结构化上下文 —— 专为 AI 编码助手（Claude Code、Cursor、Copilot 等）编写。

### 使用 Claude Code

将 `SKILL.md` 复制到你项目的 `.claude/skills/tauri-plugin-turso/` 目录：

```bash
mkdir -p .claude/skills/tauri-plugin-turso
cp /path/to/tauri-plugin-turso/SKILL.md .claude/skills/tauri-plugin-turso/
```

Claude Code 自动发现技能。复制后，你可以自然地提示：

> "使用 tauri-plugin-turso 为我的 Tauri 应用添加一个 `notes` 表。包括模式、迁移和启动顺序。"

Claude 将应用正确的启动顺序，对迁移使用 `import.meta.glob`，并处理 drizzle 代理模式，无需额外指导。

### 使用其他 AI 工具

直接将 `SKILL.md` 的内容粘贴到你的系统提示或上下文窗口中，然后描述你想构建什么。该技能涵盖足够的上下文，让 AI 能在第一次尝试就生成正确、可工作的代码。

---

## 项目结构

```
tauri-plugin-turso/
├── src/                    # Rust 插件
│   ├── lib.rs              # 插件初始化、命令注册
│   ├── commands.rs         # load、execute、select、close、ping
│   ├── wrapper.rs          # DbConnection 包装 turso
│   ├── decode.rs           # turso::Value → serde_json::Value
│   ├── models.rs           # Cipher、EncryptionConfig、QueryResult
│   ├── error.rs            # 错误类型
│   ├── desktop.rs          # 桌面配置 & base_path
│   └── mobile.rs           # 移动端存根
├── guest-js/               # TypeScript 源代码
│   ├── index.ts            # Database 类、getConfig、重新导出
│   ├── drizzle.ts          # createDrizzleProxy、createDrizzleProxyWithEncryption
│   └── migrate.ts          # migrate() —— 浏览器安全的迁移运行器
├── permissions/            # Tauri 权限文件
├── examples/todo-list/     # 演示：带 Drizzle + 迁移的 Todo 应用（15 MB .app / 6 MB .dmg）
├── SKILL.md                # 适用于 Claude Code 和其他助手的 AI 技能上下文
├── build.rs
├── Cargo.toml
└── package.json
```

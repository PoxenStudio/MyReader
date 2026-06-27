# Todo List 演示

一个双面板待办应用，演示 `tauri-plugin-turso` 与本地 SQLite 和可选的 Turso 嵌入式副本同步。

## 展示内容

- **左面板** — 本地 SQLite 数据库（`todos.db`），即时读写
- **右面板** — Turso 嵌入式副本（`todos-turso.db`），与远程 Turso 数据库同步；演示写入时的真实网络延迟
- 通过 `createDrizzleProxy` 使用 Drizzle ORM（sqlite-proxy 模式）
- 使用 `migrate()` 的浏览器安全迁移，通过 `import.meta.glob` 在构建时打包
- 每面板的 Sonner 通知（本地在左下角，Turso 在右下角）
- 通过环境变量的可选 AES-256 加密（仅本地数据库）

## 运行

### 先决条件

- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/)（或 Node.js v18+）

### 安装依赖

```bash
bun install
```

### 启动开发服务器

```bash
bun run tauri dev
```

### 启用加密（本地数据库）

```bash
LIBSQL_ENCRYPTION_KEY=my-secret-key bun run tauri dev
```

密钥会自动填充/截断到 32 字节。

## 连接到 Turso

右面板在首次启动时显示连接表单。输入你的 Turso 凭据：

1. **远程 URL** — `turso://mydb-org.turso.io`
2. **认证令牌** — 你的 Turso 认证令牌

```bash
# 获取你的凭据
turso db show --url <db-name>
turso db tokens create <db-name>
```

凭据保存在 `localStorage` 中，下次启动时恢复。点击 Turso 面板标题中的 × 按钮断开连接。

## 重置数据库

每个面板底部都有一个**重置数据库**按钮。它会删除 `todos` 表和 `__drizzle_migrations` 跟踪表，然后从头重新运行所有迁移。适用于：

- 你在 Turso 控制台中手动删除了表
- 迁移跟踪表有陈旧记录
- 你想要一个干净的开始，而不删除数据库文件

## 数据库位置

两个数据库文件在你运行命令时的**当前工作目录**中创建。从 `examples/todo-list/` 运行会将它们放在那里。

- `todos.db` — 本地 SQLite
- `todos-turso.db` — 嵌入式副本（Turso 同步）

> 两个数据库必须是独立的文件。将普通 SQLite 文件作为嵌入式副本打开（或反之）会导致"元数据文件缺失"错误。

## 架构

```
App.svelte
  │
  ├── <TodoList dbFile="todos.db" position="bottom-left" />
  │     └── Database.load() → migrate() → Drizzle 查询
  │
  └── <TodoList dbFile="todos-turso.db" syncUrl="..." position="bottom-right" />
        └── Database.load({ syncUrl, authToken })  ← 从 Turso 初始同步
              migrate()
              Drizzle 查询
              db.sync()  ← 手动拉取远程更改
```

### 启动顺序（在 TodoList 内部）

```typescript
// 1. 打开/创建数据库文件（如果设置了 syncUrl，则进行初始 Turso 同步）
dbInstance = await Database.load(options);

// 2. 运行待处理的迁移
await migrate(dbPath, migrations);

// 3. 现在可以安全地查询
await loadTodos();
```

### 迁移文件

```
drizzle/
  0000_init.sql    ← 由 drizzle-kit 生成，由 Vite 在构建时打包
```

## 模式更改

```bash
# 1. 编辑 src/lib/schema.ts
# 2. 生成新迁移
bun run db:generate
# 3. 重启应用 —— 迁移在下次启动时自动运行
```

## 项目结构

```
examples/todo-list/
├── drizzle/                  # 生成的 SQL 迁移文件
├── src/
│   ├── App.svelte            # 双面板布局，Turso 连接/断开表单
│   └── lib/
│       ├── TodoList.svelte   # 自包含面板：数据库生命周期、CRUD、同步
│       ├── schema.ts         # Drizzle 表定义
│       ├── db.ts             # Drizzle 实例的 createDb() 工厂
│       └── components/       # UI 基础组件（Button、Input、Card 等）
├── src-tauri/
│   ├── Cargo.toml            # 启用复制功能的插件
│   └── src/lib.rs            # 插件注册，来自环境的加密
├── drizzle.config.ts         # drizzle-kit 配置
└── package.json              # 脚本：db:generate、tauri dev/build
```

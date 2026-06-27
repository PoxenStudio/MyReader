# Backend Services

<cite>
**Referenced Files in This Document**
- [src/lib.rs](file://src/lib.rs)
- [src/commands.rs](file://src/commands.rs)
- [src/wrapper.rs](file://src/wrapper.rs)
- [src/models.rs](file://src/models.rs)
- [src/error.rs](file://src/error.rs)
- [src/desktop.rs](file://src/desktop.rs)
- [src/decode.rs](file://src/decode.rs)
- [Cargo.toml](file://Cargo.toml)
</cite>

## Table of Contents

1. [Plugin Initialization](#plugin-initialization)
2. [Command Handlers](#command-handlers)
3. [DbConnection Wrapper](#dbconnection-wrapper)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)

## Plugin Initialization

The Rust backend follows the Tauri v2 plugin pattern with initialization split between desktop and mobile platforms.

### Entry Points

```rust
// src/lib.rs
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    init_with_config(Config::default())
}

pub fn init_with_config<R: Runtime>(config: Config) -> TauriPlugin<R> {
    Builder::new("turso")
        .invoke_handler(tauri::generate_handler![
            commands::load,
            commands::execute,
            commands::batch,
            commands::select,
            commands::sync,
            commands::close,
            commands::ping,
            commands::get_config
        ])
        .setup(move |app, _api| {
            #[cfg(mobile)]
            let turso = mobile::init(app, _api, config.clone())?;
            #[cfg(desktop)]
            let turso = desktop::init(app, _api, config)?;

            app.manage(turso);
            app.manage(DbInstances::default());
            Ok(())
        })
        .build()
}
```

**Key components**:
- **Plugin Name**: "turso" used in invoke calls as "plugin:turso|command"
- **Command Registration**: All public commands registered via `generate_handler!`
- **Platform Abstraction**: `#[cfg]` attributes for desktop/mobile
- **State Management**: Two managed states (`Turso` and `DbInstances`)

**Section sources**

- [src/lib.rs](file://src/lib.rs#L24-L54)

### Platform-Specific Initialization

**Desktop** (`src/desktop.rs`):
```rust
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
    config: Config,
) -> crate::Result<Turso> {
    Ok(Turso(config))
}
```

**Mobile** (`src/mobile.rs`):
```rust
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
    config: Config,
) -> crate::Result<Turso> {
    // Currently a stub - would need platform-specific implementation
    Ok(Turso(config))
}
```

**Section sources**

- [src/desktop.rs](file://src/desktop.rs#L17-L23)
- [src/mobile.rs](file://src/mobile.rs#L17-L25)

## Command Handlers

The plugin exposes 8 Tauri commands for database operations:

### Command Overview

| Command | Purpose | Arguments | Returns |
|---------|---------|-----------|---------|
| `load` | Open database connection | `LoadOptions` | `String` (path) |
| `execute` | Execute non-SELECT query | `db`, `query`, `values` | `QueryResult` |
| `select` | Execute SELECT query | `db`, `query`, `values` | `Vec<IndexMap>` |
| `batch` | Execute multiple statements | `db`, `queries` | `()` |
| `sync` | Sync embedded replica | `db` | `()` |
| `close` | Close connection(s) | `db?` | `bool` |
| `ping` | Health check | `PingRequest` | `PingResponse` |
| `get_config` | Get plugin config | - | `ConfigInfo` |

**Section sources**

- [src/commands.rs](file://src/commands.rs)
- [src/lib.rs](file://src/lib.rs#L32-L41)

### The Load Command

The `load` command is the entry point for database access. It establishes connections in three modes:

```rust
#[command]
pub(crate) async fn load<R: Runtime>(
    app: AppHandle<R>,
    db_instances: State<'_, DbInstances>,
    options: LoadOptions,
) -> Result<String, Error> {
    let path = options.path.clone();
    let turso = app.state::<Turso>().inner();
    let base_path = turso.base_path();
    
    // Use provided encryption or fall back to plugin default
    let encryption = options.encryption.or_else(|| turso.encryption().cloned());
    
    // Idempotent: return existing connection if already open
    if db_instances.0.lock().await.contains_key(&path) {
        return Ok(path);
    }
    
    let conn = DbConnection::connect(
        &path,
        encryption,
        base_path,
        options.sync_url,
        options.auth_token,
    ).await?;
    
    db_instances.0.lock().await.insert(
        path.clone(),
        Arc::new(conn)
    );
    
    Ok(path)
}
```

**Key behaviors**:
1. **Idempotent**: Returns existing connection if already open
2. **Encryption inheritance**: Falls back to plugin-level encryption if not specified
3. **Mode detection**: Determines local/replica/remote from options
4. **Connection pooling**: Stores in `DbInstances` for reuse

**Section sources**

- [src/commands.rs](file://src/commands.rs#L15-L51)

### Query Execution Commands

Both `execute` and `select` follow the same pattern with different return types:

```rust
#[command]
pub(crate) async fn execute(
    db_instances: State<'_, DbInstances>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<QueryResult, Error> {
    // Lock discipline: clone Arc while holding lock
    let conn = {
        let instances = db_instances.0.lock().await;
        instances
            .get(&db)
            .ok_or_else(|| Error::DatabaseNotLoaded(db.clone()))?
            .clone()
    };
    // Lock released before await
    conn.execute(&query, values).await
}
```

**Critical pattern**: The lock is released before `.await` by cloning the `Arc<DbConnection>` inside the lock scope. This prevents holding a mutex across an await point, which would block other operations.

**Section sources**

- [src/commands.rs](file://src/commands.rs#L53-L91)

### Batch Command

The `batch` command executes multiple SQL statements atomically:

```rust
#[command]
pub(crate) async fn batch(
    db_instances: State<'_, DbInstances>,
    db: String,
    queries: Vec<String>,
) -> Result<(), Error> {
    let conn = { /* ... lock discipline ... */ };
    conn.batch(queries).await
}
```

**Important constraint**: Statements in a batch cannot use bound parameters (`$1`, etc.). This is because the batch uses turso's `execute()` with `Params::None` for each statement. Use `execute()` for parameterized queries.

**Section sources**

- [src/commands.rs](file://src/commands.rs#L93-L110)

## DbConnection Wrapper

The `DbConnection` struct is the core abstraction around turso, handling all connection modes and query execution.

### Structure

```rust
pub struct DbConnection {
    conn: Connection,    // turso connection for queries
    db: Database,        // turso database for sync operations
}
```

**Section sources**

- [src/wrapper.rs](file://src/wrapper.rs#L15-L19)

### Connection Establishment

```rust
pub async fn connect(
    path: &str,
    encryption: Option<EncryptionConfig>,
    base_path: PathBuf,
    sync_url: Option<String>,
    auth_token: Option<String>,
) -> Result<Self, Error> {
    AssertUnwindSafe(async move {
        if let Some(url) = sync_url {
            // Embedded replica mode
            Self::open_replica(full_path, url, auth_token?, encryption).await
        } else if path.starts_with("turso://") || path.starts_with("https://") {
            // Pure remote mode
            Self::open_remote(path, auth_token?).await
        } else {
            // Local mode
            Self::open_local(full_path, encryption).await
        }
    })
    .catch_unwind()
    .await
    .map_err(|_| Error::InvalidDbUrl("turso panicked".into()))?
}
```

**Key aspects**:
- **Mode detection**: Based on `sync_url` presence and path prefix
- **Panic safety**: Wrapped in `catch_unwind` to handle turso's internal panics
- **Path validation**: Local paths are resolved and normalized before opening

**Section sources**

- [src/wrapper.rs](file://src/wrapper.rs#L27-L60)

### Query Execution Methods

#### Execute (Non-SELECT)

```rust
pub async fn execute(
    &self,
    query: &str,
    values: Vec<JsonValue>,
) -> Result<QueryResult, Error> {
    let params = json_to_params(values);
    let rows_affected = self.conn.execute(query, params).await?;
    
    Ok(QueryResult {
        rows_affected,
        last_insert_id: self.conn.last_insert_rowid(),
    })
}
```

**Section sources**

- [src/wrapper.rs](file://src/wrapper.rs#L189-L198)

#### Select

```rust
pub async fn select(
    &self,
    query: &str,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, Error> {
    let params = json_to_params(values);
    let mut rows = self.conn.query(query, params).await?;
    let mut results = Vec::new();
    
    while let Some(row) = rows.next().await? {
        let mut map = IndexMap::new();
        let column_count = row.column_count();
        
        for i in 0..column_count {
            if let Some(column_name) = row.column_name(i) {
                let value = decode::to_json(&row, i)?;
                map.insert(column_name.to_string(), value);
            }
        }
        results.push(map);
    }
    
    Ok(results)
}
```

**Key aspects**:
- Uses `IndexMap` to preserve column order from the query
- Iterates all rows from the query cursor
- Converts each column value using `decode::to_json`

**Section sources**

- [src/wrapper.rs](file://src/wrapper.rs#L200-L226)

#### Batch (Transaction)

```rust
pub async fn batch(&self,
    queries: Vec<String>,
) -> Result<(), Error> {
    self.conn.execute("BEGIN", Params::None).await?;
    
    for query in &queries {
        if let Err(e) = self.conn.execute(query, Params::None).await {
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

**Implementation note**: Uses explicit `BEGIN/COMMIT/ROLLBACK` instead of turso's `execute_batch()` because the latter has issues with embedded replica write routing in some turso versions.

**Section sources**

- [src/wrapper.rs](file://src/wrapper.rs#L228-L243)

## Data Models

The plugin uses serde for serialization between Rust and TypeScript.

### LoadOptions

```rust
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOptions {
    pub path: String,
    pub encryption: Option<EncryptionConfig>,
    pub sync_url: Option<String>,
    pub auth_token: Option<String>,
}
```

**Section sources**

- [src/models.rs](file://src/models.rs#L36-L47)

### EncryptionConfig

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionConfig {
    pub cipher: Cipher,
    pub key: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cipher {
    #[serde(rename = "aes256cbc", alias = "aes256-cbc")]
    Aes256Cbc,
}
```

**Section sources**

- [src/models.rs](file://src/models.rs#L21-L26)
- [src/models.rs](file://src/models.rs#L5-L9)

### QueryResult

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub rows_affected: u64,
    pub last_insert_id: i64,
}
```

**Section sources**

- [src/models.rs](file://src/models.rs#L49-L57)

## Error Handling

The plugin uses `thiserror` for error definition with `Serialize` for Tauri IPC compatibility.

### Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    
    #[error(transparent)]
    Turso(#[from] turso::Error),
    
    #[error("invalid connection url: {0}")]
    InvalidDbUrl(String),
    
    #[error("database {0} not loaded")]
    DatabaseNotLoaded(String),
    
    #[error("unsupported datatype: {0}")]
    UnsupportedDatatype(String),
    
    #[error("operation not supported: {0}")]
    OperationNotSupported(String),
    
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}
```

### Serialization for IPC

Errors must be serializable to cross the Tauri IPC boundary:

```rust
impl Serialize for Error {
    fn serialize<S>(&self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
```

This converts errors to their string representation for transmission to the frontend.

**Section sources**

- [src/error.rs](file://src/error.rs)

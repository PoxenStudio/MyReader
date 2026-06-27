# AGENTS.md — src/

Rust plugin implementation for tauri-plugin-turso.

## STRUCTURE

| File | Purpose | Lines |
|------|---------|-------|
| `lib.rs` | Plugin init, command registration | 54 |
| `commands.rs` | Tauri command handlers (load, execute, select, batch, sync, close) | 170 |
| `wrapper.rs` | `DbConnection` — turso wrapper, local/replica/remote modes | 296 |
| `models.rs` | Serde types: `LoadOptions`, `EncryptionConfig`, `QueryResult` | 70 |
| `error.rs` | `thiserror` enum with `Serialize` for IPC | 33 |
| `desktop.rs` | Desktop config, `base_path` resolution | 47 |
| `mobile.rs` | Mobile stub (unimplemented) | 49 |
| `decode.rs` | `turso::Value` → `serde_json::Value` conversion | 30 |

## WHERE TO LOOK

| Task | File | Pattern |
|------|------|---------|
| Add new command | `commands.rs` + `lib.rs` | `#[command] async fn`, add to `generate_handler![]` |
| Modify connection logic | `wrapper.rs` | `DbConnection::connect()` handles 3 modes |
| Add config option | `models.rs` + `desktop.rs` | Derive `Deserialize`, add to `Config` |
| Change error behavior | `error.rs` | Add variant, derive macros handle rest |
| Feature-gate code | any file | `#[cfg(feature = "X")]` / `#[cfg(not(feature = "X"))]` |

## CONVENTIONS

- **Error type**: `crate::Result<T>` = `std::result::Result<T, Error>`
- **State access**: `app.state::<Turso>().inner()` or `db_instances.0.lock().await`
- **Lock discipline**: Clone Arc while holding lock, release before await:
  ```rust
  let conn = {
      let instances = db_instances.0.lock().await;
      instances.get(&db).ok_or(...)?.clone()
  };
  conn.execute(...).await  // lock released
  ```
- **Path validation**: `resolve_local_path()` normalizes `..` and checks against `base_path`
- **Panic safety**: turso builder calls `unwrap()` on bad URLs — wrap in `AssertUnwindSafe` + `catch_unwind`

## ANTI-PATTERNS

- **NEVER** hold mutex lock across `.await` — clone Arc first
- **NEVER** let turso builder panic escape — use `catch_unwind` → `Error::InvalidDbUrl`
- **NEVER** use `execute_batch` for replicas — use explicit transaction (see `batch()` implementation)
- **NEVER** skip `#[cfg]` gates for optional features — always provide both implementations

## FEATURE-SPECIFIC CODE

```rust
#[cfg(feature = "replication")]
async fn open_replica(...) -> Result<Database, Error> { ... }

#[cfg(not(feature = "replication"))]
async fn open_replica(...) -> Result<Database, Error> {
    Err(Error::OperationNotSupported("replication feature required".into()))
}
```

## COMMAND PATTERN

```rust
#[command]
pub(crate) async fn my_command<R: Runtime>(
    app: AppHandle<R>,
    db_instances: State<'_, DbInstances>,
    payload: MyRequest,
) -> Result<MyResponse, Error> {
    // implementation
}
```

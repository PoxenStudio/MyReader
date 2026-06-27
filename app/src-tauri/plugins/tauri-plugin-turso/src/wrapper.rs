use futures::lock::Mutex;
use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use turso::{Builder as TursoBuilder, Connection, Database, Value};

use crate::decode;
use crate::error::Error;
use crate::models::{EncryptionConfig, QueryResult};

/// A wrapper around turso connection
pub struct DbConnection {
    conn: Connection,
    #[allow(dead_code)]
    db: Database,
}

impl DbConnection {
    /// Connect to a turso/SQLite database (local only).
    pub async fn connect(
        path: &str,
        encryption: Option<EncryptionConfig>,
        base_path: PathBuf,
        experimental: &[String],
    ) -> Result<Self, Error> {
        let full_path = Self::resolve_local_path(path, &base_path)?;
        let path_str = full_path.to_string_lossy().to_string();

        #[allow(unused_mut)]
        let mut builder = TursoBuilder::new_local(&path_str);

        for feature in experimental {
            match feature.as_str() {
                "index_method" => builder = builder.experimental_index_method(true),
                "encryption" => builder = builder.experimental_encryption(true),
                "triggers" => builder = builder.experimental_triggers(true),
                "attach" => builder = builder.experimental_attach(true),
                "custom_types" => builder = builder.experimental_custom_types(true),
                "materialized_views" => builder = builder.experimental_materialized_views(true),
                _ => {}
            }
        }

        #[cfg(feature = "encryption")]
        if let Some(config) = encryption {
            builder = builder
                .experimental_encryption(true)
                .with_encryption(config.into());
        }
        #[cfg(not(feature = "encryption"))]
        if encryption.is_some() {
            return Err(Error::InvalidDbUrl(
                "encryption feature is not enabled — rebuild with the `encryption` feature".into(),
            ));
        }

        let db = builder.build().await?;
        let conn = db.connect()?;
        Ok(Self { conn, db })
    }

    fn resolve_local_path(path: &str, base_path: &Path) -> Result<PathBuf, Error> {
        let db_path = path.strip_prefix("sqlite:").unwrap_or(path);

        if db_path == ":memory:" {
            return Ok(PathBuf::from(":memory:"));
        }

        if PathBuf::from(db_path).is_absolute() {
            return Ok(PathBuf::from(db_path));
        }

        // Normalise away `..` so a path can't escape base_path
        let joined = base_path.join(db_path);
        let normalised = joined.components().fold(PathBuf::new(), |mut acc, c| {
            match c {
                Component::ParentDir => {
                    acc.pop();
                }
                Component::CurDir => {}
                _ => acc.push(c),
            }
            acc
        });

        if !normalised.starts_with(base_path) {
            return Err(Error::InvalidDbUrl(format!(
                "path '{}' escapes the base directory",
                db_path
            )));
        }

        Ok(normalised)
    }

    // ── public API ───────────────────────────────────────────────────────────

    /// Execute a query that doesn't return rows
    pub async fn execute(&self, query: &str, values: Vec<JsonValue>) -> Result<QueryResult, Error> {
        let params = json_to_params(values);
        let rows_affected = self.conn.execute(query, params).await?;

        Ok(QueryResult {
            rows_affected,
            last_insert_id: self.conn.last_insert_rowid(),
        })
    }

    /// Execute a query that returns rows
    pub async fn select(
        &self,
        query: &str,
        values: Vec<JsonValue>,
    ) -> Result<Vec<IndexMap<String, JsonValue>>, Error> {
        let params = json_to_params(values);
        let mut rows = self.conn.query(query, params).await?;

        let column_count = rows.column_count();
        let column_names: Vec<String> = (0..column_count)
            .map(|i| rows.column_name(i))
            .collect::<Result<Vec<_>, _>>()?;

        let mut results = Vec::new();

        while let Some(row) = rows.next().await? {
            let mut map = IndexMap::new();
            for (i, name) in column_names.iter().enumerate() {
                let value = decode::to_json(&row, i)?;
                map.insert(name.clone(), value);
            }
            results.push(map);
        }

        Ok(results)
    }

    /// Execute multiple SQL statements atomically inside a transaction.
    pub async fn batch(&self, queries: Vec<String>) -> Result<(), Error> {
        self.conn.execute("BEGIN", ()).await?;
        for query in &queries {
            if let Err(e) = self.conn.execute(query.as_str(), ()).await {
                let _ = self.conn.execute("ROLLBACK", ()).await;
                return Err(Error::Turso(e));
            }
        }
        if let Err(e) = self.conn.execute("COMMIT", ()).await {
            let _ = self.conn.execute("ROLLBACK", ()).await;
            return Err(Error::Turso(e));
        }
        Ok(())
    }

    pub async fn close(&self) {
        // turso connections are cleaned up on drop; no explicit close needed.
    }
}

/// Convert JSON values to a Vec<Value> for turso params (Vec<Value> implements IntoParams).
fn json_to_params(values: Vec<JsonValue>) -> Vec<Value> {
    values.into_iter().map(json_to_turso_value).collect()
}

fn json_to_turso_value(v: JsonValue) -> Value {
    match v {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Integer(if b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                Value::Null
            }
        }
        JsonValue::String(s) => Value::Text(s),
        JsonValue::Array(ref arr) => {
            if arr.iter().all(|v| v.is_number()) {
                let bytes: Vec<u8> = arr
                    .iter()
                    .filter_map(|v| v.as_u64().map(|n| n as u8))
                    .collect();
                Value::Blob(bytes)
            } else {
                Value::Text(v.to_string())
            }
        }
        JsonValue::Object(_) => Value::Text(v.to_string()),
    }
}

/// Database instances holder
pub struct DbInstances(pub Arc<Mutex<HashMap<String, Arc<DbConnection>>>>);

impl Default for DbInstances {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

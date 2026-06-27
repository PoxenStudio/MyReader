use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Encryption configuration for database.
/// The turso crate uses a cipher name string and a hex-encoded key.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionConfig {
    /// Cipher name (e.g. "aes256")
    pub cipher: String,
    /// Hex-encoded encryption key (e.g. 64 hex chars for a 32-byte key)
    pub hexkey: String,
}

impl From<EncryptionConfig> for turso::EncryptionOpts {
    fn from(config: EncryptionConfig) -> Self {
        turso::EncryptionOpts {
            cipher: config.cipher,
            hexkey: config.hexkey,
        }
    }
}

/// Options for loading a database
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOptions {
    /// Database path. For local files: "sqlite:myapp.db" or just "myapp.db"
    pub path: String,
    /// Optional encryption configuration (local databases only)
    pub encryption: Option<EncryptionConfig>,
    /// Optional list of experimental features to enable (e.g. ["index_method"])
    #[serde(default)]
    pub experimental: Vec<String>,
}

/// Result of an execute operation
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    /// Number of rows affected
    pub rows_affected: u64,
    /// Last inserted row ID
    pub last_insert_id: i64,
}

/// Plugin configuration
#[derive(Debug, Clone, Default)]
pub struct Config {
    /// Base path for relative database paths. Defaults to current working directory.
    pub base_path: Option<PathBuf>,
    /// Default encryption configuration for all databases.
    /// Can be overridden per-database when loading.
    pub encryption: Option<EncryptionConfig>,
}

// Keep ping for backwards compatibility
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub value: Option<String>,
}

use serde::de::DeserializeOwned;
use std::path::PathBuf;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_turso);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
    config: Config,
) -> crate::Result<Turso> {
    // For mobile, we'll use a simple config-based approach
    // The actual mobile implementation would need platform-specific code
    Ok(Turso(config))
}

/// Access to the turso APIs.
pub struct Turso(Config);

impl Turso {
    pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
        Ok(PingResponse {
            value: payload.value,
        })
    }

    /// Get the configured base path for databases
    pub fn base_path(&self) -> PathBuf {
        self.0
            .base_path
            .clone()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    /// Get the default encryption config
    pub fn encryption(&self) -> Option<&EncryptionConfig> {
        self.0.encryption.as_ref()
    }
}

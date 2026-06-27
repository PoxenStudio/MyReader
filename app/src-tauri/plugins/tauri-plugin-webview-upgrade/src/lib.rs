//! Bootstraps a WebView upgrade on Android devices whose system WebView is too
//! old to render the host app correctly.
//!
//! On Android, the real work runs inside an `androidx.startup` `Initializer`
//! declared in this crate's merged AndroidManifest — see
//! `android/src/main/java/com/readest/webview_upgrade/WebViewUpgradeInitializer.kt`.
//! That initializer fires during process attach, *before* `Application.onCreate`
//! and long before Tauri/Wry instantiates a WebView, which is the only window
//! in which `WebViewUpgrade.upgrade` is allowed to swap the in-process provider.
//!
//! This Rust side is intentionally a no-op everywhere: there are no commands,
//! no setup hook, no `manage`d state. Its only purpose is to make the host
//! app's Cargo + Gradle build pick up the Android library via Tauri's plugin
//! discovery (which is driven by the `links` field in `Cargo.toml`).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("webview-upgrade").build()
}

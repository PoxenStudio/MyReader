use std::path::PathBuf;

/// Directory (relative to the primary external storage root) where MyReader
/// writes its logs when shared storage is writable.
const LOG_SUBPATH: &str = "Download/MyReader/Logs";

/// Probe whether the shared `Download/MyReader/Logs` folder is writable and
/// return its path if so.
///
/// Android's scoped storage blocks direct file access to shared storage
/// outside the app's own sandbox unless the user has granted "All files
/// access" (`MANAGE_EXTERNAL_STORAGE`) — a device Settings toggle that, once
/// granted, persists across app launches. Rather than duplicating that
/// permission check here via JNI, this attempts the write directly: it
/// fails cleanly when the grant is missing and succeeds when it's present.
/// Called once at startup, before the log plugin is configured, so the
/// result decides where the logger writes for the rest of the process
/// lifetime — no later re-check or copy step is needed.
pub fn writable_shared_log_dir() -> Option<PathBuf> {
    let root = std::env::var("EXTERNAL_STORAGE").unwrap_or_else(|_| "/storage/emulated/0".into());
    let dir = PathBuf::from(root).join(LOG_SUBPATH);

    std::fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write_test");
    std::fs::write(&probe, []).ok()?;
    let _ = std::fs::remove_file(&probe);

    Some(dir)
}

use std::path::{Path, PathBuf};

/// Directory (relative to the primary external storage root) where MyReader
/// writes its logs when shared storage is writable.
#[cfg(target_os = "android")]
const LOG_SUBPATH: &str = "Download/MyReader";

/// Log file stem; the log plugin appends the `.log` extension.
pub const LOG_FILE_STEM: &str = "myreader";

/// Return the shared `Download/MyReader` folder if the log file inside it can
/// be opened for appending, so the user can find `myreader.log` without
/// digging through the private sandbox. `None` means the caller should fall
/// back to the private per-app log dir.
#[cfg(target_os = "android")]
pub fn writable_shared_log_dir() -> Option<PathBuf> {
    let root = std::env::var("EXTERNAL_STORAGE").unwrap_or_else(|_| "/storage/emulated/0".into());
    probe_log_dir(&PathBuf::from(root).join(LOG_SUBPATH))
}

/// Probe `dir` by performing the exact open the log plugin will do
/// (create + append on `<LOG_FILE_STEM>.log`).
///
/// A separate probe file is not enough: on Android 11+ an app may create new
/// files under `Download/` without any permission, yet an existing
/// `myreader.log` left by a previous install (reinstall, debug/release swap,
/// cleared data) is owned by another UID and opening it fails with `EACCES`.
/// Because the log plugin's `setup()` propagates that error, it would abort
/// app startup — so the probe must hit the real file.
pub fn probe_log_dir(dir: &Path) -> Option<PathBuf> {
    std::fs::create_dir_all(dir).ok()?;
    let file = dir.join(LOG_FILE_STEM).with_extension("log");
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .ok()?;
    Some(dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "myreader_log_probe_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn creates_dir_and_log_file() {
        let dir = temp_dir("create").join("MyReader");
        assert_eq!(probe_log_dir(&dir), Some(dir.clone()));
        assert!(dir.join("myreader.log").is_file());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn keeps_existing_log_content() {
        let dir = temp_dir("append");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("myreader.log"), b"old").unwrap();
        assert!(probe_log_dir(&dir).is_some());
        assert_eq!(std::fs::read(dir.join("myreader.log")).unwrap(), b"old");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_existing_log_file_that_cannot_be_opened() {
        let dir = temp_dir("readonly");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("myreader.log");
        std::fs::write(&file, b"").unwrap();
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms.clone()).unwrap();

        assert_eq!(probe_log_dir(&dir), None);

        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        std::fs::set_permissions(&file, perms).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_dir_that_cannot_be_created() {
        let base = temp_dir("blocked");
        std::fs::create_dir_all(&base).unwrap();
        let blocker = base.join("not_a_dir");
        std::fs::write(&blocker, b"").unwrap();
        assert_eq!(probe_log_dir(&blocker.join("MyReader")), None);
        let _ = std::fs::remove_dir_all(&base);
    }
}

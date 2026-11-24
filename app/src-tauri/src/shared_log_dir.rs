use std::path::{Path, PathBuf};

/// Directory (relative to the primary external storage root) where MyReader
/// writes its logs when shared storage is writable.
#[cfg(target_os = "android")]
const LOG_SUBPATH: &str = "Download/MyReader";

/// Log file stems, tried in order; the log plugin appends `.log`.
///
/// A reinstall gets a new app UID on Android, so a `myreader.log` left by the
/// previous install under `Download/` cannot be opened (`EACCES`). Rather than
/// silently falling back to the private per-app dir (where the user can't find
/// the log), try a second file name first.
const LOG_FILE_STEMS: [&str; 2] = ["myreader", "myreader-2"];

/// Return the shared `Download/MyReader` folder and the log file stem to use if
/// the file inside it can be opened for appending, so the user can find the log
/// without digging through the private sandbox. `None` means the caller should
/// fall back to the private per-app log dir.
#[cfg(target_os = "android")]
pub fn writable_shared_log_dir() -> Option<(PathBuf, String)> {
    let root = std::env::var("EXTERNAL_STORAGE").unwrap_or_else(|_| "/storage/emulated/0".into());
    probe_log_dir(&PathBuf::from(root).join(LOG_SUBPATH))
}

/// Probe `dir` by performing the exact open the log plugin will do
/// (create + append on `<stem>.log`), for each candidate stem in turn.
///
/// A separate probe file is not enough: on Android 11+ an app may create new
/// files under `Download/` without any permission, yet an existing
/// `myreader.log` left by a previous install (reinstall, debug/release swap,
/// cleared data) is owned by another UID and opening it fails with `EACCES`.
/// Because the log plugin's `setup()` propagates that error, it would abort
/// app startup — so the probe must hit the real file.
pub fn probe_log_dir(dir: &Path) -> Option<(PathBuf, String)> {
    std::fs::create_dir_all(dir).ok()?;
    for stem in LOG_FILE_STEMS {
        let file = dir.join(stem).with_extension("log");
        let opened = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .is_ok();
        if opened {
            return Some((dir.to_path_buf(), stem.to_string()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "myreader_log_probe_{}_{}",
            name,
            std::process::id()
        ))
    }

    #[test]
    fn creates_dir_and_log_file() {
        let dir = temp_dir("create").join("MyReader");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        let (path, stem) = probe_log_dir(&dir).expect("probe should succeed");
        assert_eq!(path, dir);
        assert_eq!(stem, LOG_FILE_STEMS[0]);
        assert!(dir.join(stem).with_extension("log").is_file());
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn keeps_existing_log_content() {
        let dir = temp_dir("append");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("myreader.log"), b"old").unwrap();
        assert!(probe_log_dir(&dir).is_some());
        assert_eq!(std::fs::read(dir.join("myreader.log")).unwrap(), b"old");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn falls_back_to_second_name_when_existing_log_cannot_be_opened() {
        let dir = temp_dir("readonly");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("myreader.log");
        std::fs::write(&file, b"").unwrap();
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms.clone()).unwrap();

        // The first candidate is unopenable, so the probe must keep logs in
        // Download under the second name instead of giving up on shared storage.
        let (path, stem) = probe_log_dir(&dir).expect("fallback stem should succeed");
        assert_eq!(path, dir);
        assert_eq!(stem, LOG_FILE_STEMS[1]);

        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        std::fs::set_permissions(&file, perms).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_dir_that_cannot_be_created() {
        let base = temp_dir("blocked");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let blocker = base.join("not_a_dir");
        std::fs::write(&blocker, b"").unwrap();
        assert_eq!(probe_log_dir(&blocker.join("MyReader")), None);
        let _ = std::fs::remove_dir_all(&base);
    }
}

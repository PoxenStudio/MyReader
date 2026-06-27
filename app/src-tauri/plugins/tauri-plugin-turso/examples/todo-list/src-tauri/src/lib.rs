use std::path::PathBuf;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Get current working directory for database storage
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // Check for optional encryption key from environment variable
    // Set LIBSQL_ENCRYPTION_KEY to any string - it will be padded/truncated to 32 bytes
    // Example: export LIBSQL_ENCRYPTION_KEY=my-secret-key
    let encryption = std::env::var("LIBSQL_ENCRYPTION_KEY").ok().map(|key_str| {
        // Convert string to bytes and pad/truncate to 32 bytes
        let mut key_bytes = key_str.as_bytes().to_vec();

        if key_bytes.len() < 32 {
            // Pad by repeating the key
            let original = key_bytes.clone();
            while key_bytes.len() < 32 {
                let remaining = 32 - key_bytes.len();
                let take = remaining.min(original.len());
                key_bytes.extend_from_slice(&original[..take]);
            }
            eprintln!("LIBSQL_ENCRYPTION_KEY padded to 32 bytes");
        } else if key_bytes.len() > 32 {
            // Truncate to 32 bytes
            key_bytes.truncate(32);
            eprintln!("LIBSQL_ENCRYPTION_KEY truncated to 32 bytes");
        }

        tauri_plugin_turso::EncryptionConfig {
            cipher: tauri_plugin_turso::Cipher::Aes256Cbc,
            key: key_bytes,
        }
    });

    if encryption.is_some() {
        eprintln!("Database encryption: ENABLED");
    } else {
        eprintln!("Database encryption: DISABLED (set LIBSQL_ENCRYPTION_KEY to enable)");
    }

    let config = tauri_plugin_turso::Config {
        base_path: Some(cwd),
        encryption,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_turso::init_with_config(config))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

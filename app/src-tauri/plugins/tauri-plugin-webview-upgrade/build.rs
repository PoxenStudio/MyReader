// No commands — the plugin's entire job runs in an androidx.startup
// Initializer in the Android module, before Tauri even boots.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}

const COMMANDS: &[&str] = &["load", "execute", "select", "close", "ping", "get_config"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}

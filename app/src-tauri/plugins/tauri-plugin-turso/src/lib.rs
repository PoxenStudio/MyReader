use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod decode;
mod error;
mod models;
mod wrapper;

pub use error::{Error, Result};
pub use wrapper::DbInstances;

/// Initializes the plugin with default configuration.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    init_with_config(Config::default())
}

/// Initializes the plugin with custom configuration.
pub fn init_with_config<R: Runtime>(config: Config) -> TauriPlugin<R> {
    Builder::new("turso")
        .invoke_handler(tauri::generate_handler![
            commands::load,
            commands::execute,
            commands::batch,
            commands::select,
            commands::close,
            commands::ping,
            commands::get_config
        ])
        .setup(move |app, _api| {
            #[cfg(mobile)]
            let turso = mobile::init(app, _api, config.clone())?;
            #[cfg(desktop)]
            let turso = desktop::init(app, _api, config)?;

            app.manage(turso);
            app.manage(DbInstances::default());

            Ok(())
        })
        .build()
}

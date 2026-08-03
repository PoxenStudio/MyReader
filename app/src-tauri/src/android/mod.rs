pub mod eink;
pub mod shared_log_dir;

pub use eink::is_eink_device;
pub use shared_log_dir::writable_shared_log_dir;

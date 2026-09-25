#[cfg(not(target_os = "linux"))]
mod tao_shell;
#[cfg(not(target_os = "linux"))]
pub use tao_shell::{run, webview_version};

#[cfg(target_os = "linux")]
mod gtk_shell;
#[cfg(target_os = "linux")]
pub use gtk_shell::{run, webview_version};

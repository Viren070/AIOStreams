#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(not(windows))]
compile_error!("the desktop shell only supports Windows so far");

//! The local socket a player's IPC server listens on: a named pipe on Windows.

use std::io;
use std::sync::atomic::{AtomicU32, Ordering};

#[cfg(windows)]
pub type Stream = std::fs::File;
#[cfg(unix)]
pub type Stream = std::os::unix::net::UnixStream;

/// A new address each time, so a player still closing never answers for the next.
pub fn address() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let name = format!(
        "aiostreams-player-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    #[cfg(windows)]
    let address = format!(r"\\.\pipe\{name}");
    #[cfg(unix)]
    let address = std::env::temp_dir()
        .join(format!("{name}.sock"))
        .to_string_lossy()
        .into_owned();
    address
}

#[cfg(windows)]
pub fn connect(address: &str) -> io::Result<Stream> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(address)
}

#[cfg(unix)]
pub fn connect(address: &str) -> io::Result<Stream> {
    Stream::connect(address)
}

pub fn remove(address: &str) {
    if cfg!(unix) {
        let _ = std::fs::remove_file(address);
    }
}

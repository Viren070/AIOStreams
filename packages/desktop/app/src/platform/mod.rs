#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
compile_error!("the desktop shell only supports Windows, Linux and macOS");

#[cfg(unix)]
pub fn total_memory() -> Option<u64> {
    // SAFETY: sysconf only reads system values.
    let (pages, size) = unsafe {
        (
            libc::sysconf(libc::_SC_PHYS_PAGES),
            libc::sysconf(libc::_SC_PAGESIZE),
        )
    };
    (pages > 0 && size > 0).then(|| pages as u64 * size as u64)
}

/// Only the Mac app picks what draws the video, and switches the display's HDR for it.
#[cfg(not(target_os = "macos"))]
mod fixed_video {
    use aiostreams_desktop_core::playback::Fit;

    pub fn update_hdr(_gamma: Option<String>, _primaries: Option<String>) {}

    pub fn fit_video(fit: Fit) -> Fit {
        fit
    }

    pub fn video_outputs() -> (Vec<&'static str>, &'static str, &'static str) {
        (Vec::new(), "mpv", "mpv")
    }

    pub fn choose_video_output(_output: &str) {}

    pub fn relaunch() -> bool {
        false
    }
}
#[cfg(not(target_os = "macos"))]
pub use fixed_video::*;

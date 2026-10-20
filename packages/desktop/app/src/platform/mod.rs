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

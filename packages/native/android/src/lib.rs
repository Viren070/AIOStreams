//! Exports for `io.github.viren070.aiostreams.natives`: one Kotlin object per feature, one module here.

pub mod http;
#[cfg(target_os = "android")]
mod logcat;
mod subtitles;
mod thumbnails;

/// Sends the Rust code's log records to logcat once the app loads the library.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn JNI_OnLoad(
    _vm: *mut jni::sys::JavaVM,
    _: *mut std::ffi::c_void,
) -> jni::sys::jint {
    logcat::init();
    jni::sys::JNI_VERSION_1_6
}

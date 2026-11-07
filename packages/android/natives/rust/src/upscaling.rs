use jni::JNIEnv;
use jni::objects::JClass;
use jni::sys::{jfloat, jstring};

fn text(env: JNIEnv, value: &str) -> jstring {
    env.new_string(value)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Backs `Upscaling.network`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_viren070_aiostreams_natives_Upscaling_network(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    text(env, aiostreams_upscale::NETWORK)
}

/// Backs `Upscaling.mpvShader`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_viren070_aiostreams_natives_Upscaling_mpvShader(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    text(env, aiostreams_upscale::MPV_SHADER)
}

/// Backs `Upscaling.minScale`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_viren070_aiostreams_natives_Upscaling_minScale(
    _env: JNIEnv,
    _class: JClass,
) -> jfloat {
    aiostreams_upscale::MIN_SCALE
}

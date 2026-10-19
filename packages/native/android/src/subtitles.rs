use aiostreams_container::{index_options, subtitle_timelines};
use jni::JNIEnv;
use jni::objects::{JByteArray, JClass, JObjectArray, JString};
use jni::sys::jstring;
use serde_json::json;

/// Backs `SubtitleTimeline.read`.
#[unsafe(no_mangle)]
pub extern "system" fn Java_io_github_viren070_aiostreams_natives_SubtitleTimeline_read(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
    headers: JObjectArray,
    ca_pem: JByteArray,
) -> jstring {
    let result = crate::http::reader(&mut env, &url, &headers, &ca_pem, index_options())
        .and_then(|mut r| subtitle_timelines(&mut r).map_err(|e| e.to_string()));
    let body = match result {
        Ok(tracks) => json!({
            "tracks": tracks
                .iter()
                .map(|t| json!({
                    "number": t.number,
                    "codec": t.codec,
                    "language": t.language,
                    "lines": t.lines,
                }))
                .collect::<Vec<_>>(),
        }),
        Err(error) => json!({ "error": error }),
    };
    env.new_string(body.to_string())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

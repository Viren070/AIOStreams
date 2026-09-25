//! libmpv's client API, loaded at runtime so builds need no import library.

use std::ffi::{CStr, CString, c_char, c_double, c_int, c_void};
use std::path::Path;
use std::ptr;

use libloading::Library;
use serde_json::Value;

const FORMAT_STRING: c_int = 1;
const FORMAT_FLAG: c_int = 3;
const FORMAT_DOUBLE: c_int = 5;

const EVENT_SHUTDOWN: c_int = 1;
const EVENT_LOG_MESSAGE: c_int = 2;
const EVENT_START_FILE: c_int = 6;
const EVENT_END_FILE: c_int = 7;
const EVENT_FILE_LOADED: c_int = 8;
const EVENT_SEEK: c_int = 20;
const EVENT_PLAYBACK_RESTART: c_int = 21;
const EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
struct RawEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct RawProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct RawEndFile {
    reason: c_int,
    error: c_int,
}

#[repr(C)]
struct RawLogMessage {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
}

pub(crate) type Handle = *mut c_void;

struct Api {
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(Handle),
    set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    get_property: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
    observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
    request_log_messages: unsafe extern "C" fn(Handle, *const c_char) -> c_int,
    wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut RawEvent,
    wakeup: unsafe extern "C" fn(Handle),
    free: unsafe extern "C" fn(*mut c_void),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    lib: Library,
}

impl Api {
    fn load(path: &Path) -> Result<Self, String> {
        // SAFETY: loading libmpv runs no initialisers that depend on us.
        let lib = unsafe { Library::new(path) }.map_err(|e| {
            // libloading keeps the loader's own reason in the source.
            let reason = std::error::Error::source(&e)
                .map(|s| format!(": {s}"))
                .unwrap_or_default();
            format!("could not load {}: {e}{reason}", path.display())
        })?;
        macro_rules! sym {
            ($name:literal) => {
                // SAFETY: the signatures match mpv's client.h.
                *unsafe { lib.get(concat!($name, "\0").as_bytes()) }
                    .map_err(|e| format!("{} is missing {}: {e}", path.display(), $name))?
            };
        }
        Ok(Self {
            create: sym!("mpv_create"),
            initialize: sym!("mpv_initialize"),
            terminate_destroy: sym!("mpv_terminate_destroy"),
            set_option_string: sym!("mpv_set_option_string"),
            command: sym!("mpv_command"),
            set_property_string: sym!("mpv_set_property_string"),
            get_property: sym!("mpv_get_property"),
            observe_property: sym!("mpv_observe_property"),
            request_log_messages: sym!("mpv_request_log_messages"),
            wait_event: sym!("mpv_wait_event"),
            wakeup: sym!("mpv_wakeup"),
            free: sym!("mpv_free"),
            error_string: sym!("mpv_error_string"),
            lib,
        })
    }
}

/// How a property's value is read; `Json` is a node property, which mpv prints as JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Flag,
    Double,
    String,
    Json,
}

impl Kind {
    fn format(self) -> c_int {
        match self {
            Kind::Flag => FORMAT_FLAG,
            Kind::Double => FORMAT_DOUBLE,
            Kind::String | Kind::Json => FORMAT_STRING,
        }
    }
}

#[derive(Debug)]
pub enum Event {
    Shutdown,
    Log {
        prefix: String,
        level: String,
        text: String,
    },
    StartFile,
    FileLoaded,
    EndFile {
        reason: &'static str,
        error: Option<String>,
    },
    Seek,
    PlaybackRestart,
    Property {
        name: String,
        id: u64,
        value: Value,
    },
}

pub struct Mpv {
    api: Api,
    handle: Handle,
}

// SAFETY: every client API function may be called from any thread.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn cstring(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| format!("{s:?} contains a NUL byte"))
}

fn text(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: mpv hands out NUL-terminated strings it owns for the call.
    unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
}

impl Mpv {
    pub fn new(library: &Path, options: &[(&str, &str)]) -> Result<Self, String> {
        let api = Api::load(library)?;
        // SAFETY: mpv_create has no preconditions.
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("mpv_create failed".into());
        }
        let mpv = Self { api, handle };
        for (name, value) in options {
            let (n, v) = (cstring(name)?, cstring(value)?);
            // SAFETY: valid handle and strings.
            let code = unsafe { (mpv.api.set_option_string)(mpv.handle, n.as_ptr(), v.as_ptr()) };
            if code < 0 {
                log::warn!("mpv option {name}={value}: {}", mpv.error(code));
            }
        }
        // SAFETY: valid handle, not yet initialised.
        mpv.check(unsafe { (mpv.api.initialize)(mpv.handle) })?;
        Ok(mpv)
    }

    pub(crate) fn handle(&self) -> Handle {
        self.handle
    }

    /// # Safety
    /// `T` must be the function's type as mpv declares it.
    pub(crate) unsafe fn symbol<T: Copy>(&self, name: &str) -> Result<T, String> {
        let n = cstring(name)?;
        // SAFETY: the caller vouches for the type.
        unsafe { self.api.lib.get::<T>(n.as_bytes_with_nul()) }
            .map(|s| *s)
            .map_err(|e| format!("libmpv is missing {name}: {e}"))
    }

    pub(crate) fn error(&self, code: c_int) -> String {
        // SAFETY: mpv_error_string returns a static string for any code.
        text(unsafe { (self.api.error_string)(code) })
    }

    fn check(&self, code: c_int) -> Result<(), String> {
        if code < 0 {
            Err(self.error(code))
        } else {
            Ok(())
        }
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let owned = args
            .iter()
            .map(|a| cstring(a))
            .collect::<Result<Vec<_>, _>>()?;
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(ptr::null());
        // SAFETY: a NULL-terminated array of valid strings.
        self.check(unsafe { (self.api.command)(self.handle, ptrs.as_mut_ptr()) })
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let (n, v) = (cstring(name)?, cstring(value)?);
        // SAFETY: valid handle and strings.
        self.check(unsafe { (self.api.set_property_string)(self.handle, n.as_ptr(), v.as_ptr()) })
    }

    pub fn get_property(&self, name: &str, kind: Kind) -> Option<Value> {
        let n = cstring(name).ok()?;
        match kind {
            Kind::Flag => {
                let mut v: c_int = 0;
                // SAFETY: FLAG writes one int.
                let code = unsafe {
                    (self.api.get_property)(
                        self.handle,
                        n.as_ptr(),
                        FORMAT_FLAG,
                        (&raw mut v).cast(),
                    )
                };
                (code >= 0).then_some(Value::Bool(v != 0))
            }
            Kind::Double => {
                let mut v: c_double = 0.0;
                // SAFETY: DOUBLE writes one double.
                let code = unsafe {
                    (self.api.get_property)(
                        self.handle,
                        n.as_ptr(),
                        FORMAT_DOUBLE,
                        (&raw mut v).cast(),
                    )
                };
                (code >= 0).then(|| serde_json::json!(v))
            }
            Kind::String | Kind::Json => {
                let mut v: *mut c_char = ptr::null_mut();
                // SAFETY: STRING writes a string mpv allocated, freed below.
                let code = unsafe {
                    (self.api.get_property)(
                        self.handle,
                        n.as_ptr(),
                        FORMAT_STRING,
                        (&raw mut v).cast(),
                    )
                };
                if code < 0 || v.is_null() {
                    return None;
                }
                let s = text(v);
                // SAFETY: allocated by mpv for this call.
                unsafe { (self.api.free)(v.cast()) };
                Some(string_value(s, kind))
            }
        }
    }

    pub fn observe(&self, name: &str, kind: Kind, id: u64) -> Result<(), String> {
        let n = cstring(name)?;
        // SAFETY: valid handle and string.
        self.check(unsafe {
            (self.api.observe_property)(self.handle, id, n.as_ptr(), kind.format())
        })
    }

    pub fn request_log_messages(&self, level: &str) -> Result<(), String> {
        let l = cstring(level)?;
        // SAFETY: valid handle and string.
        self.check(unsafe { (self.api.request_log_messages)(self.handle, l.as_ptr()) })
    }

    /// Only one thread may wait for events. `None` means the timeout passed.
    pub fn wait_event(&self, timeout: f64, json: impl Fn(u64) -> bool) -> Option<Event> {
        // SAFETY: the event stays valid until the next wait_event on this thread.
        let ev = unsafe { &*(self.api.wait_event)(self.handle, timeout) };
        Some(match ev.event_id {
            EVENT_SHUTDOWN => Event::Shutdown,
            EVENT_LOG_MESSAGE => {
                // SAFETY: LOG_MESSAGE carries mpv_event_log_message.
                let m = unsafe { &*(ev.data as *const RawLogMessage) };
                Event::Log {
                    prefix: text(m.prefix),
                    level: text(m.level),
                    text: text(m.text),
                }
            }
            EVENT_START_FILE => Event::StartFile,
            EVENT_FILE_LOADED => Event::FileLoaded,
            EVENT_END_FILE => {
                // SAFETY: END_FILE carries mpv_event_end_file.
                let e = unsafe { &*(ev.data as *const RawEndFile) };
                let reason = match e.reason {
                    0 => "eof",
                    2 => "stop",
                    3 => "quit",
                    4 => "error",
                    5 => "redirect",
                    _ => "unknown",
                };
                let error = (e.reason == 4).then(|| self.error(e.error));
                Event::EndFile { reason, error }
            }
            EVENT_SEEK => Event::Seek,
            EVENT_PLAYBACK_RESTART => Event::PlaybackRestart,
            EVENT_PROPERTY_CHANGE => {
                // SAFETY: PROPERTY_CHANGE carries mpv_event_property.
                let p = unsafe { &*(ev.data as *const RawProperty) };
                let id = ev.reply_userdata;
                // SAFETY: data matches format and is null when the value is unavailable.
                let value = unsafe {
                    if p.data.is_null() {
                        Value::Null
                    } else {
                        match p.format {
                            FORMAT_FLAG => Value::Bool(*(p.data as *const c_int) != 0),
                            FORMAT_DOUBLE => serde_json::json!(*(p.data as *const c_double)),
                            FORMAT_STRING => {
                                let kind = if json(id) { Kind::Json } else { Kind::String };
                                string_value(text(*(p.data as *const *const c_char)), kind)
                            }
                            _ => Value::Null,
                        }
                    }
                };
                Event::Property {
                    name: text(p.name),
                    id,
                    value,
                }
            }
            0 => return None,
            _ => return self.wait_event(0.0, json),
        })
    }

    pub fn wakeup(&self) {
        // SAFETY: valid handle.
        unsafe { (self.api.wakeup)(self.handle) }
    }
}

fn string_value(s: String, kind: Kind) -> Value {
    if kind == Kind::Json {
        serde_json::from_str(&s).unwrap_or(Value::Null)
    } else {
        Value::String(s)
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        // SAFETY: the handle is not used after this.
        unsafe { (self.api.terminate_destroy)(self.handle) }
    }
}

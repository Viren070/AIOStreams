//! Messages between the page and the shell. Anything the page asks of mpv is
//! checked here first, since a page must not reach local files or scripts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mpv::Kind;

/// Bumped when a message changes shape, so pages can tell shells apart.
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Inbound {
    MpvCommand {
        args: Vec<Value>,
    },
    MpvSetProp {
        name: String,
        value: Value,
    },
    /// Resends every observed property's current value.
    MpvSync,
    Fullscreen {
        value: Option<bool>,
    },
    Minimize,
    Close,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Outbound {
    MpvProp {
        name: String,
        data: Value,
    },
    MpvEvent {
        name: &'static str,
    },
    MpvEnded {
        reason: &'static str,
        error: Option<String>,
    },
    Fullscreen {
        value: bool,
    },
    Error {
        message: String,
    },
}

impl Outbound {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

pub const OBSERVED: &[(&str, Kind)] = &[
    ("time-pos", Kind::Double),
    ("duration", Kind::Double),
    ("demuxer-cache-time", Kind::Double),
    ("pause", Kind::Flag),
    ("paused-for-cache", Kind::Flag),
    ("seeking", Kind::Flag),
    ("idle-active", Kind::Flag),
    ("volume", Kind::Double),
    ("mute", Kind::Flag),
    ("speed", Kind::Double),
    ("aid", Kind::String),
    ("sid", Kind::String),
    ("track-list", Kind::Json),
    ("video-params", Kind::Json),
];

pub const THROTTLED: &[&str] = &["time-pos", "demuxer-cache-time"];
pub const THROTTLE_MS: u64 = 250;

const SETTABLE: &[&str] = &[
    "pause",
    "volume",
    "mute",
    "speed",
    "aid",
    "sid",
    "secondary-sid",
    "sub-delay",
    "audio-delay",
    "sub-scale",
    "sub-pos",
    "sub-visibility",
    "time-pos",
];

const LOADFILE_OPTIONS: &[&str] = &["start", "aid", "sid", "alang", "slang", "force-media-title"];

const SEEK_FLAGS: &[&str] = &[
    "relative",
    "absolute",
    "absolute-percent",
    "relative-percent",
    "keyframes",
    "exact",
];

pub fn origin(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .map(|u| u.origin().ascii_serialization())
}

fn is_web_url(s: &str) -> bool {
    url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

fn arg_string(v: &Value) -> Result<String, String> {
    match v {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(if *b { "yes" } else { "no" }.into()),
        _ => Err(format!("unsupported argument {v}")),
    }
}

fn check_options(options: &str) -> Result<(), String> {
    for pair in options.split(',').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').ok_or("options are key=value")?;
        if !LOADFILE_OPTIONS.contains(&key) {
            return Err(format!("option {key} is not allowed"));
        }
        // mpv reads %n% as a length prefix, which could smuggle in more options.
        if value.contains('%') {
            return Err(format!("option {key} has an unsupported value"));
        }
    }
    Ok(())
}

fn check_flags(flags: Option<&String>, allowed: &[&str]) -> Result<(), String> {
    match flags {
        Some(f) if !f.split('+').all(|p| allowed.contains(&p)) => {
            Err(format!("flags {f} are not allowed"))
        }
        _ => Ok(()),
    }
}

fn check_number(v: Option<&String>) -> Result<(), String> {
    match v {
        Some(n) if n.parse::<f64>().is_err() => Err(format!("{n} is not a number")),
        _ => Ok(()),
    }
}

pub fn command(args: &[Value]) -> Result<Vec<String>, String> {
    let args = args.iter().map(arg_string).collect::<Result<Vec<_>, _>>()?;
    let name = args.first().ok_or("empty command")?.as_str();
    match name {
        // loadfile <url> [<flags> [<index> [<options>]]]
        "loadfile" => {
            if !args.get(1).is_some_and(|u| is_web_url(u)) {
                return Err("loadfile takes an http(s) url".into());
            }
            check_flags(
                args.get(2),
                &[
                    "replace",
                    "append",
                    "append-play",
                    "insert-next",
                    "insert-next-play",
                ],
            )?;
            check_number(args.get(3))?;
            if let Some(options) = args.get(4) {
                check_options(options)?;
            }
            if args.len() > 5 {
                return Err("too many arguments".into());
            }
        }
        "sub-add" | "audio-add" => {
            if !args.get(1).is_some_and(|u| is_web_url(u)) {
                return Err(format!("{name} takes an http(s) url"));
            }
            check_flags(args.get(2), &["select", "auto", "cached"])?;
            if args.len() > 5 {
                return Err("too many arguments".into());
            }
        }
        "sub-remove" | "audio-remove" => {
            check_number(args.get(1))?;
            if args.len() > 2 {
                return Err("too many arguments".into());
            }
        }
        "seek" => {
            check_number(args.get(1))?;
            check_flags(args.get(2), SEEK_FLAGS)?;
            if args.len() > 3 {
                return Err("too many arguments".into());
            }
        }
        "stop" | "frame-step" | "frame-back-step" => {
            if args.len() > 1 {
                return Err("too many arguments".into());
            }
        }
        // Only the user's own input.conf binds keys, since default bindings are off.
        "keypress" => {
            if args.len() != 2 || args[1].is_empty() || args[1].chars().any(char::is_whitespace) {
                return Err("keypress takes one key name".into());
            }
        }
        "set" | "cycle" | "add" => {
            if !args.get(1).is_some_and(|p| SETTABLE.contains(&p.as_str())) {
                return Err(format!("{name} is not allowed on that property"));
            }
            if args.len() > 3 {
                return Err("too many arguments".into());
            }
        }
        _ => return Err(format!("command {name} is not allowed")),
    }
    Ok(args)
}

pub fn set_prop(name: &str, value: &Value) -> Result<String, String> {
    if !SETTABLE.contains(&name) {
        return Err(format!("property {name} is not settable"));
    }
    arg_string(value)
}

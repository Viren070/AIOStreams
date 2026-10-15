//! The page's player requests in mpv's terms, and mpv's reports in the page's.
//! The page names no mpv command or property, so it can't reach local files
//! or scripts through mpv.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::bridge::Outbound;
use crate::mpv::Kind;
use crate::sound::Sound;

pub const OBSERVED: &[(&str, Kind)] = &[
    ("time-pos", Kind::Double),
    ("duration", Kind::Double),
    ("demuxer-cache-time", Kind::Double),
    ("pause", Kind::Flag),
    ("paused-for-cache", Kind::Flag),
    ("seeking", Kind::Flag),
    ("idle-active", Kind::Flag),
    ("volume", Kind::Double),
    ("volume-max", Kind::Double),
    ("mute", Kind::Flag),
    ("speed", Kind::Double),
    ("aid", Kind::String),
    ("sid", Kind::String),
    ("track-list", Kind::Json),
    ("chapter-list", Kind::Json),
    ("fullscreen", Kind::Flag),
];

pub const THROTTLED: &[&str] = &["time-pos", "demuxer-cache-time"];
pub const THROTTLE_MS: u64 = 250;

const STATS_PAGES: &[&str] = &["1", "2", "3", "5"];

/// Picture subtitles keep their own size.
pub const IMAGE_SUBTITLE_CODECS: &[&str] = &["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"];

/// Tells an explicit `null` apart from a field left out.
fn present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleMode {
    #[default]
    Default,
    Always,
    Smart,
    Forced,
    None,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Load {
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub start_ms: f64,
    /// Plays after the current file rather than in its place.
    #[serde(default)]
    pub append: bool,
    #[serde(default)]
    pub audio_languages: Vec<String>,
    #[serde(default)]
    pub subtitle_languages: Vec<String>,
    #[serde(default)]
    pub subtitle_mode: SubtitleMode,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub paused: Option<bool>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub speed: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    pub audio: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub subtitle: Option<Option<String>>,
    pub subtitle_delay_ms: Option<f64>,
    pub fullscreen: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Fit,
    Crop,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Override {
    Scale,
    Force,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Font {
    SansSerif,
    Serif,
    Monospace,
    SerifMonospace,
    Casual,
    Cursive,
}

impl Font {
    /// libass knows generic names only through Linux's fontconfig.
    fn family(self) -> &'static str {
        let mac = cfg!(target_os = "macos");
        if cfg!(target_os = "linux") {
            return match self {
                Font::SansSerif => "sans-serif",
                Font::Serif => "serif",
                Font::Monospace => "monospace",
                Font::SerifMonospace => "Courier",
                Font::Casual => "Comic Sans MS",
                Font::Cursive => "cursive",
            };
        }
        match self {
            Font::SansSerif if mac => "Helvetica",
            Font::SansSerif => "Arial",
            Font::Serif => "Times New Roman",
            Font::Monospace if mac => "Menlo",
            Font::Monospace => "Consolas",
            Font::SerifMonospace => "Courier New",
            Font::Casual => "Comic Sans MS",
            Font::Cursive if mac => "Snell Roundhand",
            Font::Cursive => "Segoe Script",
        }
    }
}

/// Colours are `#AARRGGBB` or `#RRGGBB`, sizes in mpv's units.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLook {
    pub scale: f64,
    pub bold: bool,
    pub color: String,
    pub outline_color: String,
    pub outline_size: f64,
    #[serde(default)]
    pub shadow_size: f64,
    pub font: Option<Font>,
    pub back_color: String,
    #[serde(rename = "box")]
    pub boxed: bool,
    #[serde(rename = "override")]
    pub override_styles: Override,
    /// Percent of the height from the top where the bottom line sits.
    pub position: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub fit: Fit,
    pub subtitles: SubtitleLook,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hardware_decoding: bool,
    /// `auto`, `stereo`, `5.1` or `7.1`.
    pub audio_channels: String,
    /// The formats that pass through undecoded.
    #[serde(default)]
    pub passthrough: Vec<String>,
    #[serde(default)]
    pub audio_delay_ms: f64,
    pub audio_device: Option<String>,
    #[serde(default = "yes")]
    pub dolby_vision: bool,
    #[serde(flatten)]
    pub sound: Sound,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffered_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffering: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seeking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_volume: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
    pub default: bool,
    pub forced: bool,
    pub hearing_impaired: bool,
    pub visual_impaired: bool,
    pub external: bool,
    /// Where an added track was loaded from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub start_ms: f64,
}

fn is_web_url(s: &str) -> bool {
    url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

/// `local` says whether a path is one of the app's own downloads, the only files the page may open.
pub fn check_url(url: &str, local: &dyn Fn(&str) -> bool) -> Result<(), String> {
    if is_web_url(url) || local(url) {
        Ok(())
    } else {
        Err("only http(s) urls and downloads play".into())
    }
}

pub(crate) fn is_header_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

pub(crate) fn is_header_value(value: &str) -> bool {
    value.bytes().all(|b| (b' '..=b'~').contains(&b))
}

fn is_language(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 16
        && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn is_colour(colour: &str) -> bool {
    colour
        .strip_prefix('#')
        .is_some_and(|hex| matches!(hex.len(), 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn track_id(id: &Option<String>) -> Result<String, String> {
    match id {
        None => Ok("no".into()),
        Some(id) if id.parse::<u32>().is_ok() => Ok(id.clone()),
        Some(id) => Err(format!("track {id} is not a track")),
    }
}

fn flag(on: bool) -> String {
    if on { "yes" } else { "no" }.into()
}

fn seconds(ms: f64) -> String {
    format!("{:.3}", ms / 1000.0)
}

/// A `loadfile`, kept apart from its headers, which can carry credentials and stay out of logs.
pub struct Loadfile {
    pub url: String,
    flags: &'static str,
    pub options: Vec<String>,
    headers: Option<String>,
}

impl Loadfile {
    pub fn new(load: &Load, local: &dyn Fn(&str) -> bool) -> Result<Self, String> {
        check_url(&load.url, local)?;
        let mut options = Vec::new();
        if load.start_ms > 0.0 {
            options.push(format!("start={}", seconds(load.start_ms)));
        }
        let list = |name: &str, values: &[String]| -> Result<Vec<String>, String> {
            values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    if !is_language(v) {
                        return Err(format!("{v} is not a language"));
                    }
                    let suffix = if i > 0 { "-append" } else { "" };
                    Ok(format!("{name}{suffix}={v}"))
                })
                .collect()
        };
        options.extend(list("alang", &load.audio_languages)?);
        let slang = list("slang", &load.subtitle_languages)?;
        match load.subtitle_mode {
            SubtitleMode::None => options.push("sid=no".into()),
            SubtitleMode::Forced => options.extend([
                "subs-fallback=no".into(),
                "subs-fallback-forced=always".into(),
            ]),
            SubtitleMode::Always => {
                options.extend(slang);
                options.extend([
                    "subs-fallback=yes".into(),
                    "subs-with-matching-audio=yes".into(),
                ]);
            }
            SubtitleMode::Smart => {
                options.extend(slang);
                options.push("subs-with-matching-audio=no".into());
            }
            SubtitleMode::Default => options.extend(slang),
        }
        Ok(Self {
            url: load.url.clone(),
            flags: if load.append { "append" } else { "replace" },
            options,
            headers: header_fields(&load.headers)?,
        })
    }

    /// A queued file replaces whatever was queued before it.
    pub fn commands(&self) -> Vec<Vec<String>> {
        let mut options = self.options.clone();
        options.extend(self.headers.clone());
        let load = vec![
            "loadfile".into(),
            self.url.clone(),
            self.flags.into(),
            "-1".into(),
            options.join(","),
        ];
        if self.flags == "append" {
            vec![vec!["playlist-clear".into()], load]
        } else {
            vec![load]
        }
    }
}

fn header_fields(headers: &BTreeMap<String, String>) -> Result<Option<String>, String> {
    if headers.is_empty() {
        return Ok(None);
    }
    let mut fields = Vec::new();
    for (name, value) in headers {
        // A backslash before the list's separator would escape it.
        if !is_header_name(name) || !is_header_value(value) || value.ends_with('\\') {
            return Err(format!("header {name} is not allowed"));
        }
        fields.push(format!("{name}: {}", value.replace(',', "\\,")));
    }
    let list = fields.join(",");
    // The length prefix keeps the list's commas inside the one option.
    Ok(Some(format!("http-header-fields=%{}%{list}", list.len())))
}

pub fn change(change: &Change) -> Result<Vec<(&'static str, String)>, String> {
    let mut props = Vec::new();
    if let Some(paused) = change.paused {
        props.push(("pause", flag(paused)));
    }
    if let Some(volume) = change.volume {
        props.push(("volume", format!("{}", (volume * 100.0).round())));
    }
    if let Some(muted) = change.muted {
        props.push(("mute", flag(muted)));
    }
    if let Some(speed) = change.speed {
        props.push(("speed", speed.to_string()));
    }
    if let Some(audio) = &change.audio {
        props.push(("aid", track_id(audio)?));
    }
    if let Some(subtitle) = &change.subtitle {
        props.push(("sid", track_id(subtitle)?));
    }
    if let Some(delay) = change.subtitle_delay_ms {
        props.push(("sub-delay", seconds(delay)));
    }
    if let Some(fullscreen) = change.fullscreen {
        props.push(("fullscreen", flag(fullscreen)));
    }
    Ok(props)
}

/// Everything but `sub-scale`, which waits on whether the subtitle is a picture.
/// `own_font` is mpv's font from before the page set one.
pub fn style(style: &Style, own_font: &str) -> Result<Vec<(&'static str, String)>, String> {
    let s = &style.subtitles;
    for colour in [&s.color, &s.outline_color, &s.back_color] {
        if !is_colour(colour) {
            return Err(format!("{colour} is not a colour"));
        }
    }
    Ok(vec![
        ("keepaspect", flag(style.fit != Fit::Stretch)),
        (
            "panscan",
            if style.fit == Fit::Crop { "1" } else { "0" }.into(),
        ),
        ("sub-ass-force-margins", flag(style.fit == Fit::Crop)),
        ("sub-bold", flag(s.bold)),
        ("sub-color", s.color.clone()),
        ("sub-outline-color", s.outline_color.clone()),
        ("sub-outline-size", s.outline_size.to_string()),
        ("sub-shadow-offset", s.shadow_size.to_string()),
        ("sub-shadow-color", s.outline_color.clone()),
        (
            "sub-font",
            s.font
                .map_or_else(|| own_font.into(), |f| f.family().into()),
        ),
        ("sub-back-color", s.back_color.clone()),
        (
            "sub-border-style",
            if s.boxed {
                "background-box"
            } else {
                "outline-and-shadow"
            }
            .into(),
        ),
        (
            "sub-ass-override",
            match s.override_styles {
                Override::Force => "force",
                Override::Scale => "scale",
            }
            .into(),
        ),
        ("sub-pos", s.position.round().to_string()),
    ])
}

/// `hwdec` is the device's own choice of decoding, with hardware decoding on.
pub fn settings(settings: &Settings, hwdec: &str) -> Vec<(&'static str, String)> {
    let mut props = vec![
        (
            "hwdec",
            if settings.hardware_decoding {
                hwdec
            } else {
                "no"
            }
            .into(),
        ),
        (
            "audio-channels",
            match settings.audio_channels.as_str() {
                "stereo" | "5.1" | "7.1" => settings.audio_channels.clone(),
                _ => "auto-safe".into(),
            },
        ),
        ("audio-spdif", settings.passthrough.join(",")),
        ("audio-delay", seconds(settings.audio_delay_ms)),
    ];
    if let Some(device) = &settings.audio_device {
        props.push(("audio-device", device.clone()));
    }
    props
}

/// The stats overlay's bindings that move it from `shown` to `page`; a page toggle hides it when shown.
pub fn stats_overlay(shown: Option<&str>, page: Option<&str>) -> Result<Vec<Vec<String>>, String> {
    if page.is_some_and(|p| !STATS_PAGES.contains(&p)) {
        return Err("no such stats page".into());
    }
    let binding = |name: String| vec!["script-binding".into(), name];
    let mut commands = Vec::new();
    if shown.is_some() {
        commands.push(binding("stats/display-stats-toggle".into()));
    }
    if let Some(page) = page {
        commands.push(binding(format!("stats/display-page-{page}-toggle")));
    }
    Ok(commands)
}

fn chapters(value: &Value) -> Vec<Chapter> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| Chapter {
            title: c["title"].as_str().map(String::from),
            start_ms: c["time"].as_f64().unwrap_or(0.0) * 1000.0,
        })
        .collect()
}

fn tracks(value: &Value) -> Vec<Track> {
    let text = |t: &Value, key: &str| t[key].as_str().map(String::from);
    let on = |t: &Value, key: &str| t[key].as_bool() == Some(true);
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let kind = match t["type"].as_str()? {
                "audio" => "audio",
                "sub" => "subtitle",
                _ => return None,
            };
            Some(Track {
                id: t["id"].as_u64()?.to_string(),
                kind,
                title: text(t, "title"),
                language: text(t, "lang"),
                codec: text(t, "codec"),
                default: on(t, "default"),
                forced: on(t, "forced"),
                hearing_impaired: on(t, "hearing-impaired"),
                visual_impaired: on(t, "visual-impaired"),
                external: on(t, "external"),
                url: text(t, "external-filename"),
            })
        })
        .collect()
}

/// mpv reads a track id as `auto` until a file picks one.
fn track(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| s.bytes().all(|b| b.is_ascii_digit()) && !s.is_empty())
        .map(String::from)
}

/// The page's view of an observed property's change.
pub fn report(name: &str, value: &Value, external: bool) -> Option<Outbound> {
    let num = value.as_f64();
    let on = Some(value == true);
    let mut state = PlayerState::default();
    match name {
        "time-pos" => state.position_ms = Some(num? * 1000.0),
        "duration" => state.duration_ms = Some(num? * 1000.0),
        "demuxer-cache-time" => state.buffered_ms = Some(num? * 1000.0),
        "pause" => state.paused = on,
        "paused-for-cache" => state.buffering = on,
        "seeking" => state.seeking = on,
        "idle-active" => state.idle = on,
        "volume" => state.volume = Some(num? / 100.0),
        "volume-max" => state.max_volume = Some(num? / 100.0),
        "mute" => state.muted = on,
        "speed" => state.speed = num,
        "aid" => state.audio = Some(track(value)),
        "sid" => state.subtitle = Some(track(value)),
        // The app's own window follows the page's full screen.
        "fullscreen" if external => state.fullscreen = on,
        "track-list" => {
            return Some(Outbound::PlayerTracks {
                tracks: tracks(value),
                external,
            });
        }
        "chapter-list" => {
            return Some(Outbound::PlayerChapters {
                chapters: chapters(value),
                external,
            });
        }
        _ => return None,
    }
    Some(Outbound::PlayerState { state, external })
}

pub fn event(name: &str, external: bool) -> Option<Outbound> {
    let name = match name {
        "start-file" => "start",
        "file-loaded" => "loaded",
        "playback-restart" => "restart",
        _ => return None,
    };
    Some(Outbound::PlayerEvent { name, external })
}

/// `cause` is the reader's first error, which says why loading failed.
pub fn ended(
    reason: &'static str,
    error: Option<String>,
    cause: Option<String>,
    external: bool,
) -> Outbound {
    let status = cause.as_deref().and_then(|c| {
        let code = c.split("HTTP error ").nth(1)?.get(..3)?;
        code.parse().ok()
    });
    Outbound::PlayerEnded {
        reason,
        error,
        status,
        cause,
        external,
    }
}

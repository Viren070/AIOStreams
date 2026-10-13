//! The page's sound settings that mpv has no option for, as labelled audio
//! filters around a user's own `af`.

use serde::Deserialize;
use serde_json::Value;

use crate::mpv::{Kind, Mpv};

const SOUND_FILTER: &str = "@aiostreams-sound";
const AC3_FILTER: &str = "@aiostreams-ac3";

const COMPRESSOR: &str = "acompressor=threshold=0.063:ratio=6:attack=5:release=300:makeup=4";
/// Catches what the boosts push past full scale.
const LIMITER: &str = "alimiter=limit=0.891:level=disabled";

/// FFmpeg's layouts with a centre channel, which each have it third.
const CENTRED: &[&str] = &[
    "3.0",
    "3.1",
    "4.0",
    "4.1",
    "5.0",
    "5.0(side)",
    "5.1",
    "5.1(side)",
    "6.0",
    "hexagonal",
    "6.1",
    "6.1(back)",
    "7.0",
    "7.0(front)",
    "7.1",
    "7.1(wide)",
    "7.1(wide-side)",
    "7.1(top)",
    "octagonal",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Sound {
    /// Decibels the centre channel is raised by.
    pub dialogue_boost: u8,
    pub night_mode: bool,
    pub ac3_encode: bool,
}

/// mpv's error for an output that won't take what passes through, the encoder's AC-3 included.
const REFUSED: &str = "Passthrough format unsupported";

/// The decoded layout, or `None` while nothing decodes or the sound passes through.
fn layout(params: &Value) -> Option<(String, usize)> {
    let format = params.get("format")?.as_str()?;
    if format.starts_with("spdif") {
        return None;
    }
    let channels = params.get("channels")?.as_str()?;
    let count = params.get("channel-count")?.as_u64()? as usize;
    Some((channels.to_string(), count))
}

/// The audio track's layout as the file loads, or `None` where it will pass through.
fn track_layout(mpv: &Mpv) -> Option<(String, usize)> {
    let track = mpv.get_property("current-tracks/audio", Kind::Json)?;
    let codec = track.get("codec")?.as_str()?;
    let passes = spdif(mpv)
        .iter()
        .any(|f| f == codec || (codec == "dts" && f == "dts-hd"));
    if passes {
        return None;
    }
    let channels = track.get("demux-channels")?.as_str()?;
    let count = track.get("demux-channel-count")?.as_u64()? as usize;
    Some((channels.to_string(), count))
}

fn spdif(mpv: &Mpv) -> Vec<String> {
    match mpv.get_property("audio-spdif", Kind::String) {
        Some(Value::String(list)) => list.split(',').map(String::from).collect(),
        _ => Vec::new(),
    }
}

/// `pan` raising the centre channel, where the layout has one beside the front pair.
fn centre_boost(channels: &str, count: usize, db: u8) -> Option<String> {
    let layout = if CENTRED.contains(&channels) {
        channels.to_string()
    } else if channels.starts_with("fl-fr-fc-") {
        channels
            .split('-')
            .map(str::to_uppercase)
            .collect::<Vec<_>>()
            .join("+")
    } else {
        return None;
    };
    let gain = 10f64.powf(f64::from(db) / 20.0);
    let gains = (0..count).map(|i| match i {
        2 => format!("c2={gain:.3}*c2"),
        _ => format!("c{i}=c{i}"),
    });
    Some(
        std::iter::once(layout)
            .chain(gains)
            .collect::<Vec<_>>()
            .join("|"),
    )
}

fn graph(sound: Sound, channels: &str, count: usize) -> Option<String> {
    let mut filters = Vec::new();
    if sound.dialogue_boost > 0
        && let Some(pan) = centre_boost(channels, count, sound.dialogue_boost)
    {
        filters.push(format!("pan={pan}"));
    }
    if sound.night_mode {
        filters.push(COMPRESSOR.into());
    }
    if filters.is_empty() {
        return None;
    }
    filters.push(LIMITER.into());
    Some(format!("lavfi=[{}]", filters.join(",")))
}

/// Keeps the filters in step with the settings and with what mpv decodes.
#[derive(Default)]
pub struct Filters {
    layout: Option<(String, usize)>,
    graph: Option<String>,
    ac3: bool,
    /// The output refused the encoder's AC-3 in this file.
    refused: bool,
}

impl Filters {
    /// The last file's filters may not fit this one's sound.
    pub fn start_file(&mut self) {
        self.layout = None;
        self.refused = false;
    }

    /// From the audio track, so the filters are in before the sound starts.
    pub fn loaded(&mut self, mpv: &Mpv) {
        self.layout = track_layout(mpv);
    }

    /// From `audio-params`, which says what mpv decodes once it starts.
    pub fn decoded(&mut self, params: &Value) {
        self.layout = layout(params);
    }

    /// Whether mpv's log says the output refused the encoder's AC-3, which then stops for the file.
    pub fn refused(&mut self, prefix: &str, text: &str) -> bool {
        let refused = self.ac3 && prefix == "cplayer" && text.starts_with(REFUSED);
        if refused {
            log::warn!("the output refused AC-3, so this file plays without encoding");
            self.refused = true;
        }
        refused
    }

    pub fn apply(&mut self, mpv: &Mpv, sound: Sound) {
        let (graph, ac3) = match &self.layout {
            Some((channels, count)) => (
                graph(sound, channels, *count),
                sound.ac3_encode
                    && *count > 2
                    && !self.refused
                    && spdif(mpv).iter().any(|f| f == "ac3"),
            ),
            None => (None, false),
        };
        if graph != self.graph {
            if self.graph.take().is_some() {
                edit(mpv, "remove", SOUND_FILTER);
            }
            // First, so the user's own filters and the encoder come after it.
            if let Some(g) = graph
                && edit(mpv, "pre", &format!("{SOUND_FILTER}:{g}"))
            {
                self.graph = Some(g);
            }
        }
        if ac3 != self.ac3 {
            let done = if ac3 {
                edit(mpv, "add", &format!("{AC3_FILTER}:lavcac3enc"))
            } else {
                edit(mpv, "remove", AC3_FILTER)
            };
            if done {
                self.ac3 = ac3;
            }
        }
    }
}

fn edit(mpv: &Mpv, operation: &str, filter: &str) -> bool {
    match mpv.command(&["af", operation, filter]) {
        Ok(()) => {
            log::info!("af {operation} {filter}");
            true
        }
        Err(e) => {
            log::warn!("mpv af {operation} {filter}: {e}");
            false
        }
    }
}

/// Whether mpv's FFmpeg has an AC-3 encoder.
pub fn encodes_ac3(mpv: &Mpv) -> bool {
    mpv.get_property("encoder-list", Kind::Json)
        .and_then(|list| {
            list.as_array().map(|l| {
                l.iter()
                    .any(|e| e.get("driver").and_then(Value::as_str) == Some("ac3"))
            })
        })
        .unwrap_or(false)
}

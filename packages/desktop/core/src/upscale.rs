//! The picture's upscaling: the anime shader in mpv's list, or the graphics card's own.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::mpv::{Kind, Mpv};

const HDR_GAMMAS: [&str; 2] = ["pq", "hlg"];
const DROP_CHECK_EVERY: Duration = Duration::from_secs(5);
const DROP_PERCENT: f64 = 20.0;
/// Fewer frames than this in a check is a stall, which says nothing about the graphics chip.
const MIN_FRAMES: f64 = 30.0;
/// The graphics card's filter, by its label in mpv's list.
const CARD_FILTER: &str = "@aiostreams-upscale";
const MAX_CARD_SCALE: f64 = 4.0;

/// The screen the video shows on, and the card drawing it.
#[derive(Clone, Copy, Debug)]
pub struct Display {
    pub width: f64,
    pub height: f64,
    /// The filter's `scaling-mode` for the card.
    pub scaling: &'static str,
    /// The card turns SDR video into HDR, on a screen in HDR mode.
    pub hdr: bool,
}

/// The screen under the video, where the graphics card can upscale.
pub type DisplayProbe = Arc<dyn Fn() -> Option<Display> + Send + Sync>;

#[derive(Clone, Debug, PartialEq)]
enum Applied {
    None,
    Shader,
    Card(String),
}

impl fmt::Display for Applied {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Applied::None => f.write_str("off"),
            Applied::Shader => f.write_str("shader"),
            Applied::Card(options) => write!(f, "card filter={options}"),
        }
    }
}

/// Keeps one upscaler in mpv while it's wanted; the rest of the shader and filter lists are the user's.
pub struct Upscale {
    file: PathBuf,
    written: bool,
    /// Anime upscaling, which takes a file over from the card.
    anime: bool,
    card: bool,
    /// None where the card can't upscale.
    display: Option<DisplayProbe>,
    /// HDR or too slow, for this file.
    blocked: bool,
    /// An SDR video's shown size, once its colour is known.
    video: Option<(f64, f64)>,
    applied: Applied,
    drops_seen: f64,
    time_seen: f64,
    next_check: Instant,
}

impl Upscale {
    pub fn new(file: PathBuf, display: Option<DisplayProbe>) -> Self {
        Self {
            file,
            written: false,
            anime: false,
            card: false,
            display,
            blocked: false,
            video: None,
            applied: Applied::None,
            drops_seen: 0.0,
            time_seen: 0.0,
            next_check: Instant::now(),
        }
    }

    pub fn set(&mut self, mpv: &Mpv, anime: bool, card: bool) {
        if (self.anime, self.card) != (anime, card) {
            (self.anime, self.card) = (anime, card);
            self.apply(mpv);
        }
    }

    pub fn file_loaded(&mut self, mpv: &Mpv) {
        self.blocked = false;
        self.video = None;
        self.drops_seen = 0.0;
        self.time_seen = 0.0;
        self.next_check = Instant::now() + DROP_CHECK_EVERY;
        self.apply(mpv);
    }

    pub fn video_gamma(&mut self, mpv: &Mpv, gamma: Option<&str>) {
        if gamma.is_some_and(|gamma| HDR_GAMMAS.contains(&gamma)) {
            self.block(mpv, "HDR");
        } else if gamma.is_some() && self.video.is_none() {
            let size = |name| mpv.get_property(name, Kind::Double)?.as_f64();
            if let (Some(width), Some(height)) = (size("video-params/dw"), size("video-params/dh"))
            {
                self.video = Some((width, height));
                self.apply(mpv);
            }
        }
    }

    pub fn display_changed(&mut self, mpv: &Mpv) {
        self.apply(mpv);
    }

    /// Whatever made the frames late, a video that drops them is better off without upscaling.
    pub fn check_drops(&mut self, mpv: &Mpv) {
        if self.applied == Applied::None || Instant::now() < self.next_check {
            return;
        }
        self.next_check = Instant::now() + DROP_CHECK_EVERY;
        let number = |name| mpv.get_property(name, Kind::Double)?.as_f64();
        // Not `estimated-frame-number`, which trusts a container's frame rate that some overstate.
        let (Some(drops), Some(time), Some(fps)) = (
            number("frame-drop-count"),
            number("time-pos"),
            number("estimated-vf-fps"),
        ) else {
            return;
        };
        let dropped = drops - self.drops_seen;
        let played = (time - self.time_seen) * fps;
        self.drops_seen = drops;
        self.time_seen = time;
        if played >= MIN_FRAMES && dropped * 100.0 >= played * DROP_PERCENT {
            self.block(mpv, &format!("{dropped} of {played:.0} frames dropped"));
        }
    }

    fn block(&mut self, mpv: &Mpv, why: &str) {
        if self.blocked {
            return;
        }
        if self.anime || self.card {
            log::info!("no upscaling for this file: {why}");
        }
        self.blocked = true;
        self.apply(mpv);
    }

    fn wanted(&self) -> Applied {
        if self.blocked {
            return Applied::None;
        }
        if self.anime {
            return Applied::Shader;
        }
        let display = match &self.display {
            Some(probe) if self.card => probe(),
            _ => None,
        };
        let Some(display) = display else {
            return Applied::None;
        };
        let Some((width, height)) = self.video else {
            // Until the colour is known the last file's filter stays: the next episode usually needs it unchanged.
            return match self.applied {
                Applied::Card(_) => self.applied.clone(),
                _ => Applied::None,
            };
        };
        card_filter(display, width, height).map_or(Applied::None, Applied::Card)
    }

    fn apply(&mut self, mpv: &Mpv) {
        let wanted = self.wanted();
        if wanted == self.applied {
            return;
        }
        // A filter added under a label replaces the one there.
        let replaces = matches!(
            (&self.applied, &wanted),
            (Applied::Card(_), Applied::Card(_))
        );
        if (replaces || self.take_off(mpv)) && self.put_on(mpv, &wanted) {
            log::info!("upscaling {wanted}");
            self.applied = wanted;
        }
    }

    fn take_off(&mut self, mpv: &Mpv) -> bool {
        let file = self.file.to_string_lossy();
        let result = match self.applied {
            Applied::None => return true,
            Applied::Shader => mpv.command(&["change-list", "glsl-shaders", "remove", &file]),
            Applied::Card(_) => mpv.command(&["vf", "remove", CARD_FILTER]),
        };
        match result {
            Ok(()) => {
                self.applied = Applied::None;
                true
            }
            Err(e) => {
                log::warn!("mpv upscaling {} off: {e}", self.applied);
                false
            }
        }
    }

    fn put_on(&mut self, mpv: &Mpv, wanted: &Applied) -> bool {
        let result = match wanted {
            Applied::None => return true,
            Applied::Shader => {
                if !self.write() {
                    return false;
                }
                let file = self.file.to_string_lossy();
                mpv.command(&["change-list", "glsl-shaders", "append", &file])
            }
            Applied::Card(options) => {
                mpv.command(&["vf", "add", &format!("{CARD_FILTER}:{options}")])
            }
        };
        result
            .map_err(|e| log::warn!("mpv upscaling {wanted}: {e}"))
            .is_ok()
    }

    fn write(&mut self) -> bool {
        if !self.written {
            match std::fs::write(&self.file, aiostreams_upscale::MPV_SHADER) {
                Ok(()) => self.written = true,
                Err(e) => log::warn!("upscaling shader: {e}"),
            }
        }
        self.written
    }
}

/// The card filter for a video shown this size, sized to fill the screen; none where it would do nothing.
fn card_filter(display: Display, width: f64, height: f64) -> Option<String> {
    if width < 1.0 || height < 1.0 {
        return None;
    }
    let fit = (display.width / width)
        .min(display.height / height)
        .min(MAX_CARD_SCALE);
    let scale = if fit >= f64::from(aiostreams_upscale::MIN_SCALE) {
        fit
    } else {
        1.0
    };
    if scale == 1.0 && !display.hdr {
        return None;
    }
    let mut options = format!("d3d11vpp=scaling-mode={}:scale={scale:.2}", display.scaling);
    if display.hdr {
        options.push_str(":nvidia-true-hdr");
    }
    Some(options)
}

//! Anime upscaling, as a shader in mpv's list.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::mpv::{Kind, Mpv};

const HDR_GAMMAS: [&str; 2] = ["pq", "hlg"];
const DROP_CHECK_EVERY: Duration = Duration::from_secs(5);
const DROP_PERCENT: f64 = 20.0;
/// Fewer frames than this in a check is a stall, which says nothing about the graphics chip.
const MIN_FRAMES: f64 = 30.0;

/// Keeps the hook in mpv's shader list while it's wanted; the rest of the list is the user's.
pub struct Upscale {
    file: PathBuf,
    written: bool,
    on: bool,
    /// HDR or too slow, for this file.
    blocked: bool,
    applied: bool,
    drops_seen: f64,
    time_seen: f64,
    next_check: Instant,
}

impl Upscale {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            written: false,
            on: false,
            blocked: false,
            applied: false,
            drops_seen: 0.0,
            time_seen: 0.0,
            next_check: Instant::now(),
        }
    }

    pub fn set(&mut self, mpv: &Mpv, on: bool) {
        if self.on != on {
            self.on = on;
            self.apply(mpv);
        }
    }

    pub fn file_loaded(&mut self, mpv: &Mpv) {
        self.blocked = false;
        self.drops_seen = 0.0;
        self.time_seen = 0.0;
        self.next_check = Instant::now() + DROP_CHECK_EVERY;
        self.apply(mpv);
    }

    pub fn video_gamma(&mut self, mpv: &Mpv, gamma: Option<&str>) {
        if gamma.is_some_and(|gamma| HDR_GAMMAS.contains(&gamma)) {
            self.block(mpv, "HDR");
        }
    }

    /// Whatever made the frames late, a video that drops them is better off without the hook.
    pub fn check_drops(&mut self, mpv: &Mpv) {
        if !self.applied || Instant::now() < self.next_check {
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
        if self.on {
            log::info!("no upscaling for this file: {why}");
        }
        self.blocked = true;
        self.apply(mpv);
    }

    fn apply(&mut self, mpv: &Mpv) {
        let wanted = self.on && !self.blocked;
        if wanted == self.applied || (wanted && !self.write()) {
            return;
        }
        let file = self.file.to_string_lossy();
        let action = if wanted { "append" } else { "remove" };
        match mpv.command(&["change-list", "glsl-shaders", action, &file]) {
            Ok(()) => {
                log::info!("upscaling applied={wanted}");
                self.applied = wanted;
            }
            Err(e) => log::warn!("mpv glsl-shaders {action}: {e}"),
        }
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

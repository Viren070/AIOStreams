//! The window shrunk to its video, over other windows.

use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::window::{Fullscreen, Window};

use super::{on_screen, record};
use crate::placement::{MIN_SIZE, PIP_MIN_WIDTH, PipPlacement, Placement};
use crate::platform;

const DEFAULT_ASPECT: f64 = 16.0 / 9.0;
/// Of the screen's width, until the user sizes it.
const SHARE: f64 = 0.25;
const WIDTH: (f64, f64) = (360.0, 640.0);
const MARGIN: f64 = 16.0;
/// macOS puts the window's old frame back as its full-screen animation ends, so it shrinks after.
const FULLSCREEN_ANIMATES: bool = cfg!(target_os = "macos");

/// Meanwhile the saved placement holds the full window, which the next start opens at.
pub struct Pip {
    fullscreen: bool,
    maximized: bool,
    shrunk: bool,
}

/// True if it changed.
pub fn set(
    pip: &mut Option<Pip>,
    on: bool,
    window: &Window,
    placement: &mut Placement,
    remaximize: &mut bool,
) -> bool {
    match (on, pip.take()) {
        (true, None) => *pip = Some(Pip::enter(window, placement, remaximize)),
        (false, Some(small)) => small.leave(window, placement, remaximize),
        (_, same) => {
            *pip = same;
            return false;
        }
    }
    log::info!("picture-in-picture {}", if on { "on" } else { "off" });
    true
}

impl Pip {
    fn enter(window: &Window, placement: &mut Placement, remaximize: &mut bool) -> Self {
        let fullscreen = window.fullscreen().is_some();
        let maximized = if fullscreen {
            window.set_fullscreen(None);
            std::mem::take(remaximize)
        } else {
            window.is_maximized()
        };
        let mut pip = Self {
            fullscreen,
            maximized,
            shrunk: false,
        };
        let waits = fullscreen && FULLSCREEN_ANIMATES;
        if !waits {
            pip.shrink(window, placement);
        }
        pip
    }

    /// True if it shrank now.
    pub fn shrink(&mut self, window: &Window, placement: &mut Placement) -> bool {
        if std::mem::replace(&mut self.shrunk, true) {
            return false;
        }
        if window.is_maximized() {
            window.set_maximized(false);
        }
        record(window, placement);
        placement.maximized = self.maximized;

        let aspect = crate::video_aspect()
            .filter(|a| (0.25..=4.0).contains(a))
            .unwrap_or(DEFAULT_ASPECT);
        let scale = window.scale_factor();
        let area = platform::work_area(window).or_else(|| {
            let monitor = window.current_monitor()?;
            Some((monitor.position(), monitor.size()))
        });
        let width = placement.pip.map_or_else(
            || {
                area.map_or(WIDTH.0, |(_, size)| f64::from(size.width) / scale * SHARE)
                    .clamp(WIDTH.0, WIDTH.1)
            },
            |saved| f64::from(saved.width),
        );
        let min = f64::from(PIP_MIN_WIDTH);
        let small = LogicalSize::new(width, width / aspect);
        window.set_maximizable(false);
        window.set_min_inner_size(Some(LogicalSize::new(min, min / aspect)));
        window.set_inner_size(small);
        let saved = placement
            .pip
            .map(|saved| saved.position)
            .filter(|&at| on_screen(window.available_monitors(), at, width as u32));
        // The frame's invisible edges stay out of the margin, and macOS resizes the window later.
        let corner = area.map(|(origin, size)| {
            let inset = match (window.inner_position(), window.outer_position()) {
                (Ok(inner), Ok(outer)) => (inner.x - outer.x, inner.y - outer.y),
                _ => (0, 0),
            };
            let (inner, margin) = (small.to_physical::<i32>(scale), (MARGIN * scale) as i32);
            (
                origin.x + size.width as i32 - margin - inner.width - inset.0,
                origin.y + size.height as i32 - margin - inner.height - inset.1,
            )
        });
        if let Some((x, y)) = saved.or(corner) {
            window.set_outer_position(PhysicalPosition::new(x, y));
        }
        window.set_always_on_top(true);
        platform::keep_aspect(window, Some(aspect));
        #[cfg(target_os = "macos")]
        platform::set_pip(window, true);
        true
    }

    fn leave(self, window: &Window, placement: &mut Placement, remaximize: &mut bool) {
        if self.shrunk {
            self.record(window, placement);
            platform::keep_aspect(window, None);
            window.set_always_on_top(false);
            window.set_maximizable(true);
            window.set_min_inner_size(Some(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1)));
            window.set_inner_size(LogicalSize::new(placement.width, placement.height));
            if let Some((x, y)) = placement.position {
                window.set_outer_position(PhysicalPosition::new(x, y));
            }
            #[cfg(target_os = "macos")]
            platform::set_pip(window, false);
        }
        // Maximized again when full screen ends, as set_fullscreen arranges.
        if self.fullscreen {
            *remaximize = self.maximized;
            window.set_fullscreen(Some(Fullscreen::Borderless(None)));
        } else if self.maximized {
            window.set_maximized(true);
        }
    }

    pub fn record(&self, window: &Window, placement: &mut Placement) {
        if !self.shrunk || window.is_minimized() {
            return;
        }
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        if let Ok(at) = window.outer_position() {
            placement.pip = Some(PipPlacement {
                width: size.width.round() as u32,
                position: (at.x, at.y),
            });
        }
    }
}

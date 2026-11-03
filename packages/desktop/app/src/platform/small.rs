use std::time::{Duration, Instant};

use aiostreams_desktop_core::bridge::{Outbound, VideoFrame};

/// As the page's card moves.
const MOVE: Duration = Duration::from_millis(220);
/// A press that moves less than this is a click.
const SLOP: f64 = 4.0;

/// The page's `cubic-bezier(0.2, 0.8, 0.2, 1)`.
fn ease(t: f64) -> f64 {
    let curve = |a: f64, b: f64, s: f64| {
        3.0 * a * s * (1.0 - s).powi(2) + 3.0 * b * s * s * (1.0 - s) + s.powi(3)
    };
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..24 {
        let mid = (low + high) / 2.0;
        if curve(0.2, 0.2, mid) < t {
            low = mid;
        } else {
            high = mid;
        }
    }
    curve(0.8, 1.0, (low + high) / 2.0)
}

pub fn event(name: &'static str, at: Option<(f64, f64)>) -> Outbound {
    Outbound::PlayerFrame {
        event: name,
        x: at.map(|(x, _)| x),
        y: at.map(|(_, y)| y),
    }
}

/// The video small over the page, as its mini player last placed it, in the page's pixels.
/// A drag is taken here, as the page would trail it, and the page hears where it let go.
pub struct Small {
    pub at: (f64, f64),
    pub size: (f64, f64),
    /// The top corners' and the bottom corners'.
    pub radii: (f64, f64),
    pub hidden: bool,
    draggable: bool,
    press: Option<Press>,
    glide: Option<Glide>,
}

struct Press {
    cursor: (f64, f64),
    from: (f64, f64),
    dragging: bool,
}

struct Glide {
    from: (f64, f64),
    to: (f64, f64),
    started: Instant,
}

impl Small {
    /// Glides from where `last` shows when the frame asks to.
    pub fn new(frame: &VideoFrame, last: Option<&Small>) -> Self {
        let to = (frame.x, frame.y);
        let from = last
            .filter(|last| !last.hidden && frame.animate && !frame.hidden)
            .map(|last| last.at);
        Self {
            at: from.unwrap_or(to),
            size: (frame.width, frame.height),
            radii: (frame.radius, frame.bottom_radius),
            hidden: frame.hidden,
            draggable: frame.draggable,
            press: None,
            glide: from.map(|from| Glide {
                from,
                to,
                started: Instant::now(),
            }),
        }
    }

    pub fn gliding(&self) -> bool {
        self.glide.is_some()
    }

    /// Moves along the glide; false once it is over.
    pub fn step(&mut self) -> bool {
        let Some(glide) = &self.glide else {
            return false;
        };
        let t = (glide.started.elapsed().as_secs_f64() / MOVE.as_secs_f64()).min(1.0);
        let eased = ease(t);
        let towards = |from: f64, to: f64| from + (to - from) * eased;
        self.at = (
            towards(glide.from.0, glide.to.0),
            towards(glide.from.1, glide.to.1),
        );
        if t >= 1.0 {
            self.glide = None;
        }
        self.glide.is_some()
    }

    /// False where the video is hidden.
    pub fn press(&mut self, cursor: (f64, f64)) -> bool {
        if self.hidden {
            return false;
        }
        self.glide = None;
        self.press = Some(Press {
            cursor,
            from: self.at,
            dragging: false,
        });
        true
    }

    /// Follows the cursor, inside `room`, once the press is past a click; true as the drag starts.
    pub fn drag(&mut self, cursor: (f64, f64), room: (f64, f64)) -> Option<bool> {
        let press = self.press.as_mut()?;
        let (dx, dy) = (cursor.0 - press.cursor.0, cursor.1 - press.cursor.1);
        let grabbed = !press.dragging && self.draggable && dx.hypot(dy) > SLOP;
        if grabbed {
            press.dragging = true;
            // The page's card fades while it drags, leaving the video's bottom corners bare.
            self.radii.1 = self.radii.0;
        }
        if !press.dragging {
            return None;
        }
        self.at = (
            (press.from.0 + dx).clamp(0.0, (room.0 - self.size.0).max(0.0)),
            (press.from.1 + dy).clamp(0.0, (room.1 - self.size.1).max(0.0)),
        );
        Some(grabbed)
    }

    /// What the page hears as the press ends: where a drag let go, or a click where `clicked`.
    pub fn release(&mut self, clicked: bool) -> Option<Outbound> {
        let press = self.press.take()?;
        if press.dragging {
            Some(event("moved", Some(self.at)))
        } else {
            clicked.then(|| event("tap", None))
        }
    }
}

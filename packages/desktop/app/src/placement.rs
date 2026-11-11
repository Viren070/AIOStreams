use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const FILE: &str = "window.json";
pub const MIN_SIZE: (u32, u32) = (480, 320);
pub const PIP_MIN_WIDTH: u32 = 240;
pub const SETTLE: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    /// In logical pixels, as the window is when not maximized.
    pub width: u32,
    pub height: u32,
    /// The frame's top left in physical pixels; unset where the desktop places windows.
    #[serde(default)]
    pub position: Option<(i32, i32)>,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub pip: Option<PipPlacement>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PipPlacement {
    /// In logical pixels; the video's aspect sets the height.
    pub width: u32,
    pub position: (i32, i32),
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            width: 1280,
            height: 760,
            position: None,
            maximized: false,
            pip: None,
        }
    }
}

pub fn load(dir: &Path) -> Placement {
    let saved = std::fs::read(dir.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Placement>(&bytes).ok());
    match saved {
        Some(mut p)
            if (MIN_SIZE.0..=16384).contains(&p.width)
                && (MIN_SIZE.1..=16384).contains(&p.height) =>
        {
            p.pip = p
                .pip
                .filter(|pip| (PIP_MIN_WIDTH..=16384).contains(&pip.width));
            p
        }
        _ => Placement::default(),
    }
}

pub fn save(dir: &Path, placement: &Placement) {
    let written = serde_json::to_vec(placement)
        .map_err(std::io::Error::from)
        .and_then(|bytes| std::fs::write(dir.join(FILE), bytes));
    if let Err(e) = written {
        log::warn!("could not save the window's placement: {e}");
    }
}

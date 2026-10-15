//! What is playing, from the page's title and mpv's state, for Discord and the
//! system's media controls.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::bridge::Outbound;
use crate::discord::{self, Presence};

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Item {
    pub title: String,
    pub subtitle: Option<String>,
    pub imdb: Option<String>,
    pub artwork: Option<String>,
    #[serde(default)]
    pub previous: bool,
    #[serde(default)]
    pub next: bool,
    /// Shown on the user's Discord profile too.
    #[serde(default)]
    pub discord: bool,
}

/// A press on the system's media controls; positions and offsets are milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum MediaKey {
    Play,
    Pause,
    Toggle,
    Stop,
    Next,
    Previous,
    Seek { position: i64 },
    Skip { offset: i64 },
}

pub struct Snapshot {
    pub item: Item,
    pub playing: bool,
    pub position: Duration,
    pub duration: Option<Duration>,
}

type Controls = Box<dyn Fn(Option<&Snapshot>) + Send + Sync>;

struct State {
    item: Option<Item>,
    paused: bool,
    idle: bool,
    position_ms: f64,
    duration_ms: Option<f64>,
    /// A seek landed; its position can arrive either side of the event.
    seeked: bool,
    on_discord: bool,
}

static STATE: Mutex<State> = Mutex::new(State {
    item: None,
    paused: false,
    idle: true,
    position_ms: 0.0,
    duration_ms: None,
    seeked: false,
    on_discord: false,
});
static CONTROLS: OnceLock<Controls> = OnceLock::new();

/// Gives the system's media controls every change; `None` hides them.
pub fn start(controls: impl Fn(Option<&Snapshot>) + Send + Sync + 'static) {
    let _ = CONTROLS.set(Box::new(controls));
}

pub fn set_item(item: Option<Item>) {
    let Ok(mut state) = STATE.lock() else { return };
    if state.item == item {
        return;
    }
    state.item = item;
    publish(&mut state);
}

/// A browsing status from the page, which a title playing on Discord outranks.
pub fn browsing(presence: Option<Presence>) {
    let Ok(state) = STATE.lock() else { return };
    if !state.on_discord {
        discord::set(presence);
    }
}

/// Reads mpv's side from what the player sends the page.
pub fn observe(message: &Outbound) {
    let Ok(mut state) = STATE.lock() else { return };
    match message {
        Outbound::PlayerState {
            state: player,
            external: false,
        } => {
            if let Some(paused) = player.paused {
                state.paused = paused;
                publish(&mut state);
            }
            if let Some(idle) = player.idle {
                state.idle = idle;
                publish(&mut state);
            }
            if player.duration_ms.is_some() && player.duration_ms != state.duration_ms {
                state.duration_ms = player.duration_ms;
                publish(&mut state);
            }
            if let Some(position) = player.position_ms {
                state.position_ms = position;
                if std::mem::take(&mut state.seeked) {
                    publish(&mut state);
                }
            }
        }
        Outbound::PlayerEvent {
            name: "restart",
            external: false,
        } => {
            state.seeked = true;
            publish(&mut state);
        }
        _ => {}
    }
}

fn publish(state: &mut State) {
    let snapshot = state.item.clone().map(|item| Snapshot {
        item,
        playing: !state.paused && !state.idle,
        position: Duration::from_secs_f64(state.position_ms.max(0.0) / 1000.0),
        duration: state
            .duration_ms
            .filter(|d| *d > 0.0)
            .map(|d| Duration::from_secs_f64(d / 1000.0)),
    });
    if let Some(controls) = CONTROLS.get() {
        controls(snapshot.as_ref());
    }
    let presence = snapshot
        .as_ref()
        .filter(|s| s.item.discord)
        .map(|s| Presence {
            title: s.item.title.clone(),
            subtitle: s.item.subtitle.clone(),
            imdb: s.item.imdb.clone(),
            position: s.position.as_millis() as i64,
            duration: s.duration.map(|d| d.as_millis() as i64),
            paused: !s.playing,
            browsing: false,
        });
    if presence.is_some() || state.on_discord {
        state.on_discord = presence.is_some();
        discord::set(presence);
    }
}

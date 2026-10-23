//! Messages between the page and the shell.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::discord::Presence;
use crate::now_playing::{self, MediaKey};
use crate::playback::{Change, Chapter, Load, PlayerState, Settings, Style, SubtitleLine, Track};

/// Bumped when a message changes shape, so pages can tell shells apart.
pub const PROTOCOL_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Nightly,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Inbound {
    /// `external` messages go to the player started with `external-open`.
    PlayerLoad {
        #[serde(flatten)]
        load: Load,
        #[serde(default)]
        external: bool,
    },
    PlayerStop {
        #[serde(default)]
        external: bool,
    },
    /// Drops the files queued after the playing one.
    PlayerUnqueue {
        #[serde(default)]
        external: bool,
    },
    PlayerSet {
        #[serde(flatten)]
        change: Change,
        #[serde(default)]
        external: bool,
    },
    PlayerSeek {
        position_ms: f64,
        #[serde(default)]
        external: bool,
    },
    /// Adds a subtitle from the server and shows it, in place of track `replace`.
    PlayerSubtitleAdd {
        url: String,
        title: String,
        language: String,
        replace: Option<u64>,
        #[serde(default)]
        external: bool,
    },
    /// The app's own player only: the user's player keeps its own look.
    PlayerStyle(Style),
    /// mpv's stats overlay, on one of its pages or off.
    PlayerStatsOverlay {
        page: Option<String>,
        #[serde(default)]
        external: bool,
    },
    /// Reports the lines of one of the file's own subtitles as mpv reads them, or stops with `None`.
    PlayerSubtitleLines {
        track: Option<String>,
    },
    /// Answered with `player-subtitle-index` once the file's index has been read.
    PlayerSubtitleIndex,
    /// Answered with `player-thumbnail`s for the keyframe at or before the position, newest asked
    /// first, except the one at `showing_ms` the page has; without a position, reads the file's
    /// index ahead of the first.
    PlayerThumbnail {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        position_ms: Option<f64>,
        showing_ms: Option<f64>,
    },
    /// Reports the player's whole state again.
    PlayerSync {
        #[serde(default)]
        external: bool,
    },
    PlayerSettings(Settings),
    /// A key the page left alone, in mpv's name for it, for the user's own key bindings.
    PlayerKey {
        key: String,
    },
    /// Answered with `youtube-resolved` carrying the same `request`.
    YoutubeResolve {
        request: String,
        id: String,
    },
    /// Asks for an `audio-devices` answer.
    AudioDevices,
    /// A subtitle file the user dropped or picked, base64-encoded.
    SubtitleFile {
        name: String,
        data: String,
        #[serde(default)]
        external: bool,
    },
    /// Asks for an `external-players` answer.
    ExternalPlayers,
    /// Lets the user pick where a player is installed.
    ExternalChoose {
        player: String,
    },
    /// Starts the player, or keeps the one already open, for the next `loadfile`.
    ExternalOpen {
        player: String,
        title: Option<String>,
    },
    ExternalClose,
    Fullscreen {
        value: Option<bool>,
    },
    Minimize,
    Close,
    /// Moves the window with the mouse, from a press on the page's title strip.
    WindowDrag,
    /// Resizes from the top edge, which the page covers: `n`, `ne` or `nw`.
    WindowResize {
        edge: String,
    },
    WindowMaximize,
    /// Asks for a `window-state` answer.
    WindowState,
    /// Shows or hides the system's own window buttons, where it draws them over the page.
    WindowButtons {
        visible: bool,
    },
    AppInfo,
    /// Picks the output that draws the video from the next start, then answers with a
    /// `video-output`; `None` only asks.
    VideoOutput {
        output: Option<String>,
    },
    /// Quits and opens the app again.
    Restart,
    OpenMpvConfig,
    OpenLogs,
    /// Versions, paths and the recent log, for a bug report; the page names its own build and the server's.
    Diagnostics {
        web: Option<String>,
        server: Option<String>,
    },
    /// Checks for an update and downloads it; `None` keeps the installed channel.
    UpdateCheck {
        channel: Option<UpdateChannel>,
    },
    /// Restarts into a downloaded update.
    UpdateApply,
    /// An error from the page: uncaught, or passed to `console.error`.
    WebError {
        message: String,
    },
    /// What Discord shows the user doing; `None` clears it.
    Presence {
        presence: Option<Presence>,
    },
    /// Connects to Discord if need be and answers with a `discord-status`.
    DiscordCheck,
    /// The title the player shows; `None` once it closes.
    NowPlaying {
        item: Option<now_playing::Item>,
    },
    /// The page can take `link` messages, and any that arrived before it loaded.
    LinksReady,
    /// Downloads to fetch; one already known keeps its state.
    DownloadAdd {
        jobs: Vec<DownloadJob>,
    },
    /// `pause`, `resume` or `retry`.
    DownloadControl {
        id: String,
        action: String,
    },
    /// Forgets a download, and with `files` deletes what it saved.
    DownloadRemove {
        id: String,
        files: bool,
    },
    /// Asks for a `download-state` answer.
    DownloadList,
    /// Lets the user pick the folder new downloads go to.
    DownloadFolder,
    /// Shows the downloads folder, or one download's, in the file manager.
    DownloadOpen {
        id: Option<String>,
    },
    DownloadConfig {
        concurrent: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Video,
    Subtitle,
    Image,
}

/// A file to fetch, at a path relative to the downloads folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadFile {
    pub url: String,
    pub path: String,
    pub kind: FileKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
}

/// A file the page writes itself, such as the item's details.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadText {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String,
    pub title: String,
    pub files: Vec<DownloadFile>,
    #[serde(default)]
    pub texts: Vec<DownloadText>,
}

#[derive(Debug, Serialize)]
pub struct DownloadStatus {
    pub id: String,
    /// `queued`, `downloading`, `paused`, `failed` or `done`.
    pub state: &'static str,
    pub bytes: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    /// Where a finished download's video and subtitles are, for playing it.
    pub video: Option<String>,
    pub subtitles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Outbound {
    YoutubeResolved {
        request: String,
        url: Option<String>,
    },
    PlayerState {
        #[serde(flatten)]
        state: PlayerState,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerTracks {
        tracks: Vec<Track>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerChapters {
        chapters: Vec<Chapter>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    PlayerSubtitleLines {
        track: String,
        lines: Vec<SubtitleLine>,
    },
    /// Each of the file's own subtitles' lines from its index by mpv id, or none without one.
    PlayerSubtitleIndex {
        tracks: Option<BTreeMap<String, Vec<SubtitleLine>>>,
    },
    /// Where the page loads the JPEG of the keyframe at `position_ms`; without a `src` the file
    /// has no thumbnails.
    PlayerThumbnail {
        url: String,
        #[serde(rename = "positionMs", skip_serializing_if = "Option::is_none")]
        position_ms: Option<u64>,
        src: Option<String>,
    },
    /// `start`, `loaded` or `restart`.
    PlayerEvent {
        name: &'static str,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    /// For the app's own HDR output; never sent to the page.
    VideoColour {
        gamma: Option<String>,
        primaries: Option<String>,
    },
    PlayerEnded {
        reason: &'static str,
        error: Option<String>,
        /// The HTTP status a failed load answered with.
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<String>,
        #[serde(skip_serializing_if = "is_false")]
        external: bool,
    },
    /// The players this computer can start; empty where the app may not start programs.
    ExternalPlayers {
        players: Vec<ExternalPlayer>,
    },
    /// The external player closed, or with `error`, never started.
    ExternalEnded {
        error: Option<String>,
    },
    Fullscreen {
        value: bool,
    },
    WindowState {
        maximized: bool,
    },
    AppInfo {
        app: &'static str,
        platform: &'static str,
        mpv: Option<String>,
        ffmpeg: Option<String>,
        #[serde(rename = "ac3Encoder")]
        ac3_encoder: bool,
    },
    /// `outputs` is empty where there is no choice.
    VideoOutput {
        outputs: Vec<&'static str>,
        running: &'static str,
        chosen: &'static str,
    },
    /// mpv's `audio-device-list`.
    AudioDevices {
        devices: Value,
    },
    Diagnostics {
        text: String,
    },
    /// `checking`, `downloading`, `ready`, `current`, `error`, or `off` for a
    /// copy Velopack did not install.
    UpdateState {
        state: &'static str,
        channel: Option<UpdateChannel>,
        version: Option<String>,
        error: Option<String>,
    },
    /// `connected`, `not-found`, `failed` or `refused`, with the reason for the last two.
    DiscordStatus {
        state: &'static str,
        message: Option<String>,
    },
    /// An `aiostreams://` link the app was opened with.
    Link {
        url: String,
    },
    MediaKey {
        key: MediaKey,
    },
    Error {
        message: String,
    },
    DownloadState {
        folder: String,
        jobs: Vec<DownloadStatus>,
    },
    /// The running download's video; `speed` in bytes a second.
    DownloadProgress {
        id: String,
        bytes: u64,
        total: Option<u64>,
        speed: u64,
    },
}

#[derive(Debug, Serialize)]
pub struct ExternalPlayer {
    pub id: &'static str,
    pub path: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !value
}

impl Outbound {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

pub fn origin(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    let origin = url.origin();
    // A custom scheme's origin is opaque, "null" for every such page, so it is spelled out.
    if origin.is_tuple() {
        Some(origin.ascii_serialization())
    } else {
        Some(format!("{}://{}", url.scheme(), url.host_str()?))
    }
}

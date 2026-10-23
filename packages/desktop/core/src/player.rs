use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use aiostreams_container::{RangeReader, subtitle_timelines};
use serde_json::Value;

use crate::bridge::Outbound;
use crate::mpv::{Event, Kind, Mpv};
use crate::playback::{
    self, Change, IMAGE_SUBTITLE_CODECS, Load, Loadfile, OBSERVED, REFERENCE_LINES, Settings,
    Style, SubtitleLine, THROTTLE_MS, THROTTLED,
};
use crate::sound::{self, Filters, Sound};
use crate::thumbnails::Previews;

pub type Emit = Arc<dyn Fn(Outbound) + Send + Sync>;

/// Settings whose changes are worth a line in the log; the rest are routine.
const LOGGED_PROPS: &[&str] = &[
    "aid",
    "sid",
    "secondary-sid",
    "hwdec",
    "audio-channels",
    "audio-spdif",
    "audio-device",
    "audio-delay",
    "demuxer-max-bytes",
];

/// Observed for the sound filters, past the ids of the page's properties.
const AUDIO_PARAMS: u64 = 1000;
const SUBTITLE_LINES: u64 = 1001;
/// Observed for the app's HDR output.
const VIDEO_GAMMA: u64 = 1002;
const VIDEO_PRIMARIES: u64 = 1003;
const READ_AHEAD_EVERY: Duration = Duration::from_secs(15);
const READ_AHEAD_STEPS: usize = 500;

enum Request {
    Command(Vec<String>),
    SetProp(String, String),
    Sync,
    AudioDevices,
}

/// The subtitle size, which a picture subtitle keeps at its own.
#[derive(Default)]
struct SubtitleScale {
    scale: Option<f64>,
    shown: Option<String>,
    pictures: Vec<String>,
    picture: bool,
}

impl SubtitleScale {
    /// The `sub-scale` to set once the shown subtitle turns into a picture or back.
    fn update(&mut self) -> Option<String> {
        let picture = self
            .shown
            .as_ref()
            .is_some_and(|id| self.pictures.contains(id));
        if picture == self.picture {
            return None;
        }
        self.picture = picture;
        self.value()
    }

    fn value(&self) -> Option<String> {
        let scale = self.scale?;
        Some(if self.picture {
            "1".into()
        } else {
            scale.to_string()
        })
    }
}

/// The file's own subtitle whose lines go to the page.
#[derive(Default)]
struct Reference {
    track: Option<String>,
    sent: HashSet<(i64, i64)>,
    read_ahead_at: Option<Instant>,
    own: Vec<playback::OwnSubtitle>,
    file: Option<Indexed>,
    /// The page waits on the whole index.
    index_asked: bool,
}

/// The playing file, and each of its subtitles' lines once read from its index.
struct Indexed {
    url: String,
    headers: Vec<(String, String)>,
    lines: Option<Vec<Vec<SubtitleLine>>>,
    reading: bool,
}

impl Reference {
    /// The index lists the file's own subtitles in mpv's order.
    fn indexed(&self) -> Option<Vec<SubtitleLine>> {
        let all = self.file.as_ref()?.lines.as_ref()?;
        let track = self.track.as_ref()?;
        if all.len() != self.own.len() {
            return None;
        }
        all.get(self.own.iter().position(|s| s.id == *track)?)
            .cloned()
    }

    /// Every one of the file's own subtitles' lines by mpv id, or none without an index.
    fn index_message(&self) -> Outbound {
        let tracks = self
            .file
            .as_ref()
            .and_then(|f| f.lines.as_ref())
            .filter(|all| !all.is_empty() && all.len() == self.own.len())
            .map(|all| {
                self.own
                    .iter()
                    .map(|s| s.id.clone())
                    .zip(all.iter().cloned())
                    .collect()
            });
        Outbound::PlayerSubtitleIndex { tracks }
    }

    fn report(&mut self, lines: Vec<SubtitleLine>) -> Option<Outbound> {
        let track = self.track.clone()?;
        let lines: Vec<_> = lines
            .into_iter()
            .filter(|l| self.sent.insert((l.start_ms as i64, l.end_ms as i64)))
            .collect();
        (!lines.is_empty()).then_some(Outbound::PlayerSubtitleLines { track, lines })
    }
}

/// Each subtitle track's lines from the file's index; none where it has no index.
fn index_lines(url: &str, headers: Vec<(String, String)>) -> Vec<Vec<SubtitleLine>> {
    let mut options = aiostreams_container::index_options();
    options.headers = headers;
    let read = RangeReader::new(url, options).and_then(|mut r| subtitle_timelines(&mut r));
    match read {
        Ok(tracks) => {
            log::info!("subtitle index tracks={}", tracks.len());
            tracks
                .into_iter()
                .map(|t| {
                    t.lines
                        .into_iter()
                        .map(|(start, end)| SubtitleLine {
                            start_ms: start as f64,
                            end_ms: end as f64,
                        })
                        .collect()
                })
                .collect()
        }
        Err(e) => {
            log::info!("subtitle index unavailable: {e}");
            Vec::new()
        }
    }
}

/// The reference's events from the playing one to the end of what mpv has read.
fn read_ahead(mpv: &Mpv) -> Vec<SubtitleLine> {
    let delay = || mpv.get_property("secondary-sub-delay", Kind::Double);
    let mut lines = Vec::new();
    let mut last = delay();
    for _ in 0..READ_AHEAD_STEPS {
        if mpv.command(playback::NEXT_REFERENCE_LINE).is_err() {
            break;
        }
        let now = delay();
        if now == last {
            break;
        }
        last = now;
        if let Some(Value::String(events)) = mpv.get_property(REFERENCE_LINES, Kind::String) {
            lines.extend(playback::subtitle_lines(&events));
        }
    }
    if let Err(e) = mpv.set_property("secondary-sub-delay", "0") {
        log::warn!("mpv secondary-sub-delay=0: {e}");
    }
    lines
}

/// Makes the page's mpv calls on a thread of its own: the caller may be the render thread mpv waits on.
pub struct Player {
    mpv: Arc<Mpv>,
    quit: Arc<AtomicBool>,
    events: Option<JoinHandle<()>>,
    requests: Option<mpsc::Sender<Request>>,
    worker: Option<JoinHandle<()>>,
    versions: (Option<String>, Option<String>),
    /// The last value of each logged setting, so re-applying one logs nothing.
    logged: Mutex<HashMap<String, String>>,
    dolby_vision: Arc<AtomicBool>,
    /// Settings the event thread hasn't applied yet.
    sound: Arc<Mutex<Option<Sound>>>,
    subtitles: Arc<Mutex<SubtitleScale>>,
    reference: Arc<Mutex<Reference>>,
    /// The stats overlay's page, while it shows.
    stats: Mutex<Option<String>>,
    previews: Previews,
    ac3_encoder: bool,
    own_font: String,
    styled: Mutex<HashMap<&'static str, String>>,
    /// None when the user's mpv.conf sizes the cache.
    auto_cache: Option<u64>,
    emit: Emit,
}

impl Player {
    /// `defaults` apply before the user's mpv.conf, `required` after it.
    pub fn start(
        library: &Path,
        defaults: &[(&str, &str)],
        required: &[(&str, &str)],
        auto_cache: Option<u64>,
        emit: Emit,
    ) -> Result<Self, String> {
        let mpv = Arc::new(Mpv::new(library, defaults)?);
        for (name, value) in required {
            if let Err(e) = mpv.set_property(name, value) {
                log::warn!("mpv {name}={value}: {e}");
            }
        }
        mpv.request_log_messages("warn")?;
        for (id, (name, kind)) in OBSERVED.iter().enumerate() {
            mpv.observe(name, *kind, id as u64)?;
        }
        mpv.observe("audio-params", Kind::Json, AUDIO_PARAMS)?;
        mpv.observe(REFERENCE_LINES, Kind::String, SUBTITLE_LINES)?;
        mpv.observe("video-params/gamma", Kind::String, VIDEO_GAMMA)?;
        mpv.observe("video-params/primaries", Kind::String, VIDEO_PRIMARIES)?;
        let versions = (text(&mpv, "mpv-version"), text(&mpv, "ffmpeg-version"));
        log::info!(
            "mpv started version=\"{}\" ffmpeg={}",
            versions.0.as_deref().unwrap_or_default(),
            versions.1.as_deref().unwrap_or_default()
        );
        if let Some(dir) = library.parent() {
            aiostreams_thumbs::library_dirs(vec![dir.to_path_buf()]);
        }
        let quit = Arc::new(AtomicBool::new(false));
        let dolby_vision = Arc::new(AtomicBool::new(true));
        let ac3_encoder = sound::encodes_ac3(&mpv);
        let own_font = text(&mpv, "sub-font").unwrap_or_default();
        let sound = Arc::new(Mutex::new(None));
        let subtitles = Arc::new(Mutex::new(SubtitleScale::default()));
        let reference = Arc::new(Mutex::new(Reference::default()));
        let events = std::thread::Builder::new()
            .name("mpv-events".into())
            .spawn({
                let (mpv, emit, quit) = (mpv.clone(), emit.clone(), quit.clone());
                let (dolby_vision, sound) = (dolby_vision.clone(), sound.clone());
                let (subtitles, reference) = (subtitles.clone(), reference.clone());
                move || {
                    pump(
                        &mpv,
                        &emit,
                        &quit,
                        &dolby_vision,
                        &sound,
                        &subtitles,
                        &reference,
                    )
                }
            })
            .map_err(|e| e.to_string())?;
        let (requests, inbox) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("mpv-requests".into())
            .spawn({
                let (mpv, emit) = (mpv.clone(), emit.clone());
                move || serve(&mpv, &emit, &inbox)
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            mpv,
            quit,
            events: Some(events),
            requests: Some(requests),
            worker: Some(worker),
            versions,
            logged: Mutex::default(),
            dolby_vision,
            sound,
            subtitles,
            reference,
            stats: Mutex::default(),
            previews: Previews::new(emit.clone()),
            ac3_encoder,
            own_font,
            styled: Mutex::default(),
            auto_cache,
            emit,
        })
    }

    pub fn resolve_youtube(&self, request: String, id: String) {
        let emit = self.emit.clone();
        let spawned = std::thread::Builder::new()
            .name("youtube".into())
            .spawn(move || {
                let url = crate::youtube::resolve(&id);
                emit(Outbound::YoutubeResolved { request, url })
            });
        if let Err(e) = spawned {
            log::warn!("youtube: {e}");
        }
    }

    /// Takes effect from the next file.
    pub fn set_dolby_vision(&self, on: bool) {
        if self.dolby_vision.swap(on, Ordering::SeqCst) != on {
            log::info!("set dolby-vision={on}");
        }
    }

    pub fn set_sound(&self, sound: Sound) {
        log::info!("set sound={sound:?}");
        if let Ok(mut pending) = self.sound.lock() {
            *pending = Some(sound);
        }
        self.mpv.wakeup();
    }

    pub fn ac3_encoder(&self) -> bool {
        self.ac3_encoder
    }

    fn send(&self, request: Request) {
        if let Some(requests) = &self.requests {
            let _ = requests.send(request);
        }
    }

    /// Errs only on refused requests; mpv's own errors reach the page as a message.
    pub fn load(&self, load: &Load, local: &dyn Fn(&str) -> bool) -> Result<(), String> {
        let file = Loadfile::new(load, local)?;
        log::info!("load url={} options={}", file.url, file.options.join(","));
        if !load.append
            && let Ok(mut reference) = self.reference.lock()
        {
            reference.file = Some(Indexed {
                url: load.url.clone(),
                headers: load.headers.clone().into_iter().collect(),
                lines: None,
                reading: false,
            });
            reference.index_asked = false;
        }
        for command in file.commands() {
            self.send(Request::Command(command));
        }
        Ok(())
    }

    pub fn change(&self, change: &Change) -> Result<(), String> {
        for (name, value) in playback::change(change)? {
            self.set(name, value);
        }
        Ok(())
    }

    pub fn seek(&self, position_ms: f64) {
        self.send(Request::Command(vec![
            "seek".into(),
            format!("{:.3}", position_ms / 1000.0),
            "absolute".into(),
        ]));
    }

    pub fn add_subtitle_url(
        &self,
        url: &str,
        title: &str,
        language: &str,
        replace: Option<u64>,
        local: &dyn Fn(&str) -> bool,
    ) -> Result<(), String> {
        playback::check_url(url, local)?;
        log::info!("add subtitle url={url}");
        if let Some(id) = replace {
            self.send(Request::Command(vec!["sub-remove".into(), id.to_string()]));
        }
        self.send(Request::Command(vec![
            "sub-add".into(),
            url.into(),
            "select".into(),
            title.into(),
            language.into(),
        ]));
        Ok(())
    }

    /// Sets only what changed, so the user's mpv.conf profiles keep what they set since.
    pub fn style(&self, style: &Style) -> Result<(), String> {
        for (name, value) in playback::style(style, &self.own_font)? {
            let changed = self.styled.lock().map_or(true, |mut styled| {
                styled.insert(name, value.clone()).as_ref() != Some(&value)
            });
            if changed {
                self.set(name, value);
            }
        }
        let scale = self.subtitles.lock().ok().and_then(|mut s| {
            if s.scale == Some(style.subtitles.scale) {
                return None;
            }
            s.scale = Some(style.subtitles.scale);
            s.value()
        });
        if let Some(scale) = scale {
            self.set("sub-scale", scale);
        }
        Ok(())
    }

    pub fn subtitle_lines(&self, track: Option<&str>) -> Result<(), String> {
        // mpv has no secondary picture subtitles, so their lines come from the index alone.
        let picture = track.is_some_and(|t| {
            self.reference
                .lock()
                .is_ok_and(|r| r.own.iter().any(|s| s.picture && s.id == t))
        });
        let watched = track.filter(|_| !picture);
        let props = playback::reference(watched)?;
        if let Ok(mut reference) = self.reference.lock() {
            reference.track = track.map(String::from);
            reference.sent.clear();
            // Once mpv has decoded the newly picked track's lines.
            reference.read_ahead_at = watched.map(|_| Instant::now() + Duration::from_secs(1));
        }
        for (name, value) in props {
            self.set(name, value);
        }
        if track.is_some() {
            self.read_index();
        }
        Ok(())
    }

    /// All of the reference's lines at once from the file's index, which mpv's reading then tops up.
    fn read_index(&self) {
        let Ok(mut reference) = self.reference.lock() else {
            return;
        };
        if let Some(lines) = reference.indexed() {
            if let Some(message) = reference.report(lines) {
                (self.emit)(message);
            }
            return;
        }
        self.start_index(&mut reference);
    }

    /// Every one of the file's own subtitles' lines, sent once the index has been read.
    pub fn subtitle_index(&self) {
        let Ok(mut reference) = self.reference.lock() else {
            return;
        };
        reference.index_asked = true;
        match reference.file.as_ref() {
            Some(file) if file.lines.is_none() => self.start_index(&mut reference),
            _ => (self.emit)(reference.index_message()),
        }
    }

    /// Reads the file's index once, on a thread of its own.
    fn start_index(&self, reference: &mut Reference) {
        let Some(file) = reference
            .file
            .as_mut()
            .filter(|f| f.lines.is_none() && !f.reading)
        else {
            return;
        };
        file.reading = true;
        let (url, headers) = (file.url.clone(), file.headers.clone());
        let (reference, emit) = (self.reference.clone(), self.emit.clone());
        let spawned = std::thread::Builder::new()
            .name("subtitle-index".into())
            .spawn(move || {
                let lines = index_lines(&url, headers);
                let Ok(mut reference) = reference.lock() else {
                    return;
                };
                let Some(file) = reference.file.as_mut().filter(|f| f.url == url) else {
                    return;
                };
                file.lines = Some(lines);
                file.reading = false;
                if let Some(message) = reference.indexed().and_then(|l| reference.report(l)) {
                    emit(message);
                }
                if reference.index_asked {
                    emit(reference.index_message());
                }
            });
        if let Err(e) = spawned {
            log::warn!("subtitle-index: {e}");
        }
    }

    pub fn stats_overlay(&self, page: Option<&str>) -> Result<(), String> {
        let Ok(mut shown) = self.stats.lock() else {
            return Ok(());
        };
        for command in playback::stats_overlay(shown.as_deref(), page)? {
            self.send(Request::Command(command));
        }
        *shown = page.map(String::from);
        Ok(())
    }

    /// Only the user's own input.conf binds keys, since default bindings are off.
    pub fn keypress(&self, key: &str) -> Result<(), String> {
        if key.is_empty() || key.chars().any(char::is_whitespace) {
            return Err("keypress takes one key name".into());
        }
        self.send(Request::Command(vec!["keypress".into(), key.into()]));
        Ok(())
    }

    pub fn settings(&self, settings: &Settings) {
        for (name, value) in playback::settings(settings, "auto-safe") {
            self.set(name, value);
        }
        if let Some(auto) = self.auto_cache {
            for (name, value) in playback::cache(settings.cache_mb, auto) {
                self.set(name, value);
            }
        }
        self.set_dolby_vision(settings.dolby_vision);
        self.set_sound(settings.sound);
    }

    fn set(&self, name: &'static str, value: String) {
        let changed = LOGGED_PROPS.contains(&name)
            && self.logged.lock().is_ok_and(|mut logged| {
                logged.insert(name.to_string(), value.clone()).as_ref() != Some(&value)
            });
        let shown = if value.is_empty() { "\"\"" } else { &value };
        if changed {
            log::info!("set {name}={shown}");
        } else {
            log::debug!("set {name}={shown}");
        }
        self.send(Request::SetProp(name.to_string(), value));
    }

    pub fn sync(&self) {
        self.send(Request::Sync);
    }

    /// Answered with `audio-devices`.
    pub fn audio_devices(&self) {
        self.send(Request::AudioDevices);
    }

    /// Takes a file the app wrote itself, which the bridge's checks would refuse.
    pub fn add_subtitle(&self, path: &Path, title: &str) {
        log::info!("add subtitle file={}", path.display());
        self.send(Request::Command(vec![
            "sub-add".into(),
            path.to_string_lossy().into_owned(),
            "select".into(),
            title.into(),
        ]));
    }

    pub fn mpv(&self) -> Arc<Mpv> {
        self.mpv.clone()
    }

    pub fn versions(&self) -> (Option<String>, Option<String>) {
        self.versions.clone()
    }

    pub fn stop(&self) {
        self.send(Request::Command(vec!["stop".into()]));
        self.previews.clear();
    }

    pub fn unqueue(&self) {
        self.send(Request::Command(vec!["playlist-clear".into()]));
    }

    pub fn thumbnail(
        &self,
        url: &str,
        headers: &BTreeMap<String, String>,
        position_ms: Option<f64>,
        showing_ms: Option<f64>,
        local: &dyn Fn(&str) -> bool,
    ) -> Result<(), String> {
        playback::check_url(url, local)?;
        self.previews.want(url, headers, position_ms, showing_ms);
        Ok(())
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        // Dropping the sender ends the worker after what was sent.
        self.requests.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        self.quit.store(true, Ordering::SeqCst);
        self.mpv.wakeup();
        if let Some(events) = self.events.take() {
            let _ = events.join();
        }
    }
}

fn serve(mpv: &Mpv, emit: &Emit, inbox: &mpsc::Receiver<Request>) {
    let fail = |message: String| {
        log::warn!("{message}");
        emit(Outbound::Error { message });
    };
    for request in inbox {
        match request {
            Request::Command(args) => {
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                if let Err(e) = mpv.command(&refs) {
                    fail(format!("mpv command {args:?}: {e}"));
                }
            }
            Request::SetProp(name, value) => {
                if let Err(e) = mpv.set_property(&name, &value) {
                    fail(format!("mpv set {name}={value}: {e}"));
                }
            }
            Request::Sync => {
                for (name, kind) in OBSERVED {
                    let data = mpv.get_property(name, *kind).unwrap_or(Value::Null);
                    if let Some(message) = playback::report(name, &data, false) {
                        emit(message);
                    }
                }
            }
            Request::AudioDevices => {
                let devices = mpv
                    .get_property("audio-device-list", Kind::Json)
                    .unwrap_or(Value::Null);
                emit(Outbound::AudioDevices { devices });
            }
        }
    }
}

fn text(mpv: &Mpv, name: &str) -> Option<String> {
    match mpv.get_property(name, Kind::String) {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        _ => None,
    }
}

fn clock(seconds: f64) -> String {
    let s = seconds.max(0.0) as u64;
    format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}

/// What is playing, once per file: enough to tell a codec or decoder problem apart.
fn log_playing(mpv: &Mpv) {
    let get = |name: &str| text(mpv, name).unwrap_or_else(|| "none".into());
    let size = match (text(mpv, "width"), text(mpv, "height")) {
        (Some(w), Some(h)) => format!(" size={w}x{h}"),
        _ => String::new(),
    };
    let duration = mpv
        .get_property("duration", Kind::Double)
        .and_then(|v| v.as_f64())
        .map(clock)
        .unwrap_or_else(|| "unknown".into());
    // Transfer/primaries in and out: `pq/bt.2020` out is HDR reaching the display.
    let colour = |params: &str| {
        format!(
            "{}/{}",
            get(&format!("{params}/gamma")),
            get(&format!("{params}/primaries"))
        )
    };
    log::info!(
        "playing video={}{size} hwdec={} colour={} output={} peak={} audio={} channels={} duration={duration}",
        get("video-format"),
        get("hwdec-current"),
        colour("video-params"),
        colour("video-target-params"),
        get("video-target-params/max-luma"),
        get("audio-codec-name"),
        get("audio-params/channel-count"),
    );
}

/// Holds back properties that change every frame, sending each at most once
/// per interval; the last value held always goes out.
#[derive(Default)]
pub struct Throttle {
    sent: HashMap<String, Instant>,
    held: HashMap<String, Value>,
}

impl Throttle {
    const EVERY: Duration = Duration::from_millis(THROTTLE_MS);

    /// The value to send now, if it is not held.
    pub fn pass(&mut self, name: String, value: Value) -> Option<(String, Value)> {
        if THROTTLED.contains(&name.as_str())
            && self
                .sent
                .get(&name)
                .is_some_and(|at| at.elapsed() < Self::EVERY)
        {
            self.held.insert(name, value);
            return None;
        }
        self.held.remove(&name);
        self.sent.insert(name.clone(), Instant::now());
        Some((name, value))
    }

    pub fn due(&mut self) -> Vec<(String, Value)> {
        let mut due = Vec::new();
        let sent = &mut self.sent;
        self.held.retain(|name, value| {
            if sent.get(name).is_some_and(|at| at.elapsed() < Self::EVERY) {
                return true;
            }
            sent.insert(name.clone(), Instant::now());
            due.push((name.clone(), value.take()));
            false
        });
        due
    }

    pub fn wait(&self) -> Duration {
        if self.held.is_empty() {
            Duration::from_secs(1)
        } else {
            Self::EVERY
        }
    }
}

/// Collapses a message mpv repeats, as a broken stream can print one per frame.
#[derive(Default)]
struct MpvLog {
    last: Option<(log::Level, String)>,
    repeats: u32,
}

impl MpvLog {
    fn push(&mut self, level: &str, prefix: &str, text: &str) {
        let level = if level == "error" || level == "fatal" {
            log::Level::Error
        } else {
            log::Level::Warn
        };
        let line = format!("[{prefix}] {}", text.trim_end());
        if self.last.as_ref().is_some_and(|(_, last)| *last == line) {
            self.repeats += 1;
            return;
        }
        self.flush();
        log::log!(target: "mpv", level, "{line}");
        self.last = Some((level, line));
    }

    fn flush(&mut self) {
        if self.repeats > 0
            && let Some((level, _)) = &self.last
        {
            log::log!(target: "mpv", *level, "last message repeated {} more times", self.repeats);
        }
        self.repeats = 0;
        self.last = None;
    }
}

/// Labelled, so a user's own `vf` stays as it is.
const DOLBY_VISION_FILTER: &str = "@aiostreams-dovi";

/// Without Dolby Vision, the HDR10 picture under it plays; profile 5 has none, so it keeps it.
fn strip_dolby_vision(mpv: &Mpv) -> bool {
    if text(mpv, "current-tracks/video/dolby-vision-profile").is_none_or(|p| p == "5") {
        return false;
    }
    let filter = format!("{DOLBY_VISION_FILTER}:format=dolbyvision=no");
    match mpv.command(&["vf", "add", &filter]) {
        Ok(()) => true,
        Err(e) => {
            log::warn!("mpv vf add {filter}: {e}");
            false
        }
    }
}

/// FFmpeg's reader logs a failed status as a warning, as it may retry it.
fn reader_error(prefix: &str, level: &str, text: &str) -> Option<String> {
    let text = text.trim_end();
    match prefix {
        "curl" if matches!(level, "error" | "fatal") => Some(text.to_string()),
        "ffmpeg" => text
            .split_once(": ")
            .filter(|(protocol, t)| {
                matches!(*protocol, "http" | "https") && t.starts_with("HTTP error ")
            })
            .map(|(_, t)| t.to_string()),
        _ => None,
    }
}

/// Keeps a picture subtitle at its own size as the shown subtitle or the file's tracks change.
fn follow_subtitle(mpv: &Mpv, subtitles: &Mutex<SubtitleScale>, name: &str, value: &Value) {
    let Ok(mut s) = subtitles.lock() else { return };
    match name {
        "sid" => s.shown = value.as_str().map(String::from),
        "track-list" => {
            s.pictures = value
                .as_array()
                .into_iter()
                .flatten()
                .filter(|t| {
                    t["type"] == "sub"
                        && t["codec"]
                            .as_str()
                            .is_some_and(|c| IMAGE_SUBTITLE_CODECS.contains(&c))
                })
                .filter_map(|t| t["id"].as_u64().map(|id| id.to_string()))
                .collect()
        }
        _ => return,
    }
    if let Some(scale) = s.update()
        && let Err(e) = mpv.set_property("sub-scale", &scale)
    {
        log::warn!("mpv sub-scale={scale}: {e}");
    }
}

fn pump(
    mpv: &Mpv,
    emit: &Emit,
    quit: &AtomicBool,
    dolby_vision: &AtomicBool,
    pending: &Mutex<Option<Sound>>,
    subtitles: &Mutex<SubtitleScale>,
    reference: &Mutex<Reference>,
) {
    let report = |name: &str, data: &Value| {
        if let Some(message) = playback::report(name, data, false) {
            emit(message);
        }
    };
    let json = |id: u64| {
        id == AUDIO_PARAMS
            || OBSERVED
                .get(id as usize)
                .is_some_and(|(_, k)| *k == Kind::Json)
    };
    let mut throttle = Throttle::default();
    let mut mpv_log = MpvLog::default();
    // Seeks restart playback too; only the first restart of a file is logged.
    let mut reported = false;
    // mpv's error names only the step that failed; its http reader's first error says why.
    let mut cause: Option<String> = None;
    let mut stripping = false;
    let mut sound = Sound::default();
    let mut filters = Filters::default();
    let mut colour = (None, None);

    while !quit.load(Ordering::SeqCst) {
        if let Some(next) = pending.lock().ok().and_then(|mut p| p.take()) {
            sound = next;
            filters.apply(mpv, sound);
        }
        if let Some(event) = mpv.wait_event(throttle.wait().as_secs_f64(), json) {
            match event {
                Event::Shutdown => break,
                Event::Log {
                    prefix,
                    level,
                    text,
                } => {
                    if cause.is_none() {
                        cause = reader_error(&prefix, &level, &text);
                    }
                    if filters.refused(&prefix, &text) {
                        filters.apply(mpv, sound);
                    }
                    mpv_log.push(&level, &prefix, &text)
                }
                Event::StartFile => {
                    reported = false;
                    cause = None;
                    if let Ok(mut reference) = reference.lock() {
                        reference.sent.clear();
                    }
                    filters.start_file();
                    filters.apply(mpv, sound);
                    emit(playback::event("start-file", false).unwrap())
                }
                Event::FileLoaded => {
                    if stripping {
                        let _ = mpv.command(&["vf", "remove", DOLBY_VISION_FILTER]);
                    }
                    stripping = !dolby_vision.load(Ordering::SeqCst) && strip_dolby_vision(mpv);
                    filters.loaded(mpv);
                    filters.apply(mpv, sound);
                    // mpv reports the tracks it picked only after this event, which the page re-picks on.
                    for name in ["aid", "sid"] {
                        if let Some(value) = mpv.get_property(name, Kind::String) {
                            report(name, &value);
                        }
                    }
                    emit(playback::event("file-loaded", false).unwrap())
                }
                Event::Seek => {}
                Event::PlaybackRestart => {
                    if !reported {
                        reported = true;
                        log_playing(mpv);
                    }
                    emit(playback::event("playback-restart", false).unwrap())
                }
                Event::EndFile { reason, error } => {
                    mpv_log.flush();
                    match &error {
                        Some(e) => log::warn!("ended reason={reason} error=\"{e}\""),
                        None => log::info!("ended reason={reason}"),
                    }
                    let cause = cause.take().filter(|_| error.is_some());
                    emit(playback::ended(reason, error, cause, false));
                }
                Event::Property {
                    id: AUDIO_PARAMS,
                    value,
                    ..
                } => {
                    filters.decoded(&value);
                    filters.apply(mpv, sound);
                    report("audio-params", &value);
                }
                Event::Property {
                    id: SUBTITLE_LINES,
                    value,
                    ..
                } => {
                    let lines = value.as_str().map(playback::subtitle_lines);
                    let message = reference
                        .lock()
                        .ok()
                        .and_then(|mut r| r.report(lines.unwrap_or_default()));
                    if let Some(message) = message {
                        emit(message);
                    }
                }
                Event::Property {
                    id: VIDEO_GAMMA | VIDEO_PRIMARIES,
                    ..
                } => {
                    let now = (
                        text(mpv, "video-params/gamma"),
                        text(mpv, "video-params/primaries"),
                    );
                    if now != colour {
                        colour = now.clone();
                        let (gamma, primaries) = now;
                        emit(Outbound::VideoColour { gamma, primaries });
                    }
                }
                Event::Property { name, value, .. } => {
                    follow_subtitle(mpv, subtitles, &name, &value);
                    if name == "track-list"
                        && let Ok(mut reference) = reference.lock()
                    {
                        reference.own = playback::own_subtitles(&value);
                    }
                    if let Some((name, data)) = throttle.pass(name, value) {
                        report(&name, &data);
                    }
                }
            }
        }
        for (name, data) in throttle.due() {
            report(&name, &data);
        }
        let reading = reference
            .lock()
            .is_ok_and(|r| r.read_ahead_at.is_some_and(|at| at <= Instant::now()));
        if reading {
            let lines = read_ahead(mpv);
            let message = reference.lock().ok().and_then(|mut r| {
                r.read_ahead_at = r.track.as_ref().map(|_| Instant::now() + READ_AHEAD_EVERY);
                r.report(lines)
            });
            if let Some(message) = message {
                emit(message);
            }
        }
    }
}

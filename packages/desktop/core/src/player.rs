use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::bridge::{self, OBSERVED, Outbound, THROTTLE_MS, THROTTLED};
use crate::mpv::{Event, Kind, Mpv};

pub type Emit = Arc<dyn Fn(Outbound) + Send + Sync>;

/// Settings whose changes are worth a line in the log; the rest are routine.
const LOGGED_PROPS: &[&str] = &[
    "aid",
    "sid",
    "secondary-sid",
    "hwdec",
    "audio-channels",
    "audio-spdif",
];

enum Request {
    Command(Vec<String>),
    SetProp(String, String),
    Sync,
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
}

impl Player {
    /// `defaults` apply before the user's mpv.conf, `required` after it.
    pub fn start(
        library: &Path,
        defaults: &[(&str, &str)],
        required: &[(&str, &str)],
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
        let versions = (text(&mpv, "mpv-version"), text(&mpv, "ffmpeg-version"));
        log::info!(
            "mpv started version=\"{}\" ffmpeg={}",
            versions.0.as_deref().unwrap_or_default(),
            versions.1.as_deref().unwrap_or_default()
        );
        let quit = Arc::new(AtomicBool::new(false));
        let events = std::thread::Builder::new()
            .name("mpv-events".into())
            .spawn({
                let (mpv, emit, quit) = (mpv.clone(), emit.clone(), quit.clone());
                move || pump(&mpv, &emit, &quit)
            })
            .map_err(|e| e.to_string())?;
        let (requests, inbox) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("mpv-requests".into())
            .spawn({
                let mpv = mpv.clone();
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
        })
    }

    fn send(&self, request: Request) {
        if let Some(requests) = &self.requests {
            let _ = requests.send(request);
        }
    }

    /// Errs only on refused arguments; mpv's own errors reach the page as a message.
    pub fn command(&self, args: &[Value]) -> Result<(), String> {
        let args = bridge::command(args)?;
        match args.as_slice() {
            [name, url, _, _, options, ..] if name == "loadfile" => {
                log::info!("load url={url} options={options}")
            }
            [name, url, ..] if name == "sub-add" => log::info!("add subtitle url={url}"),
            _ => log::debug!("command {args:?}"),
        }
        self.send(Request::Command(args));
        Ok(())
    }

    pub fn set_prop(&self, name: &str, value: &Value) -> Result<(), String> {
        let value = bridge::set_prop(name, value)?;
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
        Ok(())
    }

    pub fn sync(&self) {
        self.send(Request::Sync);
    }

    pub fn mpv(&self) -> Arc<Mpv> {
        self.mpv.clone()
    }

    pub fn versions(&self) -> (Option<String>, Option<String>) {
        self.versions.clone()
    }

    pub fn stop(&self) {
        self.send(Request::Command(vec!["stop".into()]));
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
                    emit(Outbound::MpvProp {
                        name: (*name).into(),
                        data,
                    });
                }
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

fn pump(mpv: &Mpv, emit: &Emit, quit: &AtomicBool) {
    let json = |id: u64| {
        OBSERVED
            .get(id as usize)
            .is_some_and(|(_, k)| *k == Kind::Json)
    };
    let every = Duration::from_millis(THROTTLE_MS);
    let mut sent: HashMap<String, Instant> = HashMap::new();
    let mut held: HashMap<String, Value> = HashMap::new();
    let mut mpv_log = MpvLog::default();
    // Seeks restart playback too; only the first restart of a file is logged.
    let mut reported = false;

    while !quit.load(Ordering::SeqCst) {
        let timeout = if held.is_empty() {
            1.0
        } else {
            every.as_secs_f64()
        };
        if let Some(event) = mpv.wait_event(timeout, json) {
            match event {
                Event::Shutdown => break,
                Event::Log {
                    prefix,
                    level,
                    text,
                } => mpv_log.push(&level, &prefix, &text),
                Event::StartFile => {
                    reported = false;
                    emit(Outbound::MpvEvent { name: "start-file" })
                }
                Event::FileLoaded => emit(Outbound::MpvEvent {
                    name: "file-loaded",
                }),
                Event::Seek => emit(Outbound::MpvEvent { name: "seek" }),
                Event::PlaybackRestart => {
                    if !reported {
                        reported = true;
                        log_playing(mpv);
                    }
                    emit(Outbound::MpvEvent {
                        name: "playback-restart",
                    })
                }
                Event::EndFile { reason, error } => {
                    mpv_log.flush();
                    match &error {
                        Some(e) => log::warn!("ended reason={reason} error=\"{e}\""),
                        None => log::info!("ended reason={reason}"),
                    }
                    emit(Outbound::MpvEnded { reason, error });
                }
                Event::Property { name, value, .. } => {
                    if THROTTLED.contains(&name.as_str())
                        && sent.get(&name).is_some_and(|at| at.elapsed() < every)
                    {
                        held.insert(name, value);
                    } else {
                        held.remove(&name);
                        sent.insert(name.clone(), Instant::now());
                        emit(Outbound::MpvProp { name, data: value });
                    }
                }
            }
        }
        // A held value goes out once its interval passes, so the last one is never lost.
        held.retain(|name, value| {
            if sent.get(name).is_some_and(|at| at.elapsed() < every) {
                return true;
            }
            sent.insert(name.clone(), Instant::now());
            emit(Outbound::MpvProp {
                name: name.clone(),
                data: value.take(),
            });
            false
        });
    }
}

//! Discord Rich Presence over Discord's local IPC socket.

use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::bridge::Outbound;

const CLIENT_ID: &str = "1484926986865479680";
/// The application's art asset key.
const LOGO: &str = "discord";
const REPO_URL: &str = "https://github.com/Viren070/AIOStreams";
/// A presence Discord was not running for is sent again this often.
const RETRY: Duration = Duration::from_secs(30);
/// Discord takes five updates every twenty seconds.
const GAP: Duration = Duration::from_secs(4);

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;

/// What the page shows; `position` and `duration` are milliseconds.
#[derive(Debug, Clone, Deserialize)]
pub struct Presence {
    pub title: String,
    pub subtitle: Option<String>,
    pub imdb: Option<String>,
    pub position: i64,
    pub duration: Option<i64>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub browsing: bool,
}

enum Command {
    Set(Option<Presence>),
    Check,
}

static WORKER: OnceLock<Sender<Command>> = OnceLock::new();

/// Starts the worker, which gives `emit` a `discord-status` whenever it changes.
pub fn start(emit: impl Fn(Outbound) + Send + 'static) {
    WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("discord".into())
            .spawn(move || run(rx, emit))
            .expect("spawn the discord thread");
        tx
    });
}

/// Shows `presence`, or clears it with `None`. Never blocks on Discord.
pub fn set(presence: Option<Presence>) {
    send(Command::Set(presence));
}

/// Connects if need be and reports the status, even an unchanged one.
pub fn check() {
    send(Command::Check);
}

fn send(command: Command) {
    if let Some(worker) = WORKER.get() {
        let _ = worker.send(command);
    }
}

#[derive(Clone, PartialEq)]
enum Status {
    Connected,
    NotFound,
    Failed(String),
    Refused(String),
}

struct Reporter<E> {
    emit: E,
    last: Option<Status>,
}

impl<E: Fn(Outbound)> Reporter<E> {
    /// Logs and reports a change only, since failures are retried.
    fn report(&mut self, status: Status, force: bool) {
        let changed = self.last.as_ref() != Some(&status);
        if changed {
            match &status {
                Status::Connected => {}
                Status::NotFound => log::info!("no running Discord found"),
                Status::Failed(e) => log::info!("could not connect: {e}"),
                Status::Refused(e) => log::warn!("Discord refused the presence: {e}"),
            }
        }
        if changed || force {
            let (state, message) = match &status {
                Status::Connected => ("connected", None),
                Status::NotFound => ("not-found", None),
                Status::Failed(e) => ("failed", Some(e.clone())),
                Status::Refused(e) => ("refused", Some(e.clone())),
            };
            (self.emit)(Outbound::DiscordStatus { state, message });
        }
        self.last = Some(status);
    }

    fn open(&mut self, force: bool) -> Option<Connection> {
        match Connection::open() {
            Ok((conn, path)) => {
                log::info!("connected to {}", path.display());
                self.report(Status::Connected, force);
                Some(conn)
            }
            Err(status) => {
                self.report(status, force);
                None
            }
        }
    }
}

fn run(rx: Receiver<Command>, emit: impl Fn(Outbound)) {
    let mut reporter = Reporter { emit, last: None };
    let mut conn: Option<Connection> = None;
    let mut pending: Option<Option<Presence>> = None;
    let mut next_send = Instant::now();
    loop {
        // Waiting out the gap keeps only the newest presence.
        let received = match pending {
            Some(_) => rx.recv_timeout(next_send.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match received {
            Ok(Command::Set(presence)) => {
                pending = Some(presence);
                continue;
            }
            Ok(Command::Check) => {
                if conn.is_none() {
                    conn = reporter.open(true);
                    if conn.is_some() {
                        next_send = Instant::now();
                    }
                } else if let Some(last) = reporter.last.clone() {
                    reporter.report(last, true);
                }
                continue;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let Some(presence) = pending.take() else {
            continue;
        };
        if conn.is_none() {
            if presence.is_none() {
                continue;
            }
            conn = reporter.open(false);
        }
        let mut sent = conn.as_mut().map(|c| c.set_activity(presence.as_ref()));
        // A restarted Discord leaves a dead socket, so one retry goes to a new one.
        if let Some(Err(e)) = &sent {
            log::debug!("{e}");
            conn = reporter.open(false);
            sent = conn.as_mut().map(|c| c.set_activity(presence.as_ref()));
        }
        match sent {
            Some(Ok(refusal)) => {
                reporter.report(refusal.map_or(Status::Connected, Status::Refused), false);
                next_send = Instant::now() + GAP;
            }
            Some(Err(e)) => {
                log::debug!("{e}");
                conn = None;
                pending = Some(presence);
                next_send = Instant::now() + RETRY;
            }
            None => {
                pending = Some(presence);
                next_send = Instant::now() + RETRY;
            }
        }
    }
}

fn clip(text: &str) -> String {
    let text: String = text.trim().chars().take(128).collect();
    // Discord rejects a field shorter than two characters.
    if text.chars().count() < 2 {
        format!("{text}  ")
    } else {
        text
    }
}

fn clock(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn activity(p: &Presence) -> Value {
    let imdb = p.imdb.as_deref().filter(|id| {
        id.len() <= 12 && id.starts_with("tt") && id[2..].bytes().all(|b| b.is_ascii_digit())
    });
    let subtitle = p
        .subtitle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let duration = p.duration.filter(|d| *d > 0);
    let state = if p.paused {
        Some(match duration {
            Some(d) => format!("Paused at {} of {}", clock(p.position), clock(d)),
            None => format!("Paused at {}", clock(p.position)),
        })
    } else {
        subtitle.map(str::to_owned)
    };
    let hover = match subtitle {
        Some(sub) => format!("{} · {sub}", p.title.trim()),
        None => p.title.clone(),
    };
    let mut activity = json!({
        "type": 3,
        "details": clip(&p.title),
        "assets": { "large_image": LOGO, "large_text": clip(&hover) },
        "buttons": [{ "label": "AIOStreams", "url": REPO_URL }],
    });
    if let Some(state) = state {
        activity["state"] = json!(clip(&state));
    }
    // Names the title in the member list; browsing leaves the app's name there.
    if !p.browsing {
        activity["status_display_type"] = json!(2);
    }
    if let Some(id) = imdb {
        let page = format!("https://www.imdb.com/title/{id}/");
        activity["details_url"] = json!(page);
        activity["assets"]["large_image"] = json!(format!(
            "https://images.metahub.space/poster/medium/{id}/img"
        ));
        activity["buttons"] = json!([
            { "label": "View on IMDb", "url": page },
            { "label": "AIOStreams", "url": REPO_URL },
        ]);
    }
    if imdb.is_some() {
        activity["assets"]["small_image"] = json!(LOGO);
        activity["assets"]["small_text"] = json!("AIOStreams");
    }
    if let (false, Some(d)) = (p.paused, duration) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |t| t.as_millis() as i64);
        let start = now - p.position;
        activity["timestamps"] = json!({ "start": start, "end": start + d });
    }
    activity
}

struct Connection {
    stream: Box<dyn Stream>,
    nonce: u64,
}

trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

impl Connection {
    fn open() -> Result<(Self, PathBuf), Status> {
        let mut errors = Vec::new();
        for path in socket_paths() {
            let stream = match connect(&path) {
                Ok(stream) => stream,
                Err(e) if e.kind() == ErrorKind::NotFound => continue,
                Err(e) => {
                    errors.push(format!("{}: {e}", path.display()));
                    continue;
                }
            };
            let mut conn = Connection { stream, nonce: 0 };
            let hello = json!({ "v": 1, "client_id": CLIENT_ID });
            match conn.write(OP_HANDSHAKE, &hello).and_then(|_| conn.read()) {
                Ok(_) => return Ok((conn, path)),
                Err(e) => errors.push(format!("{}: handshake: {e}", path.display())),
            }
        }
        if errors.is_empty() {
            Err(Status::NotFound)
        } else {
            Err(Status::Failed(errors.join("; ")))
        }
    }

    /// Discord's reason, when it refuses the presence.
    fn set_activity(&mut self, presence: Option<&Presence>) -> std::io::Result<Option<String>> {
        self.nonce += 1;
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": presence.map(activity) },
            "nonce": self.nonce.to_string(),
        });
        self.write(OP_FRAME, &payload)?;
        let reply = self.read()?;
        if reply["evt"] != "ERROR" {
            return Ok(None);
        }
        let data = &reply["data"];
        Ok(Some(
            data["message"]
                .as_str()
                .map_or_else(|| data.to_string(), str::to_owned),
        ))
    }

    fn write(&mut self, op: u32, payload: &Value) -> std::io::Result<()> {
        let body = payload.to_string().into_bytes();
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(&body);
        self.stream.write_all(&frame)?;
        self.stream.flush()
    }

    fn read(&mut self) -> std::io::Result<Value> {
        let mut header = [0u8; 8];
        self.stream.read_exact(&mut header)?;
        let op = u32::from_le_bytes(header[..4].try_into().unwrap());
        let len = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
        let mut body = vec![0u8; len];
        self.stream.read_exact(&mut body)?;
        if op == OP_CLOSE {
            return Err(std::io::Error::other(format!(
                "discord closed the connection: {}",
                String::from_utf8_lossy(&body)
            )));
        }
        serde_json::from_slice(&body).map_err(std::io::Error::other)
    }
}

#[cfg(windows)]
fn socket_paths() -> Vec<PathBuf> {
    (0..10)
        .map(|i| format!(r"\\.\pipe\discord-ipc-{i}").into())
        .collect()
}

#[cfg(windows)]
fn connect(path: &std::path::Path) -> std::io::Result<Box<dyn Stream>> {
    let pipe = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    Ok(Box::new(pipe))
}

/// Flatpak clients, which keep the socket in a folder of their own.
#[cfg(unix)]
const FLATPAKS: [&str; 4] = [
    "com.discordapp.Discord",
    "dev.vencord.Vesktop",
    "org.equicord.equibop",
    "io.github.equicord.equibop",
];

#[cfg(unix)]
fn socket_paths() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let vars = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].map(std::env::var_os);
    for dir in vars
        .into_iter()
        .flatten()
        .map(PathBuf::from)
        .chain(["/tmp".into()])
    {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    let mut subs = vec![
        String::new(),
        "snap.discord".into(),
        "snap.discord-canary".into(),
    ];
    for id in FLATPAKS {
        subs.push(format!("app/{id}"));
        subs.push(format!(".flatpak/{id}/xdg-run"));
    }
    let mut out = Vec::new();
    for dir in dirs {
        for sub in &subs {
            for i in 0..10 {
                out.push(dir.join(sub).join(format!("discord-ipc-{i}")));
            }
        }
    }
    out
}

#[cfg(unix)]
fn connect(path: &std::path::Path) -> std::io::Result<Box<dyn Stream>> {
    Ok(Box::new(std::os::unix::net::UnixStream::connect(path)?))
}

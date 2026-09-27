//! Discord Rich Presence over Discord's local IPC socket.

use std::io::{Read, Write};
use std::sync::OnceLock;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Value, json};

const CLIENT_ID: &str = "1484926986865479680";
/// The application's art asset key.
const LOGO: &str = "discord";
const REPO_URL: &str = "https://github.com/Viren070/AIOStreams";
/// A presence Discord was not running for is sent again this often.
const RETRY: Duration = Duration::from_secs(30);

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;

/// What the page is playing; `position` and `duration` are milliseconds.
#[derive(Debug, Clone, Deserialize)]
pub struct Presence {
    pub title: String,
    pub subtitle: Option<String>,
    pub imdb: Option<String>,
    pub position: i64,
    pub duration: Option<i64>,
    #[serde(default)]
    pub paused: bool,
}

/// Shows `presence`, or clears it with `None`. Never blocks on Discord.
pub fn set(presence: Option<Presence>) {
    static WORKER: OnceLock<Sender<Option<Presence>>> = OnceLock::new();
    let sender = WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("discord".into())
            .spawn(move || run(rx))
            .expect("spawn the discord thread");
        tx
    });
    let _ = sender.send(presence);
}

fn run(rx: Receiver<Option<Presence>>) {
    let mut conn: Option<Connection> = None;
    let mut pending: Option<Option<Presence>> = None;
    loop {
        let next = match pending {
            Some(_) => rx.recv_timeout(RETRY),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match next {
            Ok(mut latest) => {
                while let Ok(newer) = rx.try_recv() {
                    latest = newer;
                }
                pending = Some(latest);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let Some(presence) = pending.clone() else {
            continue;
        };
        if conn.is_none() {
            if presence.is_none() {
                pending = None;
                continue;
            }
            conn = Connection::open();
        }
        let mut sent = conn.as_mut().map(|c| c.set_activity(presence.as_ref()));
        // A restarted Discord leaves a dead socket, so one retry goes to a new one.
        if let Some(Err(e)) = &sent {
            log::debug!("discord: {e}");
            conn = Connection::open();
            sent = conn.as_mut().map(|c| c.set_activity(presence.as_ref()));
        }
        match sent {
            Some(Ok(())) => pending = None,
            Some(Err(e)) => {
                log::debug!("discord: {e}");
                conn = None;
            }
            None => {}
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
        // Names the title, not the app, in the member list.
        "status_display_type": 2,
        "details": clip(&p.title),
        "assets": { "large_image": LOGO, "large_text": clip(&hover) },
        "buttons": [{ "label": "AIOStreams", "url": REPO_URL }],
    });
    if let Some(state) = state {
        activity["state"] = json!(clip(&state));
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
    fn open() -> Option<Self> {
        let stream = socket_paths()
            .into_iter()
            .find_map(|path| connect(&path).ok())?;
        let mut conn = Connection { stream, nonce: 0 };
        let hello = json!({ "v": 1, "client_id": CLIENT_ID });
        match conn.write(OP_HANDSHAKE, &hello).and_then(|_| conn.read()) {
            Ok(_) => Some(conn),
            Err(e) => {
                log::debug!("discord handshake: {e}");
                None
            }
        }
    }

    fn set_activity(&mut self, presence: Option<&Presence>) -> std::io::Result<()> {
        self.nonce += 1;
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": presence.map(activity) },
            "nonce": self.nonce.to_string(),
        });
        self.write(OP_FRAME, &payload)?;
        let reply = self.read()?;
        if reply["evt"] == "ERROR" {
            log::warn!("discord refused the presence: {}", reply["data"]);
        }
        Ok(())
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
            return Err(std::io::Error::other("discord closed the connection"));
        }
        serde_json::from_slice(&body).map_err(std::io::Error::other)
    }
}

#[cfg(windows)]
fn socket_paths() -> Vec<std::path::PathBuf> {
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

/// Discord's own sandboxed builds put the socket in a subfolder.
#[cfg(unix)]
fn socket_paths() -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(Into::into))
        .collect();
    dirs.push("/tmp".into());
    let mut out = Vec::new();
    for dir in dirs {
        for sub in ["", "app/com.discordapp.Discord", "snap.discord"] {
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

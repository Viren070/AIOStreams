//! The user's own mpv over its JSON IPC. Events come on one connection and
//! requests go on another, since Windows holds a pipe's write behind its
//! pending read.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::Backend;
use super::pipe::{self, Stream};
use crate::bridge::{OBSERVED, Outbound};
use crate::mpv::Kind;
use crate::player::{Emit, Throttle};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

const EVENTS: &[&str] = &["start-file", "file-loaded", "seek", "playback-restart"];
const END_REASONS: &[&str] = &["eof", "stop", "quit", "error", "redirect"];

pub fn candidates() -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let scoop = var("SCOOP").or_else(|| var("USERPROFILE").map(|home| home.join("scoop")));
        found.extend(scoop.map(|dir| dir.join(r"apps\mpv\current\mpv.exe")));
        found.extend(var("ProgramFiles").map(|dir| dir.join(r"mpv\mpv.exe")));
        found.extend(var("LOCALAPPDATA").map(|dir| dir.join(r"Programs\mpv\mpv.exe")));
    }
    // An app opened from the Dock or Finder gets none of the shell's PATH.
    #[cfg(target_os = "macos")]
    {
        found.push("/opt/homebrew/bin/mpv".into());
        found.push("/usr/local/bin/mpv".into());
        found.push("/Applications/mpv.app/Contents/MacOS/mpv".into());
        if let Some(home) = std::env::var_os("HOME") {
            found.push(PathBuf::from(home).join("Applications/mpv.app/Contents/MacOS/mpv"));
        }
    }
    let name = if cfg!(windows) { "mpv.exe" } else { "mpv" };
    if let Some(path) = std::env::var_os("PATH") {
        found.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    found
}

enum Message {
    Command(Vec<String>),
    SetProp(String, String),
    Sync,
    Event(Value),
    Closed,
}

pub struct Mpv {
    inbox: mpsc::Sender<Message>,
    running: Arc<AtomicBool>,
}

impl Mpv {
    pub fn start(program: &Path, emit: Emit) -> Result<Self, String> {
        let address = pipe::address();
        let mut command = Command::new(program);
        command
            // It waits between episodes for the next one, until the page quits it.
            .args(["--idle=yes", "--force-window=yes", "--keep-open=no"])
            .arg(format!("--input-ipc-server={address}"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", program.display()))?;
        log::info!(
            "external mpv started program={} pid={}",
            program.display(),
            child.id()
        );
        let (inbox, messages) = mpsc::channel();
        let running = Arc::new(AtomicBool::new(true));
        std::thread::Builder::new()
            .name("external-mpv".into())
            .spawn({
                let (inbox, running) = (inbox.clone(), running.clone());
                move || {
                    run(child, &address, inbox, &messages, &emit);
                    running.store(false, Ordering::SeqCst);
                    pipe::remove(&address);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { inbox, running })
    }

    fn send(&self, message: Message) {
        let _ = self.inbox.send(message);
    }
}

impl Backend for Mpv {
    fn command(&self, args: Vec<String>) {
        self.send(Message::Command(args));
    }

    fn set_prop(&self, name: &str, value: &str) {
        self.send(Message::SetProp(name.into(), value.into()));
    }

    fn sync(&self) {
        self.send(Message::Sync);
    }

    fn quit(&self) {
        self.command(vec!["quit".into()]);
    }

    fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

fn run(
    mut child: Child,
    address: &str,
    inbox: mpsc::Sender<Message>,
    messages: &mpsc::Receiver<Message>,
    emit: &Emit,
) {
    let connected = connect(&mut child, address).and_then(|(events, requests)| {
        let events = observe(events).map_err(|e| format!("mpv stopped answering: {e}"))?;
        Ok((events, Client::new(requests)?))
    });
    let (events, mut client) = match connected {
        Ok(connected) => connected,
        Err(error) => {
            log::warn!("external mpv: {error}");
            let _ = child.kill();
            let _ = child.wait();
            return emit(Outbound::ExternalEnded { error: Some(error) });
        }
    };
    if let Ok(version) = client.request(json!(["get_property", "mpv-version"])) {
        log::info!("external mpv connected version={version}");
    }
    let reader = std::thread::Builder::new()
        .name("external-mpv-events".into())
        .spawn(move || read_events(events, &inbox));
    if reader.is_ok() {
        serve(&mut client, messages, emit);
    }
    let status = child.wait();
    log::info!("external mpv exited status={status:?}");
    emit(Outbound::ExternalEnded { error: None });
}

fn connect(child: &mut Child, address: &str) -> Result<(Stream, Stream), String> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let mut open = || {
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("mpv closed before it was ready ({status})"));
            }
            match pipe::connect(address) {
                Ok(stream) => return Ok(stream),
                Err(_) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(e) => return Err(format!("mpv did not answer at {address}: {e}")),
            }
        }
    };
    Ok((open()?, open()?))
}

fn observe(mut events: Stream) -> std::io::Result<Stream> {
    for (id, (name, kind)) in OBSERVED.iter().enumerate() {
        let command = if *kind == Kind::String {
            "observe_property_string"
        } else {
            "observe_property"
        };
        writeln!(events, "{}", json!({ "command": [command, id, name] }))?;
    }
    Ok(events)
}

fn read_events(events: Stream, inbox: &mpsc::Sender<Message>) {
    for line in BufReader::new(events).lines() {
        let Ok(line) = line else { break };
        // Answers to the observe requests carry no event.
        if let Ok(event) = serde_json::from_str::<Value>(&line)
            && event.get("event").is_some()
            && inbox.send(Message::Event(event)).is_err()
        {
            return;
        }
    }
    let _ = inbox.send(Message::Closed);
}

/// The requests connection, which hears only the answers to its own requests.
struct Client {
    stream: Stream,
    answers: BufReader<Stream>,
    last_id: u64,
}

impl Client {
    fn new(stream: Stream) -> Result<Self, String> {
        let answers = stream
            .try_clone()
            .map(BufReader::new)
            .map_err(|e| e.to_string())?;
        let mut client = Self {
            stream,
            answers,
            last_id: 0,
        };
        client.request(json!(["disable_event", "all"]))?;
        Ok(client)
    }

    fn request(&mut self, command: Value) -> Result<Value, String> {
        self.last_id += 1;
        let id = self.last_id;
        writeln!(
            self.stream,
            "{}",
            json!({ "command": command, "request_id": id })
        )
        .map_err(|e| e.to_string())?;
        let mut line = String::new();
        loop {
            line.clear();
            if self
                .answers
                .read_line(&mut line)
                .map_err(|e| e.to_string())?
                == 0
            {
                return Err("mpv closed".into());
            }
            let Ok(answer) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if answer["request_id"] != id {
                continue;
            }
            return match answer["error"].as_str() {
                Some("success") => Ok(answer["data"].clone()),
                Some(error) => Err(error.into()),
                None => Err("no answer".into()),
            };
        }
    }
}

fn serve(client: &mut Client, messages: &mpsc::Receiver<Message>, emit: &Emit) {
    let fail = |message: String| {
        log::warn!("{message}");
        emit(Outbound::Error { message });
    };
    let mut throttle = Throttle::default();
    loop {
        match messages.recv_timeout(throttle.wait()) {
            Ok(Message::Command(args)) => {
                if let Err(e) = client.request(command(&args)) {
                    fail(format!("mpv command {args:?}: {e}"));
                }
            }
            Ok(Message::SetProp(name, value)) => {
                if let Err(e) = client.request(json!(["set_property_string", name, value])) {
                    fail(format!("mpv set {name}={value}: {e}"));
                }
            }
            Ok(Message::Sync) => {
                for (name, kind) in OBSERVED {
                    let get = if *kind == Kind::String {
                        "get_property_string"
                    } else {
                        "get_property"
                    };
                    let data = client.request(json!([get, name])).unwrap_or(Value::Null);
                    emit(prop((*name).into(), data));
                }
            }
            Ok(Message::Event(event)) => relay(&event, &mut throttle, emit),
            Ok(Message::Closed) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        for (name, data) in throttle.due() {
            emit(prop(name, data));
        }
    }
}

/// `loadfile` by name, since mpv before 0.38 takes no index argument.
fn command(args: &[String]) -> Value {
    match args {
        [name, url, flags, _index, options] if name == "loadfile" => {
            json!({ "name": name, "url": url, "flags": flags, "options": options })
        }
        _ => json!(args),
    }
}

fn prop(name: String, data: Value) -> Outbound {
    Outbound::MpvProp {
        name,
        data,
        external: true,
    }
}

fn relay(event: &Value, throttle: &mut Throttle, emit: &Emit) {
    let name = event["event"].as_str().unwrap_or_default();
    match name {
        "property-change" => {
            let Some(property) = event["name"].as_str() else {
                return;
            };
            let data = event.get("data").cloned().unwrap_or(Value::Null);
            if let Some((name, data)) = throttle.pass(property.into(), data) {
                emit(prop(name, data));
            }
        }
        "end-file" => {
            let reason = event["reason"].as_str().unwrap_or_default();
            let reason = END_REASONS
                .iter()
                .find(|r| **r == reason)
                .unwrap_or(&"unknown");
            let error = event["file_error"].as_str().map(String::from);
            match &error {
                Some(e) => log::warn!("external ended reason={reason} error=\"{e}\""),
                None => log::info!("external ended reason={reason}"),
            }
            emit(Outbound::MpvEnded {
                reason,
                error,
                external: true,
            });
        }
        _ => {
            if let Some(name) = EVENTS.iter().find(|e| **e == name) {
                emit(Outbound::MpvEvent {
                    name,
                    external: true,
                });
            }
        }
    }
}

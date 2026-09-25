use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::bridge::{self, OBSERVED, Outbound, THROTTLE_MS, THROTTLED};
use crate::mpv::{Event, Kind, Mpv};

pub type Emit = Arc<dyn Fn(Outbound) + Send + Sync>;

pub struct Player {
    mpv: Arc<Mpv>,
    emit: Emit,
    quit: Arc<AtomicBool>,
    events: Option<JoinHandle<()>>,
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
        if let Some(Value::String(v)) = mpv.get_property("mpv-version", Kind::String) {
            let ffmpeg = mpv.get_property("ffmpeg-version", Kind::String);
            log::info!(
                "{v}, ffmpeg {}",
                ffmpeg.as_ref().and_then(Value::as_str).unwrap_or("?")
            );
        }
        let quit = Arc::new(AtomicBool::new(false));
        let events = std::thread::Builder::new()
            .name("mpv-events".into())
            .spawn({
                let (mpv, emit, quit) = (mpv.clone(), emit.clone(), quit.clone());
                move || pump(&mpv, &emit, &quit)
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            mpv,
            emit,
            quit,
            events: Some(events),
        })
    }

    pub fn command(&self, args: &[Value]) -> Result<(), String> {
        let args = bridge::command(args)?;
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        self.mpv.command(&refs)
    }

    pub fn set_prop(&self, name: &str, value: &Value) -> Result<(), String> {
        let value = bridge::set_prop(name, value)?;
        self.mpv.set_property(name, &value)
    }

    pub fn sync(&self) {
        for (name, kind) in OBSERVED {
            let data = self.mpv.get_property(name, *kind).unwrap_or(Value::Null);
            (self.emit)(Outbound::MpvProp {
                name: (*name).into(),
                data,
            });
        }
    }

    pub fn stop(&self) {
        let _ = self.mpv.command(&["stop"]);
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.quit.store(true, Ordering::SeqCst);
        self.mpv.wakeup();
        if let Some(events) = self.events.take() {
            let _ = events.join();
        }
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
                } => {
                    log::log!(target: "mpv", if level == "error" || level == "fatal" { log::Level::Error } else { log::Level::Warn }, "[{prefix}] {}", text.trim_end());
                }
                Event::StartFile => emit(Outbound::MpvEvent { name: "start-file" }),
                Event::FileLoaded => emit(Outbound::MpvEvent {
                    name: "file-loaded",
                }),
                Event::Seek => emit(Outbound::MpvEvent { name: "seek" }),
                Event::PlaybackRestart => emit(Outbound::MpvEvent {
                    name: "playback-restart",
                }),
                Event::EndFile { reason, error } => {
                    if let Some(e) = &error {
                        log::warn!("playback ended: {e}");
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

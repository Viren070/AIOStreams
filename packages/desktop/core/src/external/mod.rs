//! Players installed on the computer, started in a window of their own and
//! driven through the same messages as the built-in one.

mod mpv;
mod pipe;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::bridge::{self, ExternalPlayer, Outbound};
use crate::player::Emit;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Mpv,
}

impl Kind {
    const ALL: [Kind; 1] = [Kind::Mpv];

    pub fn id(self) -> &'static str {
        match self {
            Kind::Mpv => "mpv",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    /// Where it is usually installed, most likely first.
    fn candidates(self) -> Vec<PathBuf> {
        match self {
            Kind::Mpv => mpv::candidates(),
        }
    }

    fn start(self, program: &Path, emit: Emit) -> Result<Box<dyn Backend>, String> {
        match self {
            Kind::Mpv => Ok(Box::new(mpv::Mpv::start(program, emit)?)),
        }
    }
}

/// A running player. Requests arrive in mpv's terms, already checked by the
/// bridge, and it reports back in mpv's property and event names.
trait Backend: Send {
    fn command(&self, args: Vec<String>);
    fn set_prop(&self, name: &str, value: &str);
    fn sync(&self);
    fn quit(&self);
    fn running(&self) -> bool;
}

struct Session {
    kind: Kind,
    backend: Box<dyn Backend>,
    /// Silences what a replaced or closed player still sends.
    retired: Arc<AtomicBool>,
}

impl Session {
    fn end(self) {
        self.retired.store(true, Ordering::SeqCst);
        self.backend.quit();
    }
}

pub struct External {
    emit: Emit,
    store: PathBuf,
    /// The programs the user picked, by player id.
    programs: Mutex<HashMap<String, PathBuf>>,
    session: Mutex<Option<Session>>,
}

impl External {
    pub fn new(store: PathBuf, emit: Emit) -> Self {
        let programs = std::fs::read(&store)
            .ok()
            .and_then(|json| serde_json::from_slice(&json).ok())
            .unwrap_or_default();
        Self {
            emit,
            store,
            programs: Mutex::new(programs),
            session: Mutex::default(),
        }
    }

    /// A Flatpak sandbox can't start the computer's programs.
    fn supported() -> bool {
        !cfg!(target_os = "linux") || !Path::new("/.flatpak-info").exists()
    }

    pub fn players(&self) -> Outbound {
        let players = if Self::supported() {
            Kind::ALL
                .into_iter()
                .map(|kind| ExternalPlayer {
                    id: kind.id(),
                    path: self
                        .program(kind)
                        .map(|path| path.to_string_lossy().into_owned()),
                })
                .collect()
        } else {
            Vec::new()
        };
        Outbound::ExternalPlayers { players }
    }

    fn program(&self, kind: Kind) -> Option<PathBuf> {
        let chosen = self.programs.lock().ok()?.get(kind.id()).cloned();
        chosen
            .into_iter()
            .chain(kind.candidates())
            .find(|path| path.is_file())
    }

    pub fn set_program(&self, kind: Kind, path: PathBuf) {
        log::info!("external player {} program={}", kind.id(), path.display());
        let Ok(mut programs) = self.programs.lock() else {
            return;
        };
        programs.insert(kind.id().into(), path);
        let saved = serde_json::to_vec_pretty(&*programs)
            .map_err(|e| e.to_string())
            .and_then(|json| std::fs::write(&self.store, json).map_err(|e| e.to_string()));
        if let Err(e) = saved {
            log::warn!("could not save {}: {e}", self.store.display());
        }
    }

    pub fn open(&self, kind: Kind, title: Option<&str>) {
        let Ok(mut session) = self.session.lock() else {
            return;
        };
        let open = session
            .as_ref()
            .is_some_and(|s| s.kind == kind && s.backend.running());
        if !open {
            if let Some(old) = session.take() {
                old.end();
            }
            match self.start(kind) {
                Ok(started) => *session = Some(started),
                Err(error) => {
                    log::warn!("external player {}: {error}", kind.id());
                    return (self.emit)(Outbound::ExternalEnded { error: Some(error) });
                }
            }
        }
        if let (Some(s), Some(title)) = (session.as_ref(), title) {
            s.backend.set_prop("force-media-title", title);
        }
    }

    fn start(&self, kind: Kind) -> Result<Session, String> {
        if !Self::supported() {
            return Err("this copy of the app can't start other programs".into());
        }
        let program = self.program(kind).ok_or_else(|| {
            format!(
                "{} was not found. Choose where it is installed in Settings, under Playback.",
                kind.id()
            )
        })?;
        let retired = Arc::new(AtomicBool::new(false));
        let emit: Emit = {
            let (emit, retired) = (self.emit.clone(), retired.clone());
            Arc::new(move |message| {
                if !retired.load(Ordering::SeqCst) {
                    emit(message)
                }
            })
        };
        let backend = kind.start(&program, emit)?;
        Ok(Session {
            kind,
            backend,
            retired,
        })
    }

    fn with(&self, f: impl FnOnce(&dyn Backend)) {
        if let Ok(session) = self.session.lock()
            && let Some(s) = session.as_ref()
        {
            f(s.backend.as_ref())
        }
    }

    pub fn command(&self, args: &[Value], local: &dyn Fn(&str) -> bool) -> Result<(), String> {
        let args = bridge::command(args, local)?;
        self.with(|backend| backend.command(args));
        Ok(())
    }

    pub fn set_prop(&self, name: &str, value: &Value) -> Result<(), String> {
        let value = bridge::set_prop(name, value)?;
        self.with(|backend| backend.set_prop(name, &value));
        Ok(())
    }

    pub fn sync(&self) {
        self.with(|backend| backend.sync());
    }

    pub fn add_subtitle(&self, path: &Path, title: &str) {
        self.with(|backend| {
            backend.command(vec![
                "sub-add".into(),
                path.to_string_lossy().into_owned(),
                "select".into(),
                title.into(),
            ])
        });
    }

    pub fn close(&self) {
        if let Ok(mut session) = self.session.lock()
            && let Some(s) = session.take()
        {
            s.end();
        }
    }
}

impl Drop for External {
    fn drop(&mut self) {
        self.close();
    }
}

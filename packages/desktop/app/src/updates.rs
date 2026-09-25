//! Updates from the release feeds, for a copy installed or packed by Velopack.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use aiostreams_desktop_core::bridge::{Outbound, UpdateChannel};
use velopack::locator::{LocationContext, auto_locate_app_manifest};
use velopack::sources::HttpSource;
use velopack::{UpdateCheck, UpdateInfo, UpdateManager, UpdateOptions};

const RELEASES: &str = "https://github.com/Viren070/AIOStreams/releases/download";
const RECHECK: Duration = Duration::from_secs(6 * 60 * 60);
const ARCH: &str = if cfg!(target_arch = "aarch64") {
    "arm64"
} else {
    "x64"
};

/// Each channel's feed lives on one release that every build of it replaces.
fn feed(channel: UpdateChannel) -> String {
    if let Ok(url) = std::env::var("AIOSTREAMS_UPDATE_FEED") {
        return url;
    }
    match channel {
        UpdateChannel::Stable => format!("{RELEASES}/desktop/"),
        UpdateChannel::Nightly => format!("{RELEASES}/desktop-nightly/"),
    }
}

fn velopack_channel(channel: UpdateChannel) -> String {
    match channel {
        UpdateChannel::Stable => format!("win-{ARCH}"),
        UpdateChannel::Nightly => format!("win-{ARCH}-nightly"),
    }
}

pub enum Command {
    /// `None` keeps the channel this copy was installed from.
    Check(Option<UpdateChannel>),
    Apply,
}

pub struct Updater {
    commands: Sender<Command>,
}

impl Updater {
    /// Nothing to update in a build Velopack did not pack, such as `cargo run`.
    pub fn start(emit: impl Fn(Outbound) + Send + 'static) -> Option<Updater> {
        let installed = match auto_locate_app_manifest(LocationContext::FromCurrentExe) {
            Ok(locator) => locator.get_manifest_channel(),
            Err(e) => {
                log::info!("updates off: {e}");
                return None;
            }
        };
        let installed = if installed.ends_with("-nightly") {
            UpdateChannel::Nightly
        } else {
            UpdateChannel::Stable
        };
        let (commands, received) = mpsc::channel();
        std::thread::Builder::new()
            .name("updates".into())
            .spawn(move || {
                let mut state = State {
                    installed,
                    channel: installed,
                    ready: None,
                    emit,
                };
                loop {
                    match received.recv_timeout(RECHECK) {
                        Ok(Command::Check(channel)) => state.check(channel),
                        Ok(Command::Apply) => state.apply(),
                        Err(RecvTimeoutError::Timeout) => state.check(None),
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            })
            .ok()?;
        Some(Updater { commands })
    }

    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }
}

struct State<E> {
    installed: UpdateChannel,
    channel: UpdateChannel,
    /// Downloaded and waiting for a restart.
    ready: Option<(UpdateManager, UpdateInfo)>,
    emit: E,
}

impl<E: Fn(Outbound)> State<E> {
    fn report(&self, state: &'static str, version: Option<String>, error: Option<String>) {
        (self.emit)(Outbound::UpdateState {
            state,
            channel: Some(self.channel),
            version,
            error,
        });
    }

    fn manager(&self) -> Result<UpdateManager, velopack::Error> {
        let options = UpdateOptions {
            ExplicitChannel: Some(velopack_channel(self.channel)),
            // Leaving nightlies for stable goes back a version.
            AllowVersionDowngrade: self.channel != self.installed,
            ..Default::default()
        };
        UpdateManager::new(HttpSource::new(feed(self.channel)), Some(options), None)
    }

    fn check(&mut self, channel: Option<UpdateChannel>) {
        if let Some(channel) = channel.filter(|c| *c != self.channel) {
            self.channel = channel;
            self.ready = None;
        }
        if let Some((_, info)) = &self.ready {
            let version = info.TargetFullRelease.Version.clone();
            return self.report("ready", Some(version), None);
        }
        self.report("checking", None, None);
        let found = self.manager().and_then(|manager| {
            let check = manager.check_for_updates()?;
            Ok((manager, check))
        });
        match found {
            Ok((manager, UpdateCheck::UpdateAvailable(info))) => {
                let version = info.TargetFullRelease.Version.clone();
                log::info!("update found version={version} channel={:?}", self.channel);
                self.report("downloading", Some(version.clone()), None);
                match manager.download_updates(&info, None) {
                    Ok(()) => {
                        log::info!("update downloaded version={version}");
                        self.ready = Some((manager, *info));
                        self.report("ready", Some(version), None);
                    }
                    Err(e) => self.fail(e),
                }
            }
            Ok(_) => self.report("current", None, None),
            Err(e) => self.fail(e),
        }
    }

    fn apply(&self) {
        let Some((manager, info)) = &self.ready else {
            return;
        };
        log::info!("restarting into version={}", info.TargetFullRelease.Version);
        // Exits on success.
        if let Err(e) = manager.apply_updates_and_restart(&info.TargetFullRelease) {
            self.fail(e);
        }
    }

    fn fail(&self, error: velopack::Error) {
        log::warn!("update failed: {error}");
        self.report("error", None, Some(error.to_string()));
    }
}

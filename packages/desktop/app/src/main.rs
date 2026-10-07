#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;
mod logging;
mod media;
mod placement;
mod platform;
mod shell;
mod updates;

use std::cell::RefCell;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use aiostreams_desktop_core::bridge::{Inbound, Outbound, PROTOCOL_VERSION, origin};
use aiostreams_desktop_core::downloads::{self, Downloads};
use aiostreams_desktop_core::external::{self, External};
use aiostreams_desktop_core::player::Player;
use aiostreams_desktop_core::{discord, now_playing};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use updates::{Command, Updater};

#[derive(Debug)]
pub enum UserEvent {
    Emit(String),
    Fullscreen(Option<bool>),
    Minimize,
    Close,
    Sync,
    Drag,
    Resize(Edge),
    ToggleMaximize,
    WindowState,
    WindowButtons(bool),
    Link(String),
    LinksReady,
    ChoosePlayer(external::Kind),
    ChooseDownloadFolder,
}

/// The window edges the page resizes from; the system handles the others.
#[derive(Debug, Clone, Copy)]
pub enum Edge {
    North,
    NorthEast,
    NorthWest,
}

pub struct Args {
    web: Option<String>,
    web_dir: Option<PathBuf>,
    devtools: bool,
    debug_port: Option<u16>,
    link: Option<String>,
}

fn args() -> Args {
    let mut args = Args {
        web: None,
        web_dir: None,
        devtools: cfg!(debug_assertions),
        debug_port: None,
        link: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--web" => args.web = it.next(),
            "--web-dir" => args.web_dir = it.next().map(PathBuf::from),
            "--devtools" => args.devtools = true,
            "--remote-debugging-port" => args.debug_port = it.next().and_then(|p| p.parse().ok()),
            _ => match links::accept(&arg) {
                Some(link) => args.link = Some(link),
                None => log::warn!("unknown argument {arg}"),
            },
        }
    }
    args
}

fn app_dir(base: Option<PathBuf>) -> PathBuf {
    base.unwrap_or_else(std::env::temp_dir)
        .join("AIOStreams Desktop")
}

/// A portable copy's own folder. Velopack runs the app from `<root>/current`,
/// which each update replaces, and marks a portable root with `.portable`.
fn portable_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let root = exe.parent()?.parent()?;
    root.join(".portable").is_file().then(|| root.to_path_buf())
}

fn web_dir(args: &Args) -> PathBuf {
    let mut candidates: Vec<PathBuf> = args.web_dir.iter().cloned().collect();
    candidates.extend(std::env::var_os("AIOSTREAMS_WEB_DIR").map(PathBuf::from));
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from))
    {
        candidates.push(dir.join("web"));
        // Inside a macOS app bundle, beside `Contents/MacOS`.
        candidates.push(dir.join("../Resources/web"));
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/dist-standalone"
        )));
    }
    candidates
        .iter()
        .find(|dir| dir.join("index.html").is_file())
        .cloned()
        .unwrap_or_else(|| {
            platform::fatal(&format!(
                "The web app was not found. Build it with `pnpm -F @aiostreams/web build:standalone`. Looked in:\n{}",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            ))
        })
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

pub struct Served {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

/// Serves the web app's files; a path without an extension is one of its routes.
pub fn serve(root: Option<&Path>, path: &str) -> Served {
    let not_found = Served {
        status: 404,
        content_type: "text/plain",
        body: Vec::new(),
    };
    let Some(root) = root else { return not_found };
    let relative = Path::new(path.trim_start_matches('/'));
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return not_found;
    }
    let mut file = root.join(relative);
    if !file.is_file() {
        if relative.extension().is_some() {
            return not_found;
        }
        file = root.join("index.html");
    }
    match std::fs::read(&file) {
        Ok(body) => Served {
            status: 200,
            content_type: content_type(&file),
            body,
        },
        Err(_) => not_found,
    }
}

pub fn allowed_navigation(url: &str, app_origin: &str) -> bool {
    origin(url).as_deref() == Some(app_origin)
        || url.starts_with("about:")
        || url.starts_with("blob:")
}

/// Where the app keeps its files, and the day's log.
pub struct Paths {
    mpv: PathBuf,
    logs: PathBuf,
    log_file: PathBuf,
    players: PathBuf,
    subtitles: PathBuf,
    /// The download queue, kept across restarts.
    downloads: PathBuf,
    /// Where downloads go until the user picks a folder.
    download_folder: PathBuf,
}

pub struct App {
    pub args: Args,
    pub web: Option<PathBuf>,
    pub start_url: String,
    pub app_origin: String,
    pub data_dir: PathBuf,
    pub paths: Rc<Paths>,
    pub bridge: String,
}

fn about() -> String {
    format!(
        "version={} os=\"{}\" webview={}",
        env!("CARGO_PKG_VERSION"),
        platform::os_version(),
        shell::webview_version()
    )
}

fn bridge_script() -> String {
    include_str!("bridge.js")
        .replace("__PROTOCOL__", &PROTOCOL_VERSION.to_string())
        .replace(
            "__VERSION__",
            &serde_json::to_string(env!("CARGO_PKG_VERSION")).unwrap(),
        )
        .replace(
            "__PLATFORM__",
            &serde_json::to_string(platform::PLATFORM).unwrap(),
        )
        .replace(
            "__DEVICE__",
            &serde_json::to_string(&platform::device_name()).unwrap(),
        )
}

fn main() {
    // Runs Velopack's install and update hooks, which exit when they are the reason for this launch.
    let mut velopack = velopack::VelopackApp::build();
    // Only an installed copy claims the scheme, so a portable one never takes it over.
    #[cfg(windows)]
    {
        velopack = velopack
            .on_after_install_fast_callback(|_| platform::register_links())
            .on_after_update_fast_callback(|_| platform::register_links())
            .on_before_uninstall_fast_callback(|_| platform::unregister_links());
    }
    velopack.run();
    #[cfg(windows)]
    platform::claim_app_id();
    let portable = portable_root();
    let (config_dir, data_dir) = match &portable {
        Some(root) => (root.join("data"), root.join("data")),
        None => (app_dir(dirs::config_dir()), app_dir(dirs::data_local_dir())),
    };
    let download_folder = match (&portable, dirs::video_dir()) {
        (None, Some(videos)) => videos.join("AIOStreams"),
        _ => data_dir.join("downloads"),
    };
    let logs = data_dir.join("logs");
    let log_file = logging::init(&logs);
    log::info!("starting {}", about());
    let args = args();
    let Some(_instance) = platform::claim_instance(&data_dir, args.link.as_deref()) else {
        log::info!("already running; brought its window forward");
        return;
    };
    #[cfg(target_os = "linux")]
    if let Some(port) = args.debug_port {
        // SAFETY: set before the web view starts, which is what reads it.
        unsafe { std::env::set_var("WEBKIT_INSPECTOR_HTTP_SERVER", format!("127.0.0.1:{port}")) };
    }

    let web = args.web.is_none().then(|| web_dir(&args));
    let start_url = args.web.clone().unwrap_or_else(|| platform::APP_URL.into());
    log::info!(
        "paths web={} data={}",
        web.as_ref()
            .map(|dir| dir.display().to_string())
            .unwrap_or_else(|| start_url.clone()),
        data_dir.display()
    );
    let app_origin =
        origin(&start_url).unwrap_or_else(|| platform::fatal("--web: not a valid address"));
    let subtitles = data_dir.join("subtitles");
    let _ = std::fs::remove_dir_all(&subtitles);
    let paths = Rc::new(Paths {
        mpv: mpv_config_dir(&config_dir),
        logs,
        log_file,
        players: config_dir.join("players.json"),
        subtitles,
        downloads: data_dir.join("downloads.json"),
        download_folder,
    });
    shell::run(App {
        args,
        web,
        start_url,
        app_origin,
        data_dir,
        paths,
        bridge: bridge_script(),
    });
}

pub fn receive_script(message: &Outbound) -> String {
    format!("window.__aiostreamsAppReceive?.({})", message.to_json())
}

fn mpv_config_dir(config_dir: &Path) -> PathBuf {
    let dir = config_dir.join("mpv");
    let _ = std::fs::create_dir_all(&dir);
    let conf = dir.join("mpv.conf");
    if !conf.exists() {
        let _ = std::fs::write(&conf, include_str!("mpv.conf"));
    }
    dir
}

/// `emit` is called on mpv's event thread.
pub fn start_player(
    video: &platform::VideoSurface,
    mpv_dir: &Path,
    emit: impl Fn(Outbound) + Send + Sync + 'static,
) -> Player {
    let mut defaults: Vec<(&str, String)> = vec![
        ("config-dir", mpv_dir.to_string_lossy().into_owned()),
        ("config", "yes".into()),
        ("audio-client-name", "AIOStreams".into()),
    ];
    defaults.extend(platform::mpv_options(video));
    let defaults: Vec<(&str, &str)> = defaults.iter().map(|(k, v)| (*k, v.as_str())).collect();
    // The page drives playback, so these hold whatever mpv.conf says.
    let required = [
        ("idle", "yes"),
        ("keep-open", "no"),
        // With the render API, mpv's output needs the app's OpenGL context first.
        ("force-window", if cfg!(windows) { "yes" } else { "no" }),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("input-cursor", "no"),
        ("osc", "no"),
        ("osd-bar", "no"),
        ("background", "color"),
        ("background-color", "#000000"),
        ("ytdl", "no"),
    ];

    let candidates = platform::libmpv_candidates();
    let Some(library) = candidates.iter().find(|p| p.exists()) else {
        platform::fatal(&format!(
            "libmpv was not found. Looked in:\n{}",
            candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("\n")
        ));
    };
    log::info!(
        "mpv library={} config={}",
        library.display(),
        mpv_dir.display()
    );
    #[cfg(windows)]
    platform::load_vulkan_loader(library);
    let awake = Mutex::new(Awake::default());
    let emit = move |message: Outbound| {
        if let Outbound::MpvProp { name, data, .. } = &message
            && let Ok(mut awake) = awake.lock()
        {
            awake.update(name, data);
        }
        now_playing::observe(&message);
        emit(message)
    };
    Player::start(library, &defaults, &required, Arc::new(emit))
        .unwrap_or_else(|e| platform::fatal(&format!("mpv failed to start: {e}")))
}

/// `emit` is called on the player's own threads.
pub fn start_external(paths: &Paths, emit: impl Fn(Outbound) + Send + Sync + 'static) -> External {
    External::new(
        paths.players.clone(),
        Arc::new(move |message: Outbound| {
            now_playing::observe(&message);
            emit(message)
        }),
    )
}

/// `emit` is called on the download queue's thread.
pub fn start_downloads(paths: &Paths, emit: impl Fn(Outbound) + Send + 'static) -> Downloads {
    Downloads::start(paths.downloads.clone(), paths.download_folder.clone(), emit)
}

const SUBTITLE_TYPES: &[&str] = &["srt", "vtt", "ass", "ssa", "sub", "sup"];
const MAX_SUBTITLE_BYTES: usize = 10 << 20;

/// The page never names a path for mpv to open, so the app writes the file itself.
fn save_subtitle(dir: &Path, name: &str, data: &str) -> Result<PathBuf, String> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let extension = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| SUBTITLE_TYPES.contains(&e.as_str()))
        .ok_or("not a subtitle file")?;
    let bytes = BASE64.decode(data).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SUBTITLE_BYTES {
        return Err("too big".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "{}.{extension}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Keeps the display on while a file plays.
struct Awake {
    paused: bool,
    idle: bool,
    on: bool,
}

impl Default for Awake {
    fn default() -> Self {
        Self {
            paused: false,
            idle: true,
            on: false,
        }
    }
}

impl Awake {
    fn update(&mut self, name: &str, data: &serde_json::Value) {
        match name {
            "pause" => self.paused = data == true,
            "idle-active" => self.idle = data == true,
            _ => return,
        }
        let on = !self.paused && !self.idle;
        if on != self.on {
            self.on = on;
            platform::keep_awake(on);
        }
    }
}

pub fn handle(
    message: Inbound,
    player: &RefCell<Option<Player>>,
    external: &External,
    send: &dyn Fn(UserEvent),
    paths: &Paths,
    updater: &Option<Updater>,
    downloads: &Downloads,
) {
    let emit = |message: Outbound| send(UserEvent::Emit(receive_script(&message)));
    let fail = |message: String| {
        log::warn!("{message}");
        emit(Outbound::Error { message });
    };
    let player = player.borrow();
    match message {
        Inbound::MpvCommand {
            args,
            external: to_external,
        } => {
            let local = |path: &str| downloads.is_local(path);
            let done = if to_external {
                Some(external.command(&args, &local))
            } else {
                player.as_ref().map(|p| p.command(&args, &local))
            };
            if let Some(Err(e)) = done {
                fail(format!("mpv command {args:?}: {e}"));
            }
        }
        Inbound::MpvSetProp {
            name,
            value,
            external: to_external,
        } => {
            let done = if to_external {
                Some(external.set_prop(&name, &value))
            } else {
                player.as_ref().map(|p| p.set_prop(&name, &value))
            };
            if let Some(Err(e)) = done {
                fail(format!("mpv set {name}={value}: {e}"));
            }
        }
        Inbound::MpvSync { external: true } => external.sync(),
        Inbound::MpvSync { external: false } => send(UserEvent::Sync),
        Inbound::SubtitleFile {
            name,
            data,
            external: to_external,
        } => {
            let title: String = name.chars().take(200).collect();
            match save_subtitle(&paths.subtitles, &name, &data) {
                Ok(path) if to_external => external.add_subtitle(&path, &title),
                Ok(path) => {
                    if let Some(p) = player.as_ref() {
                        p.add_subtitle(&path, &title);
                    }
                }
                Err(e) => fail(format!("subtitle file {title}: {e}")),
            }
        }
        Inbound::ExternalPlayers => emit(external.players()),
        Inbound::ExternalChoose { player } => match external::Kind::parse(&player) {
            Some(kind) => send(UserEvent::ChoosePlayer(kind)),
            None => log::warn!("external-choose: unknown player {player}"),
        },
        Inbound::ExternalOpen { player, title } => match external::Kind::parse(&player) {
            Some(kind) => external.open(kind, title.as_deref()),
            None => log::warn!("external-open: unknown player {player}"),
        },
        Inbound::ExternalClose => external.close(),
        Inbound::Fullscreen { value } => send(UserEvent::Fullscreen(value)),
        Inbound::Minimize => send(UserEvent::Minimize),
        Inbound::WindowDrag => send(UserEvent::Drag),
        Inbound::WindowResize { edge } => match edge.as_str() {
            "n" => send(UserEvent::Resize(Edge::North)),
            "ne" => send(UserEvent::Resize(Edge::NorthEast)),
            "nw" => send(UserEvent::Resize(Edge::NorthWest)),
            _ => log::warn!("window-resize: unknown edge {edge}"),
        },
        Inbound::WindowMaximize => send(UserEvent::ToggleMaximize),
        Inbound::WindowState => send(UserEvent::WindowState),
        Inbound::WindowButtons { visible } => send(UserEvent::WindowButtons(visible)),
        Inbound::Close => send(UserEvent::Close),
        Inbound::AppInfo => {
            let (mpv, ffmpeg) = player.as_ref().map(Player::versions).unwrap_or_default();
            emit(Outbound::AppInfo {
                app: env!("CARGO_PKG_VERSION"),
                platform: platform::PLATFORM,
                mpv,
                ffmpeg,
            });
        }
        Inbound::OpenMpvConfig => platform::open_external(&paths.mpv.to_string_lossy()),
        Inbound::OpenLogs => platform::open_external(&paths.logs.to_string_lossy()),
        Inbound::Diagnostics { web, server } => {
            let (mpv, ffmpeg) = player.as_ref().map(Player::versions).unwrap_or_default();
            let text = format!(
                "AIOStreams Desktop {}\nweb=\"{}\" server=\"{}\"\nmpv=\"{}\" ffmpeg={}\nlog={}\n\n{}",
                about(),
                web.unwrap_or_default(),
                server.unwrap_or_default(),
                mpv.unwrap_or_default(),
                ffmpeg.unwrap_or_default(),
                paths.log_file.display(),
                logging::tail(&paths.log_file, 300)
            );
            emit(Outbound::Diagnostics { text });
        }
        Inbound::UpdateCheck { channel } => match updater {
            Some(updater) => updater.send(Command::Check(channel)),
            None => emit(Outbound::UpdateState {
                state: "off",
                channel: None,
                version: None,
                error: None,
            }),
        },
        Inbound::UpdateApply => {
            if let Some(updater) = updater {
                updater.send(Command::Apply);
            }
        }
        Inbound::Presence { presence } => now_playing::browsing(presence),
        Inbound::NowPlaying { item } => now_playing::set_item(item),
        Inbound::DiscordCheck => discord::check(),
        Inbound::LinksReady => send(UserEvent::LinksReady),
        Inbound::DownloadAdd { jobs } => downloads.send(downloads::Command::Add(jobs)),
        Inbound::DownloadControl { id, action } => match action.as_str() {
            "pause" => downloads.send(downloads::Command::Pause(id)),
            "resume" => downloads.send(downloads::Command::Resume(id)),
            "retry" => downloads.send(downloads::Command::Retry(id)),
            _ => log::warn!("download-control: unknown action {action}"),
        },
        Inbound::DownloadRemove { id, files } => {
            downloads.send(downloads::Command::Remove { id, files })
        }
        Inbound::DownloadList => downloads.send(downloads::Command::List),
        Inbound::DownloadFolder => send(UserEvent::ChooseDownloadFolder),
        Inbound::DownloadOpen { id } => {
            let folder = id
                .and_then(|id| downloads.job_folder(&id))
                .unwrap_or_else(|| downloads.folder());
            let _ = std::fs::create_dir_all(&folder);
            platform::open_external(&folder.to_string_lossy());
        }
        Inbound::DownloadConfig { concurrent } => {
            downloads.send(downloads::Command::SetConcurrent(concurrent))
        }
        Inbound::WebError { message } => {
            let message: String = message.chars().take(4000).collect();
            log::error!(target: "web", "{message}");
        }
    }
}

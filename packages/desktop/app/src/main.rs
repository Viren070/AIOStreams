#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod logging;
mod platform;
mod shell;
mod updates;

use std::cell::RefCell;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

use aiostreams_desktop_core::bridge::{Inbound, Outbound, PROTOCOL_VERSION, origin};
use aiostreams_desktop_core::player::Player;
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
}

fn args() -> Args {
    let mut args = Args {
        web: None,
        web_dir: None,
        devtools: cfg!(debug_assertions),
        debug_port: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--web" => args.web = it.next(),
            "--web-dir" => args.web_dir = it.next().map(PathBuf::from),
            "--devtools" => args.devtools = true,
            "--remote-debugging-port" => args.debug_port = it.next().and_then(|p| p.parse().ok()),
            _ => log::warn!("unknown argument {arg}"),
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
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../jellyfin-web/dist-standalone"
        )));
    }
    candidates
        .iter()
        .find(|dir| dir.join("index.html").is_file())
        .cloned()
        .unwrap_or_else(|| {
            platform::fatal(&format!(
                "The web app was not found. Build it with `pnpm -F @aiostreams/jellyfin-web build:standalone`. Looked in:\n{}",
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
    velopack::VelopackApp::build().run();
    let (config_dir, data_dir) = match portable_root() {
        Some(root) => (root.join("data"), root.join("data")),
        None => (app_dir(dirs::config_dir()), app_dir(dirs::data_local_dir())),
    };
    let logs = data_dir.join("logs");
    let log_file = logging::init(&logs);
    log::info!("starting {}", about());
    let Some(_instance) = platform::claim_instance(&data_dir) else {
        log::info!("already running; brought its window forward");
        return;
    };
    let args = args();
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
    let paths = Rc::new(Paths {
        mpv: mpv_config_dir(&config_dir),
        logs,
        log_file,
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
    format!("window.__aiostreamsDesktopReceive?.({})", message.to_json())
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
    Player::start(library, &defaults, &required, Arc::new(emit))
        .unwrap_or_else(|e| platform::fatal(&format!("mpv failed to start: {e}")))
}

pub fn handle(
    message: Inbound,
    player: &RefCell<Option<Player>>,
    send: &dyn Fn(UserEvent),
    paths: &Paths,
    updater: &Option<Updater>,
) {
    let fail = |message: String| {
        log::warn!("{message}");
        send(UserEvent::Emit(receive_script(&Outbound::Error {
            message,
        })));
    };
    let player = player.borrow();
    match message {
        Inbound::MpvCommand { args } => {
            if let Some(Err(e)) = player.as_ref().map(|p| p.command(&args)) {
                fail(format!("mpv command {args:?}: {e}"));
            }
        }
        Inbound::MpvSetProp { name, value } => {
            if let Some(Err(e)) = player.as_ref().map(|p| p.set_prop(&name, &value)) {
                fail(format!("mpv set {name}={value}: {e}"));
            }
        }
        Inbound::MpvSync => send(UserEvent::Sync),
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
        Inbound::Close => send(UserEvent::Close),
        Inbound::AppInfo => {
            let (mpv, ffmpeg) = player.as_ref().map(Player::versions).unwrap_or_default();
            let info = Outbound::AppInfo {
                app: env!("CARGO_PKG_VERSION"),
                platform: platform::PLATFORM,
                mpv,
                ffmpeg,
            };
            send(UserEvent::Emit(receive_script(&info)));
        }
        Inbound::OpenMpvConfig => platform::open_external(&paths.mpv.to_string_lossy()),
        Inbound::OpenLogs => platform::open_external(&paths.logs.to_string_lossy()),
        Inbound::Diagnostics => {
            let (mpv, ffmpeg) = player.as_ref().map(Player::versions).unwrap_or_default();
            let text = format!(
                "AIOStreams Desktop {}\nmpv=\"{}\" ffmpeg={}\nlog={}\n\n{}",
                about(),
                mpv.unwrap_or_default(),
                ffmpeg.unwrap_or_default(),
                paths.log_file.display(),
                logging::tail(&paths.log_file, 300)
            );
            send(UserEvent::Emit(receive_script(&Outbound::Diagnostics {
                text,
            })));
        }
        Inbound::UpdateCheck { channel } => match updater {
            Some(updater) => updater.send(Command::Check(channel)),
            None => send(UserEvent::Emit(receive_script(&Outbound::UpdateState {
                state: "off",
                channel: None,
                version: None,
                error: None,
            }))),
        },
        Inbound::UpdateApply => {
            if let Some(updater) = updater {
                updater.send(Command::Apply);
            }
        }
        Inbound::WebError { message } => {
            let message: String = message.chars().take(4000).collect();
            log::error!(target: "web", "{message}");
        }
    }
}

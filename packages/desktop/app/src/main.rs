#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

use std::borrow::Cow;
use std::cell::RefCell;
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

use aiostreams_desktop_core::bridge::{Inbound, Outbound, PROTOCOL_VERSION, origin};
use aiostreams_desktop_core::player::Player;
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, Window, WindowBuilder};
use wry::http::{Request, Response};
use wry::{
    NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder, WebViewBuilderExtWindows,
};

#[derive(Debug)]
enum UserEvent {
    Emit(String),
    Fullscreen(Option<bool>),
    Minimize,
    Close,
    Sync,
}

struct Args {
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

/// Serves the web app's files; a path without an extension is one of its routes.
fn serve(root: &Path, path: &str) -> Response<Cow<'static, [u8]>> {
    let relative = Path::new(path.trim_start_matches('/'));
    let not_found = || {
        Response::builder()
            .status(404)
            .body(Cow::Borrowed(&[][..]))
            .unwrap()
    };
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return not_found();
    }
    let mut file = root.join(relative);
    if !file.is_file() {
        if relative.extension().is_some() {
            return not_found();
        }
        file = root.join("index.html");
    }
    match std::fs::read(&file) {
        Ok(body) => Response::builder()
            .header("Content-Type", content_type(&file))
            .body(Cow::Owned(body))
            .unwrap(),
        Err(_) => not_found(),
    }
}

fn page_bounds(size: PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    }
}

fn set_fullscreen(window: &Window, value: Option<bool>) {
    let on = value.unwrap_or(window.fullscreen().is_none());
    window.set_fullscreen(on.then_some(Fullscreen::Borderless(None)));
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let args = args();
    let config_dir = app_dir(dirs::config_dir());
    let data_dir = app_dir(dirs::data_local_dir());

    let web = args.web.is_none().then(|| web_dir(&args));
    let start_url = args.web.clone().unwrap_or_else(|| platform::APP_URL.into());
    let app_origin =
        origin(&start_url).unwrap_or_else(|| platform::fatal("--web: not a valid address"));

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("AIOStreams")
        .with_window_icon(platform::window_icon())
        .with_taskbar_icon(platform::window_icon())
        .with_inner_size(LogicalSize::new(1280.0, 760.0))
        .with_min_inner_size(LogicalSize::new(480.0, 320.0))
        .build(&event_loop)
        .unwrap_or_else(|e| platform::fatal(&format!("could not open a window: {e}")));
    let size = window.inner_size();

    let video = platform::VideoSurface::new(window.hwnd(), size.width, size.height)
        .unwrap_or_else(|e| platform::fatal(&e));
    let mpv_dir = mpv_config_dir(&config_dir);
    let player = Rc::new(RefCell::new(Some(start_player(
        &video,
        &mpv_dir,
        proxy.clone(),
    ))));

    let mut context = WebContext::new(Some(data_dir.join("WebView2")));
    let mut browser_args =
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();
    if let Some(port) = args.debug_port {
        browser_args.push_str(&format!(" --remote-debugging-port={port}"));
    }
    let bridge = include_str!("bridge.js")
        .replace("__PROTOCOL__", &PROTOCOL_VERSION.to_string())
        .replace(
            "__VERSION__",
            &serde_json::to_string(env!("CARGO_PKG_VERSION")).unwrap(),
        )
        .replace(
            "__PLATFORM__",
            &serde_json::to_string(platform::PLATFORM).unwrap(),
        );
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(page_bounds(size))
        .with_transparent(true)
        .with_devtools(args.devtools)
        .with_additional_browser_args(browser_args)
        .with_initialization_script(bridge)
        .with_custom_protocol(
            "aiostreams".into(),
            move |_, req: Request<Vec<u8>>| match &web {
                Some(root) => serve(root, req.uri().path()),
                None => serve(Path::new(""), ""),
            },
        )
        .with_ipc_handler({
            let (player, proxy, app_origin) = (player.clone(), proxy.clone(), app_origin.clone());
            let mpv_dir = mpv_dir.clone();
            move |req: Request<String>| {
                let from = origin(&req.uri().to_string()).unwrap_or_default();
                if from != app_origin {
                    return log::warn!("ignored a message from {from}");
                }
                match serde_json::from_str::<Inbound>(req.body()) {
                    Ok(message) => handle(message, &player, &proxy, &mpv_dir),
                    Err(e) => log::warn!("bad message: {e}"),
                }
            }
        })
        .with_navigation_handler({
            let app_origin = app_origin.clone();
            move |url| {
                let allowed = origin(&url).as_deref() == Some(app_origin.as_str())
                    || url.starts_with("about:")
                    || url.starts_with("blob:");
                if !allowed {
                    platform::open_external(&url);
                }
                allowed
            }
        })
        .with_new_window_req_handler(|url, _| {
            platform::open_external(&url);
            NewWindowResponse::Deny
        })
        .with_on_page_load_handler({
            let player = player.clone();
            move |event, _| {
                // A new page never owns the video the last one started.
                if let (PageLoadEvent::Started, Some(p)) = (event, player.borrow().as_ref()) {
                    p.stop();
                }
            }
        })
        .with_url(start_url)
        .build_as_child(&window)
        .unwrap_or_else(|e| platform::fatal(&format!("could not start WebView2: {e}")));
    video.resize(size.width, size.height);

    let mut fullscreen = false;
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        let emit = |message: Outbound| {
            let _ = webview.evaluate_script(&receive_script(&message));
        };
        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                video.resize(size.width, size.height);
                let _ = webview.set_bounds(page_bounds(size));
                let now = window.fullscreen().is_some();
                if now != fullscreen {
                    fullscreen = now;
                    emit(Outbound::Fullscreen { value: now });
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(UserEvent::Close) => {
                player.borrow_mut().take();
                *flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::Emit(script)) => {
                let _ = webview.evaluate_script(&script);
            }
            Event::UserEvent(UserEvent::Fullscreen(value)) => set_fullscreen(&window, value),
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::Sync) => {
                if let Some(p) = player.borrow().as_ref() {
                    p.sync();
                }
                emit(Outbound::Fullscreen { value: fullscreen });
            }
            _ => {}
        }
    });
}

fn receive_script(message: &Outbound) -> String {
    format!("window.__aiostreamsDesktopReceive?.({})", message.to_json())
}

/// A `portable_config` folder beside the app wins, as in mpv's own builds.
fn mpv_config_dir(config_dir: &std::path::Path) -> PathBuf {
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("portable_config")))
        .filter(|dir| dir.is_dir());
    let dir = portable.unwrap_or_else(|| config_dir.join("mpv"));
    let _ = std::fs::create_dir_all(&dir);
    let conf = dir.join("mpv.conf");
    if !conf.exists() {
        let _ = std::fs::write(&conf, include_str!("mpv.conf"));
    }
    dir
}

fn start_player(
    video: &platform::VideoSurface,
    mpv_dir: &Path,
    proxy: EventLoopProxy<UserEvent>,
) -> Player {
    log::info!("mpv config from {}", mpv_dir.display());
    let mut defaults: Vec<(&str, String)> = vec![
        ("config-dir", mpv_dir.to_string_lossy().into_owned()),
        ("config", "yes".into()),
        ("audio-client-name", "AIOStreams".into()),
    ];
    defaults.extend(platform::mpv_options(&video.wid()));
    let defaults: Vec<(&str, &str)> = defaults.iter().map(|(k, v)| (*k, v.as_str())).collect();
    // The page drives playback, so these hold whatever mpv.conf says.
    let required = [
        ("idle", "yes"),
        ("keep-open", "no"),
        ("force-window", "yes"),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("input-cursor", "no"),
        ("osc", "no"),
        ("osd-bar", "no"),
        ("background", "color"),
        ("background-color", "#000000"),
        ("ytdl", "no"),
    ];

    let emit = Arc::new(move |message: Outbound| {
        let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
    });
    let candidates = platform::libmpv_candidates();
    let Some(library) = candidates.iter().find(|p| p.exists()) else {
        platform::fatal(&format!(
            "libmpv-2.dll was not found. Looked in:\n{}",
            candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join("\n")
        ));
    };
    log::info!("libmpv from {}", library.display());
    Player::start(library, &defaults, &required, emit)
        .unwrap_or_else(|e| platform::fatal(&format!("mpv failed to start: {e}")))
}

fn handle(
    message: Inbound,
    player: &RefCell<Option<Player>>,
    proxy: &EventLoopProxy<UserEvent>,
    mpv_dir: &Path,
) {
    let fail = |message: String| {
        log::warn!("{message}");
        let _ = proxy.send_event(UserEvent::Emit(receive_script(&Outbound::Error {
            message,
        })));
    };
    let send = |event: UserEvent| {
        let _ = proxy.send_event(event);
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
        Inbound::OpenMpvConfig => platform::open_external(&mpv_dir.to_string_lossy()),
    }
}

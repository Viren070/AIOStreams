#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

use std::borrow::Cow;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use aiostreams_desktop_core::bridge::{Inbound, Outbound, PROTOCOL_VERSION};
use aiostreams_desktop_core::player::Player;
use aiostreams_desktop_core::settings::{self, Settings};
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::WindowExtWindows;
use tao::window::{Fullscreen, Window, WindowBuilder};
use wry::http::{Request, Response};
use wry::{
    NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder, WebViewBuilderExtWindows,
};

#[derive(Debug)]
enum UserEvent {
    Emit(String),
    Navigate(String),
    Fullscreen(Option<bool>),
    Minimize,
    Close,
    Sync,
}

struct Args {
    server: Option<String>,
    reset: bool,
    devtools: bool,
    debug_port: Option<u16>,
}

fn args() -> Args {
    let mut args = Args {
        server: None,
        reset: false,
        devtools: cfg!(debug_assertions),
        debug_port: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--server" => args.server = it.next(),
            "--reset" => args.reset = true,
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

fn web_url(server: &str) -> String {
    format!("{server}/web")
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

    let mut stored = if args.reset {
        Settings::default()
    } else {
        settings::load(&config_dir)
    };
    if let Some(server) = &args.server {
        match settings::normalize_server(server) {
            Ok(s) => stored.server = Some(s),
            Err(e) => platform::fatal(&format!("--server: {e}")),
        }
    }
    let _ = settings::save(&config_dir, &stored);

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("AIOStreams")
        .with_inner_size(LogicalSize::new(1280.0, 760.0))
        .with_min_inner_size(LogicalSize::new(480.0, 320.0))
        .build(&event_loop)
        .unwrap_or_else(|e| platform::fatal(&format!("could not open a window: {e}")));
    let size = window.inner_size();

    let video = platform::VideoSurface::new(window.hwnd(), size.width, size.height)
        .unwrap_or_else(|e| platform::fatal(&e));
    let player = Rc::new(RefCell::new(Some(start_player(
        &video,
        &config_dir,
        proxy.clone(),
    ))));

    let server = Arc::new(Mutex::new(stored.server.clone()));
    let origin_of = |url: &str| settings::origin(url).unwrap_or_default();
    let setup_origin = origin_of(platform::SETUP_URL);

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
    let start_url = stored
        .server
        .as_deref()
        .map(web_url)
        .unwrap_or_else(|| platform::SETUP_URL.into());

    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(page_bounds(size))
        .with_transparent(true)
        .with_devtools(args.devtools)
        .with_additional_browser_args(browser_args)
        .with_initialization_script(bridge)
        .with_custom_protocol("aiostreams".into(), {
            let server = server.clone();
            move |_, _| setup_page(server_value(&server))
        })
        .with_ipc_handler({
            let (server, player, proxy, setup_origin) = (
                server.clone(),
                player.clone(),
                proxy.clone(),
                setup_origin.clone(),
            );
            let config_dir = config_dir.clone();
            move |req: Request<String>| {
                let from = origin_of(&req.uri().to_string());
                let server_origin = server.lock().unwrap().as_deref().map(origin_of);
                let message: Inbound = match serde_json::from_str(req.body()) {
                    Ok(m) => m,
                    Err(e) => return log::warn!("bad message from {from}: {e}"),
                };
                if from == setup_origin {
                    if let Inbound::SetServer { url } = message {
                        choose_server(&url, &server, &config_dir, &proxy);
                    }
                    return;
                }
                if server_origin.as_deref() != Some(from.as_str()) {
                    return log::warn!("ignored a message from {from}");
                }
                handle(message, &player, &proxy);
            }
        })
        .with_navigation_handler({
            let (server, setup_origin) = (server.clone(), setup_origin.clone());
            move |url| {
                let to = origin_of(&url);
                let allowed = to == setup_origin
                    || server.lock().unwrap().as_deref().map(origin_of).as_deref()
                        == Some(to.as_str())
                    || url.starts_with("about:");
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
            Event::UserEvent(UserEvent::Navigate(url)) => {
                let _ = webview.load_url(&url);
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
    config_dir: &std::path::Path,
    proxy: EventLoopProxy<UserEvent>,
) -> Player {
    let mpv_dir = mpv_config_dir(config_dir);
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

fn handle(message: Inbound, player: &RefCell<Option<Player>>, proxy: &EventLoopProxy<UserEvent>) {
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
        Inbound::ChangeServer => send(UserEvent::Navigate(platform::SETUP_URL.into())),
        Inbound::SetServer { .. } => {}
    }
}

fn server_value(server: &Mutex<Option<String>>) -> String {
    serde_json::to_string(server.lock().unwrap().as_deref().unwrap_or("")).unwrap()
}

fn setup_page(server: String) -> Response<Cow<'static, [u8]>> {
    let html = include_str!("setup.html").replace("__SERVER__", &server);
    Response::builder()
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Cow::Owned(html.into_bytes()))
        .unwrap()
}

fn choose_server(
    input: &str,
    server: &Mutex<Option<String>>,
    config_dir: &std::path::Path,
    proxy: &EventLoopProxy<UserEvent>,
) {
    match settings::normalize_server(input) {
        Ok(url) => {
            log::info!("server set to {url}");
            *server.lock().unwrap() = Some(url.clone());
            let _ = settings::save(
                config_dir,
                &Settings {
                    server: Some(url.clone()),
                },
            );
            let _ = proxy.send_event(UserEvent::Navigate(web_url(&url)));
        }
        Err(message) => {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&Outbound::Error {
                message,
            })));
        }
    }
}

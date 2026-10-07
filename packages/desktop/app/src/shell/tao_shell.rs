use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use aiostreams_desktop_core::bridge::{Inbound, Outbound, origin};
use aiostreams_desktop_core::discord;
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopWindowTarget};
#[cfg(target_os = "macos")]
use tao::platform::macos::WindowBuilderExtMacOS;
#[cfg(windows)]
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Fullscreen, ResizeDirection, Window, WindowBuilder};
#[cfg(windows)]
use wry::WebViewBuilderExtWindows;
use wry::http::{Request, Response};
use wry::{NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder};

use crate::links::Inbox;
use crate::media;
use crate::placement::{self, MIN_SIZE, Placement, SETTLE};
use crate::updates::Updater;
use crate::{
    App, Edge, UserEvent, allowed_navigation, handle, platform, receive_script, serve,
    start_downloads, start_external, start_player,
};
use aiostreams_desktop_core::downloads::Command as DownloadCommand;

pub fn webview_version() -> String {
    wry::webview_version().unwrap_or_else(|_| "missing".into())
}

fn page_bounds(size: PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    }
}

/// tao keeps a maximized frameless window's content off the taskbar even in
/// fullscreen, so the window leaves maximized first and goes back after.
fn set_fullscreen(window: &Window, value: Option<bool>, remaximize: &mut bool) {
    let on = value.unwrap_or(window.fullscreen().is_none());
    if on == window.fullscreen().is_some() {
        return;
    }
    if on {
        *remaximize = window.is_maximized();
        if *remaximize {
            window.set_maximized(false);
        }
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
    } else {
        window.set_fullscreen(None);
        if std::mem::take(remaximize) {
            window.set_maximized(true);
        }
    }
}

fn start_position(
    target: &EventLoopWindowTarget<UserEvent>,
    saved: &Placement,
) -> Option<PhysicalPosition<i32>> {
    if let Some((x, y)) = saved.position {
        let on_screen = target.available_monitors().any(|m| {
            let (origin, size) = (m.position(), m.size());
            let middle = x + (saved.width as f64 * m.scale_factor() / 2.0) as i32;
            (origin.x..origin.x + size.width as i32).contains(&middle)
                && (origin.y..origin.y + size.height as i32).contains(&(y + 16))
        });
        if on_screen {
            return Some(PhysicalPosition::new(x, y));
        }
    }
    let m = target.primary_monitor()?;
    let (origin, size, scale) = (m.position(), m.size(), m.scale_factor());
    let width = (saved.width as f64 * scale) as i32;
    let height = (saved.height as f64 * scale) as i32;
    Some(PhysicalPosition::new(
        origin.x + ((size.width as i32 - width) / 2).max(0),
        origin.y + ((size.height as i32 - height) / 2).max(0),
    ))
}

/// Read once the window settles, since a maximize reports its new bounds before its new state.
fn record(window: &Window, placement: &mut Placement) {
    if window.fullscreen().is_some() || window.is_minimized() {
        return;
    }
    placement.maximized = window.is_maximized();
    if !placement.maximized {
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        placement.width = size.width.round() as u32;
        placement.height = size.height.round() as u32;
        if let Ok(p) = window.outer_position() {
            placement.position = Some((p.x, p.y));
        }
    }
}

fn direction(edge: Edge) -> ResizeDirection {
    match edge {
        Edge::North => ResizeDirection::North,
        Edge::NorthEast => ResizeDirection::NorthEast,
        Edge::NorthWest => ResizeDirection::NorthWest,
    }
}

pub fn run(app: App) {
    let App {
        args,
        web,
        start_url,
        app_origin,
        data_dir,
        paths,
        bridge,
    } = app;
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let inbox = Rc::new(RefCell::new(Inbox::default()));
    if let Some(link) = args.link.clone() {
        inbox.borrow_mut().receive(link);
    }
    #[cfg(windows)]
    platform::listen_links(&data_dir, {
        let proxy = proxy.clone();
        move |link| {
            let _ = proxy.send_event(UserEvent::Link(link));
        }
    });
    #[cfg(target_os = "macos")]
    let _menu = platform::install_menu({
        let proxy = proxy.clone();
        move || {
            let _ = proxy.send_event(UserEvent::Close);
        }
    });
    let mut placement = placement::load(&data_dir);
    let builder = WindowBuilder::new()
        .with_title("AIOStreams")
        .with_window_icon(platform::window_icon())
        .with_inner_size(LogicalSize::new(placement.width, placement.height))
        .with_min_inner_size(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1))
        .with_maximized(placement.maximized);
    let builder = match start_position(&event_loop, &placement) {
        Some(position) => builder.with_position(position),
        None => builder,
    };
    // macOS keeps its own window buttons, drawn over the page.
    #[cfg(target_os = "macos")]
    let builder = builder
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true);
    // tao shows a visible window at its restored size before maximizing it.
    #[cfg(windows)]
    let builder = builder
        .with_visible(false)
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_window_classname(platform::WINDOW_CLASS)
        .with_taskbar_icon(platform::window_icon());
    let window = builder
        .build(&event_loop)
        .unwrap_or_else(|e| platform::fatal(&format!("could not open a window: {e}")));
    let size = window.inner_size();

    let video = platform::VideoSurface::new(&window).unwrap_or_else(|e| platform::fatal(&e));
    let started = start_player(&video, &paths.mpv, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    });
    video.attach(started.mpv());
    let player = Rc::new(RefCell::new(Some(started)));
    let external = Rc::new(start_external(&paths, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let updater = Rc::new(Updater::start({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let downloads = Rc::new(start_downloads(&paths, {
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));
    let keys = {
        let proxy = proxy.clone();
        move |key| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&Outbound::MediaKey { key })));
        }
    };
    #[cfg(windows)]
    media::start(window.hwnd(), keys);
    #[cfg(target_os = "macos")]
    media::start(keys);
    discord::start({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    });

    let mut context = WebContext::new(Some(data_dir.join(platform::WEB_DATA_DIR)));
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(page_bounds(size))
        .with_transparent(true)
        .with_devtools(args.devtools)
        .with_initialization_script(bridge)
        .with_custom_protocol("aiostreams".into(), move |_, req: Request<Vec<u8>>| {
            let served = serve(web.as_deref(), req.uri().path());
            Response::builder()
                .status(served.status)
                .header("Content-Type", served.content_type)
                .body(Cow::Owned(served.body))
                .unwrap()
        })
        .with_ipc_handler({
            let (player, proxy, app_origin) = (player.clone(), proxy.clone(), app_origin.clone());
            let (external, paths, updater) = (external.clone(), paths.clone(), updater.clone());
            let downloads = downloads.clone();
            move |req: Request<String>| {
                let from = origin(&req.uri().to_string()).unwrap_or_default();
                if from != app_origin {
                    return log::warn!("ignored a message from {from}");
                }
                let send = |event: UserEvent| {
                    let _ = proxy.send_event(event);
                };
                match serde_json::from_str::<Inbound>(req.body()) {
                    Ok(message) => handle(
                        message, &player, &external, &send, &paths, &updater, &downloads,
                    ),
                    Err(e) => log::warn!("bad message: {e}"),
                }
            }
        })
        .with_navigation_handler({
            let app_origin = app_origin.clone();
            move |url| {
                let allowed = allowed_navigation(&url, &app_origin);
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
            let (player, external, inbox) = (player.clone(), external.clone(), inbox.clone());
            move |event, _| {
                if let PageLoadEvent::Started = event {
                    inbox.borrow_mut().page_loading();
                    // A new page never owns the video the last one started.
                    if let Some(p) = player.borrow().as_ref() {
                        p.stop();
                    }
                    external.close();
                }
            }
        })
        .with_url(start_url);
    #[cfg(windows)]
    let webview = {
        let mut browser_args =
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();
        if let Some(port) = args.debug_port {
            browser_args.push_str(&format!(" --remote-debugging-port={port}"));
        }
        builder
            .with_additional_browser_args(browser_args)
            .build_as_child(&window)
    };
    #[cfg(not(windows))]
    let webview = builder.build_as_child(&window);
    let webview =
        webview.unwrap_or_else(|e| platform::fatal(&format!("could not start the web view: {e}")));
    #[cfg(windows)]
    window.set_visible(true);
    // Showing the window maximizes it.
    let size = window.inner_size();
    let _ = webview.set_bounds(page_bounds(size));
    video.resize(size.width, size.height);

    let mut fullscreen = false;
    let mut maximized = window.is_maximized();
    let mut remaximize = false;
    let mut save_at: Option<Instant> = None;
    event_loop.run(move |event, _, flow| {
        if save_at.is_some_and(|at| Instant::now() >= at) {
            save_at = None;
            record(&window, &mut placement);
            placement::save(&data_dir, &placement);
        }
        *flow = save_at.map_or(ControlFlow::Wait, ControlFlow::WaitUntil);
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
                let now = window.is_maximized();
                if now != maximized {
                    maximized = now;
                    emit(Outbound::WindowState { maximized: now });
                }
                let at = Instant::now() + SETTLE;
                save_at = Some(at);
                *flow = ControlFlow::WaitUntil(at);
            }
            Event::WindowEvent {
                event: WindowEvent::Moved(_),
                ..
            } => {
                let at = Instant::now() + SETTLE;
                save_at = Some(at);
                *flow = ControlFlow::WaitUntil(at);
            }
            // Keys go to the page, which a window brought back does not focus.
            Event::WindowEvent {
                event: WindowEvent::Focused(true),
                ..
            } => {
                let _ = webview.focus();
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(UserEvent::Close) => {
                log::info!("closing");
                record(&window, &mut placement);
                placement::save(&data_dir, &placement);
                video.shutdown();
                player.borrow_mut().take();
                external.close();
                *flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::Emit(script)) => {
                let _ = webview.evaluate_script(&script);
            }
            Event::UserEvent(UserEvent::Fullscreen(value)) => {
                set_fullscreen(&window, value, &mut remaximize)
            }
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::Drag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::Resize(edge)) => {
                let _ = window.drag_resize_window(direction(edge));
            }
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
            }
            Event::UserEvent(UserEvent::WindowState) => emit(Outbound::WindowState {
                maximized: window.is_maximized(),
            }),
            #[cfg(target_os = "macos")]
            Event::UserEvent(UserEvent::WindowButtons(visible)) => {
                platform::set_window_buttons(&window, visible)
            }
            #[cfg(target_os = "macos")]
            Event::Opened { urls } => {
                for link in urls.iter().filter_map(|u| crate::links::accept(u.as_str())) {
                    if let Some(link) = inbox.borrow_mut().receive(link) {
                        emit(Outbound::Link { url: link });
                    }
                }
            }
            Event::UserEvent(UserEvent::Link(link)) => {
                if let Some(link) = inbox.borrow_mut().receive(link) {
                    emit(Outbound::Link { url: link });
                }
            }
            Event::UserEvent(UserEvent::LinksReady) => {
                for link in inbox.borrow_mut().ready() {
                    emit(Outbound::Link { url: link });
                }
            }
            Event::UserEvent(UserEvent::ChoosePlayer(kind)) => {
                let title = format!("Choose {}", kind.id());
                if let Some(path) = platform::choose_program(&window, &title) {
                    external.set_program(kind, path);
                }
                emit(external.players());
            }
            Event::UserEvent(UserEvent::ChooseDownloadFolder) => {
                if let Some(folder) = platform::choose_folder(&window, "Choose where downloads go")
                {
                    downloads.send(DownloadCommand::SetFolder(folder));
                }
            }
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

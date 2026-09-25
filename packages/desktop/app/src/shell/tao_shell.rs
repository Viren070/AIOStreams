use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;

use aiostreams_desktop_core::bridge::{Inbound, Outbound, origin};
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
#[cfg(windows)]
use tao::platform::windows::WindowBuilderExtWindows;
use tao::window::{Fullscreen, ResizeDirection, Window, WindowBuilder};
#[cfg(windows)]
use wry::WebViewBuilderExtWindows;
use wry::http::{Request, Response};
use wry::{NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder};

use crate::updates::Updater;
use crate::{
    App, Edge, UserEvent, allowed_navigation, handle, platform, receive_script, serve, start_player,
};

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
    let builder = WindowBuilder::new()
        .with_title("AIOStreams")
        .with_decorations(false)
        .with_window_icon(platform::window_icon())
        .with_inner_size(LogicalSize::new(1280.0, 760.0))
        .with_min_inner_size(LogicalSize::new(480.0, 320.0));
    #[cfg(windows)]
    let builder = builder
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
    let updater = Rc::new(Updater::start({
        let proxy = proxy.clone();
        move |message: Outbound| {
            let _ = proxy.send_event(UserEvent::Emit(receive_script(&message)));
        }
    }));

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
            let (paths, updater) = (paths.clone(), updater.clone());
            move |req: Request<String>| {
                let from = origin(&req.uri().to_string()).unwrap_or_default();
                if from != app_origin {
                    return log::warn!("ignored a message from {from}");
                }
                let send = |event: UserEvent| {
                    let _ = proxy.send_event(event);
                };
                match serde_json::from_str::<Inbound>(req.body()) {
                    Ok(message) => handle(message, &player, &send, &paths, &updater),
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
            let player = player.clone();
            move |event, _| {
                // A new page never owns the video the last one started.
                if let (PageLoadEvent::Started, Some(p)) = (event, player.borrow().as_ref()) {
                    p.stop();
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
    video.resize(size.width, size.height);

    let mut fullscreen = false;
    let mut maximized = window.is_maximized();
    let mut remaximize = false;
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
                let now = window.is_maximized();
                if now != maximized {
                    maximized = now;
                    emit(Outbound::WindowState { maximized: now });
                }
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
                video.shutdown();
                player.borrow_mut().take();
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

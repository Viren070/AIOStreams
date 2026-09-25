use std::cell::RefCell;
use std::rc::Rc;

use aiostreams_desktop_core::bridge::{Inbound, Outbound, origin};
use aiostreams_desktop_core::player::Player;
use gtk4::prelude::*;
use gtk4::{gdk, gio, glib};
use webkit6::prelude::*;
use webkit6::{
    LoadEvent, NavigationPolicyDecision, PolicyDecisionType, UserContentInjectedFrames,
    UserScriptInjectionTime,
};

use crate::updates::Updater;
use crate::{
    App, Edge, Served, UserEvent, allowed_navigation, handle, platform, receive_script, serve,
    start_player,
};

/// The bridge posts through `window.ipc`, as wry names it on the other platforms.
const IPC_SHIM: &str = "window.ipc = { postMessage: (message) => window.webkit.messageHandlers.ipc.postMessage(message) };";

pub fn webview_version() -> String {
    format!(
        "{}.{}.{}",
        webkit6::functions::major_version(),
        webkit6::functions::minor_version(),
        webkit6::functions::micro_version()
    )
}

/// Wayland only moves or resizes a window from the press that started it.
struct Press {
    device: gdk::Device,
    button: u32,
    x: f64,
    y: f64,
    time: u32,
}

struct Shell {
    window: gtk4::Window,
    webview: webkit6::WebView,
    video: platform::VideoSurface,
    player: Rc<RefCell<Option<Player>>>,
    press: RefCell<Option<Press>>,
    main_loop: glib::MainLoop,
}

thread_local! {
    static SHELL: RefCell<Option<Rc<Shell>>> = const { RefCell::new(None) };
}

fn shell() -> Option<Rc<Shell>> {
    SHELL.with(|s| s.borrow().clone())
}

/// Runs `event` on the UI thread's next turn: a caller there may still hold the player.
fn post(event: UserEvent) {
    glib::timeout_add_once(std::time::Duration::ZERO, move || {
        if let Some(shell) = shell() {
            shell.dispatch(event);
        }
    });
}

fn respond(request: &webkit6::URISchemeRequest, served: Served) {
    let length = served.body.len() as i64;
    let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from_owned(served.body));
    let response = webkit6::URISchemeResponse::new(&stream, length);
    response.set_status(served.status.into(), None);
    response.set_content_type(served.content_type);
    request.finish_with_response(&response);
}

impl Shell {
    fn emit(&self, message: Outbound) {
        self.dispatch(UserEvent::Emit(receive_script(&message)));
    }

    fn toplevel(&self) -> Option<gdk::Toplevel> {
        self.window.surface()?.downcast().ok()
    }

    fn dispatch(&self, event: UserEvent) {
        match event {
            UserEvent::Emit(script) => self.webview.evaluate_javascript(
                &script,
                None,
                None,
                None::<&gio::Cancellable>,
                |_| {},
            ),
            UserEvent::Fullscreen(value) => {
                if value.unwrap_or(!self.window.is_fullscreen()) {
                    self.window.fullscreen();
                } else {
                    self.window.unfullscreen();
                }
            }
            UserEvent::Minimize => self.window.minimize(),
            UserEvent::Close => self.close(),
            UserEvent::Sync => {
                if let Some(p) = self.player.borrow().as_ref() {
                    p.sync();
                }
                self.emit(Outbound::Fullscreen {
                    value: self.window.is_fullscreen(),
                });
            }
            UserEvent::Drag => {
                if let (Some(p), Some(top)) = (self.press.borrow().as_ref(), self.toplevel()) {
                    top.begin_move(&p.device, p.button as i32, p.x, p.y, p.time);
                }
            }
            UserEvent::Resize(edge) => {
                let edge = match edge {
                    Edge::North => gdk::SurfaceEdge::North,
                    Edge::NorthEast => gdk::SurfaceEdge::NorthEast,
                    Edge::NorthWest => gdk::SurfaceEdge::NorthWest,
                };
                if let (Some(p), Some(top)) = (self.press.borrow().as_ref(), self.toplevel()) {
                    top.begin_resize(edge, Some(&p.device), p.button as i32, p.x, p.y, p.time);
                }
            }
            UserEvent::ToggleMaximize => {
                if self.window.is_maximized() {
                    self.window.unmaximize();
                } else {
                    self.window.maximize();
                }
            }
            UserEvent::WindowState => self.emit(Outbound::WindowState {
                maximized: self.window.is_maximized(),
            }),
        }
    }

    fn close(&self) {
        log::info!("closing");
        self.video.shutdown();
        self.player.borrow_mut().take();
        self.main_loop.quit();
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
    gtk4::init().unwrap_or_else(|e| platform::fatal(&format!("could not start GTK: {e}")));
    let window = gtk4::Window::builder()
        .title("AIOStreams")
        .default_width(1280)
        .default_height(760)
        .decorated(false)
        .build();
    window.set_size_request(480, 320);

    let video = platform::VideoSurface::new().unwrap_or_else(|e| platform::fatal(&e));
    window.set_child(Some(video.widget()));
    let started = start_player(&video, &paths.mpv, |message| {
        post(UserEvent::Emit(receive_script(&message)))
    });
    video.attach(started.mpv());
    let player = Rc::new(RefCell::new(Some(started)));
    let updater = Rc::new(Updater::start(|message| {
        post(UserEvent::Emit(receive_script(&message)))
    }));

    let context = webkit6::WebContext::new();
    context.register_uri_scheme("aiostreams", move |request| {
        let path = request.path().unwrap_or_default();
        respond(request, serve(web.as_deref(), &path));
    });
    if let Some(security) = context.security_manager() {
        security.register_uri_scheme_as_secure("aiostreams");
        security.register_uri_scheme_as_cors_enabled("aiostreams");
    }
    let storage = data_dir.join(platform::WEB_DATA_DIR);
    let session = webkit6::NetworkSession::new(
        Some(&storage.join("data").to_string_lossy()),
        Some(&storage.join("cache").to_string_lossy()),
    );
    let content = webkit6::UserContentManager::new();
    content.add_script(&webkit6::UserScript::new(
        &format!("{IPC_SHIM}\n{bridge}"),
        UserContentInjectedFrames::TopFrame,
        UserScriptInjectionTime::Start,
        &[],
        &[],
    ));
    content.register_script_message_handler("ipc", None);
    let settings = webkit6::Settings::new();
    settings.set_enable_developer_extras(args.devtools);
    let webview = webkit6::WebView::builder()
        .web_context(&context)
        .network_session(&session)
        .user_content_manager(&content)
        .settings(&settings)
        .build();
    webview.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
    video.widget().add_overlay(&webview);

    content.connect_script_message_received(Some("ipc"), {
        let (webview, player, app_origin) =
            (webview.downgrade(), player.clone(), app_origin.clone());
        let (paths, updater) = (paths.clone(), updater.clone());
        move |_, value| {
            let page = webview.upgrade().and_then(|w| w.uri()).unwrap_or_default();
            let from = origin(&page).unwrap_or_default();
            if from != app_origin {
                return log::warn!("ignored a message from {from}");
            }
            match serde_json::from_str::<Inbound>(&value.to_str()) {
                Ok(message) => handle(message, &player, &post, &paths, &updater),
                Err(e) => log::warn!("bad message: {e}"),
            }
        }
    });
    webview.connect_decide_policy({
        let app_origin = app_origin.clone();
        move |_, decision, kind| {
            let uri = decision
                .downcast_ref::<NavigationPolicyDecision>()
                .and_then(|d| d.navigation_action())
                .and_then(|mut a| a.request())
                .and_then(|r| r.uri());
            let Some(uri) = uri else { return false };
            let leave = match kind {
                PolicyDecisionType::NavigationAction => !allowed_navigation(&uri, &app_origin),
                PolicyDecisionType::NewWindowAction => true,
                _ => false,
            };
            if leave {
                platform::open_external(&uri);
                decision.ignore();
            }
            leave
        }
    });
    webview.connect_load_changed({
        let player = player.clone();
        move |_, event| {
            if let (LoadEvent::Started, Some(p)) = (event, player.borrow().as_ref()) {
                p.stop();
            }
        }
    });

    let presses = gtk4::GestureClick::new();
    presses.set_button(0);
    presses.set_propagation_phase(gtk4::PropagationPhase::Capture);
    presses.connect_pressed(|gesture, _, x, y| {
        let (Some(shell), Some(device)) = (shell(), gesture.current_event_device()) else {
            return;
        };
        *shell.press.borrow_mut() = Some(Press {
            device,
            button: gesture.current_button(),
            x,
            y,
            time: gesture.current_event_time(),
        });
    });
    webview.add_controller(presses);

    window.connect_fullscreened_notify(|w| {
        if let Some(shell) = shell() {
            shell.emit(Outbound::Fullscreen {
                value: w.is_fullscreen(),
            });
        }
    });
    window.connect_maximized_notify(|w| {
        if let Some(shell) = shell() {
            shell.emit(Outbound::WindowState {
                maximized: w.is_maximized(),
            });
        }
    });
    window.connect_is_active_notify(|w| {
        if let (true, Some(shell)) = (w.is_active(), shell()) {
            shell.webview.grab_focus();
        }
    });
    window.connect_close_request(|_| {
        if let Some(shell) = shell() {
            shell.close();
        }
        glib::Propagation::Proceed
    });

    let main_loop = glib::MainLoop::new(None, false);
    SHELL.with(|s| {
        *s.borrow_mut() = Some(Rc::new(Shell {
            window: window.clone(),
            webview: webview.clone(),
            video,
            player,
            press: RefCell::new(None),
            main_loop: main_loop.clone(),
        }))
    });
    window.present();
    webview.load_uri(&start_url);
    main_loop.run();
    SHELL.with(|s| s.borrow_mut().take());
}

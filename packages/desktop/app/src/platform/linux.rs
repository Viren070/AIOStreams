use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_int, c_void};
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use aiostreams_desktop_core::bridge::{Outbound, VideoFrame};
use aiostreams_desktop_core::mpv::Mpv;
use aiostreams_desktop_core::render::{NativeDisplay, RenderContext};
use gtk4::prelude::*;
use gtk4::{gdk, gio, glib};
use libloading::Library;

use super::small::{Small, event};

/// Custom protocols are served from `<scheme>://localhost` on Linux.
pub const APP_URL: &str = "aiostreams://localhost/";
pub const PLATFORM: &str = "linux";
pub const WEB_DATA_DIR: &str = "WebKit";

/// Held for as long as the app runs.
pub struct SingleInstance(#[allow(dead_code)] Option<std::fs::File>);

/// One copy per data folder, whose web storage two copies cannot share: a
/// second launch hands its link over and gets None.
pub fn claim_instance(data_dir: &Path, link: Option<&str>) -> Option<SingleInstance> {
    let _ = std::fs::create_dir_all(data_dir);
    let Ok(file) = std::fs::File::create(data_dir.join("instance.lock")) else {
        return Some(SingleInstance(None));
    };
    let claimed = file.try_lock().ok().map(|()| SingleInstance(Some(file)));
    if claimed.is_none()
        && let Some(link) = link
    {
        match UnixStream::connect(links_socket(data_dir)) {
            Ok(mut stream) => {
                let _ = stream.write_all(link.as_bytes());
            }
            Err(e) => log::warn!("links: could not reach the running copy: {e}"),
        }
    }
    claimed
}

fn links_socket(data_dir: &Path) -> PathBuf {
    data_dir.join("links.sock")
}

pub fn listen_links(data_dir: &Path, deliver: impl Fn(String) + Send + 'static) {
    let path = links_socket(data_dir);
    // Left by a copy that crashed: the instance lock says no other copy runs.
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(e) => return log::warn!("links: could not listen: {e}"),
    };
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut text = String::new();
            if (&stream).take(16 * 1024).read_to_string(&mut text).is_ok()
                && let Some(link) = crate::links::accept(&text)
            {
                deliver(link);
            }
        }
    });
}

type ProcFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;

/// OpenGL's function lookup, through EGL or GLX, whichever GTK made current.
struct Gl {
    egl_get_proc: Option<ProcFn>,
    egl_current: Option<unsafe extern "C" fn() -> *mut c_void>,
    glx_get_proc: Option<ProcFn>,
    _libs: Vec<Library>,
}

fn gl() -> &'static Gl {
    static GL: OnceLock<Gl> = OnceLock::new();
    GL.get_or_init(|| {
        // SAFETY: system libraries whose initialisers do not depend on us.
        let egl = unsafe { Library::new("libEGL.so.1") }.ok();
        let glx = unsafe { Library::new("libGL.so.1") }.ok();
        // SAFETY: the types match egl.h and glx.h.
        let sym = |lib: &Option<Library>, name: &[u8]| unsafe {
            lib.as_ref()
                .and_then(|l| l.get::<ProcFn>(name).ok().map(|s| *s))
        };
        Gl {
            egl_get_proc: sym(&egl, b"eglGetProcAddress\0"),
            egl_current: unsafe {
                egl.as_ref().and_then(|l| {
                    l.get::<unsafe extern "C" fn() -> *mut c_void>(b"eglGetCurrentContext\0")
                        .ok()
                        .map(|s| *s)
                })
            },
            glx_get_proc: sym(&glx, b"glXGetProcAddressARB\0"),
            _libs: egl.into_iter().chain(glx).collect(),
        }
    })
}

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    let gl = gl();
    // SAFETY: plain lookups with the name mpv passed.
    unsafe {
        if let (Some(current), Some(get)) = (gl.egl_current, gl.egl_get_proc)
            && !current().is_null()
        {
            return get(name);
        }
        gl.glx_get_proc
            .map_or(std::ptr::null_mut(), |get| get(name))
    }
}

/// The framebuffer GTK bound for this frame; a GLArea draws into its own.
fn current_fbo() -> i32 {
    const DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
    type GetIntegerv = unsafe extern "C" fn(u32, *mut c_int);
    // SAFETY: looked up for the current context, with glGetIntegerv's type.
    unsafe {
        let f = get_proc_address(std::ptr::null_mut(), c"glGetIntegerv".as_ptr());
        if f.is_null() {
            return 0;
        }
        let get: GetIntegerv = std::mem::transmute(f);
        let mut fbo: c_int = 0;
        get(DRAW_FRAMEBUFFER_BINDING, &mut fbo);
        fbo
    }
}

/// Looked up by name, since GTK may be built without one of the backends.
fn native_display(display: &gtk4::gdk::Display) -> Option<NativeDisplay> {
    type Get = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
    let (symbol, wrap): (&[u8], fn(*mut c_void) -> NativeDisplay) = match display.type_().name() {
        "GdkWaylandDisplay" => (
            c"gdk_wayland_display_get_wl_display".to_bytes_with_nul(),
            NativeDisplay::Wayland,
        ),
        "GdkX11Display" => (
            c"gdk_x11_display_get_xdisplay".to_bytes_with_nul(),
            NativeDisplay::X11,
        ),
        _ => return None,
    };
    let this = libloading::os::unix::Library::this();
    // SAFETY: GDK's getter for this display type, called with that display.
    unsafe {
        let get: Get = *this.get::<Get>(symbol).ok()?;
        let raw = get(glib::object::ObjectType::as_ptr(display).cast());
        (!raw.is_null()).then(|| wrap(raw))
    }
}

type Render = Rc<RefCell<Option<RenderContext>>>;

thread_local! {
    static AREA: RefCell<Option<gtk4::GLArea>> = const { RefCell::new(None) };
    static RENDER: RefCell<Option<Render>> = const { RefCell::new(None) };
}

/// Draws the next frame when it is due, not in mpv's own wait, which would hold up the UI thread.
fn update_video() {
    let Some(area) = AREA.with(|a| a.borrow().clone()) else {
        return;
    };
    let Some(render) = RENDER.with(|r| r.borrow().clone()) else {
        return;
    };
    let render = render.borrow();
    let Some(r) = render.as_ref() else {
        return;
    };
    // mpv's render calls need its OpenGL context current, and GTK may have left another.
    area.make_current();
    if !r.update() {
        return;
    }
    // A frame drawn in one refresh shows at the next; the timer can fire late.
    let refresh = area
        .frame_clock()
        .map(|c| c.refresh_info(0).0)
        .filter(|&us| us > 0)
        .unwrap_or(16_667);
    let lead = Duration::from_micros(refresh as u64) + Duration::from_millis(2);
    match r.next_frame_in().and_then(|wait| wait.checked_sub(lead)) {
        Some(wait) if !wait.is_zero() => {
            glib::timeout_add_local_once(wait, move || area.queue_render());
        }
        _ => area.queue_render(),
    }
}

type OnInput = Rc<RefCell<Option<Box<dyn Fn(Outbound)>>>>;

fn emit(on_input: &OnInput, message: Outbound) {
    if let Some(on_input) = on_input.borrow().as_ref() {
        on_input(message);
    }
}

/// The video moves under the pointer, so it is placed from the window's coordinates.
fn pointer(gesture: &gtk4::GestureDrag) -> Option<(f64, f64)> {
    gesture.current_event()?.position()
}

fn round(corners: &gtk4::CssProvider, (top, bottom): (f64, f64)) {
    corners.load_from_string(&format!(
        "#video {{ border-radius: {top}px {top}px {bottom}px {bottom}px; }}"
    ));
}

/// The GLArea mpv's render API draws into, beneath the web view, or over it where
/// the page's mini player leaves room.
pub struct VideoSurface {
    overlay: gtk4::Overlay,
    area: gtk4::GLArea,
    render: Render,
    small: Rc<RefCell<Option<Small>>>,
    corners: gtk4::CssProvider,
    on_input: OnInput,
    gliding: Rc<Cell<bool>>,
}

impl VideoSurface {
    pub fn new() -> Result<Self, String> {
        let overlay = gtk4::Overlay::new();
        let area = gtk4::GLArea::new();
        area.set_auto_render(false);
        area.set_widget_name("video");
        area.set_overflow(gtk4::Overflow::Hidden);
        // Not the overlay's main child, which would size the window by where it sits.
        overlay.add_overlay(&area);
        AREA.with(|a| *a.borrow_mut() = Some(area.clone()));
        let corners = gtk4::CssProvider::new();
        gtk4::style_context_add_provider_for_display(
            &WidgetExt::display(&area),
            &corners,
            gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        let small: Rc<RefCell<Option<Small>>> = Rc::default();
        overlay.connect_get_child_position({
            let small = small.clone();
            move |_, widget| {
                let small = small.borrow();
                let s = small.as_ref().filter(|_| widget.is::<gtk4::GLArea>())?;
                let px = |v: f64| v.round() as i32;
                Some(gdk::Rectangle::new(
                    px(s.at.0),
                    px(s.at.1),
                    px(s.size.0),
                    px(s.size.1),
                ))
            }
        });
        let on_input: OnInput = Rc::default();
        let drag = gtk4::GestureDrag::new();
        drag.connect_drag_begin({
            let small = small.clone();
            move |gesture, _, _| {
                let pressed = pointer(gesture)
                    .is_some_and(|at| small.borrow_mut().as_mut().is_some_and(|s| s.press(at)));
                if !pressed {
                    gesture.set_state(gtk4::EventSequenceState::Denied);
                }
            }
        });
        drag.connect_drag_update({
            let (small, overlay, corners, on_input) = (
                small.clone(),
                overlay.downgrade(),
                corners.clone(),
                on_input.clone(),
            );
            move |gesture, _, _| {
                let (Some(at), Some(overlay)) = (pointer(gesture), overlay.upgrade()) else {
                    return;
                };
                let room = (f64::from(overlay.width()), f64::from(overlay.height()));
                let moved = small.borrow_mut().as_mut().and_then(|s| {
                    let grabbed = s.drag(at, room)?;
                    Some((grabbed, s.at, s.radii))
                });
                let Some((grabbed, at, radii)) = moved else {
                    return;
                };
                if grabbed {
                    round(&corners, radii);
                    emit(&on_input, event("grabbed", None));
                }
                overlay.queue_allocate();
                emit(&on_input, event("moving", Some(at)));
            }
        });
        drag.connect_drag_end({
            let (small, on_input) = (small.clone(), on_input.clone());
            move |_, _, _| {
                let heard = small.borrow_mut().as_mut().and_then(|s| s.release(true));
                if let Some(heard) = heard {
                    emit(&on_input, heard);
                }
            }
        });
        drag.connect_cancel({
            let (small, on_input) = (small.clone(), on_input.clone());
            move |_, _| {
                let heard = small.borrow_mut().as_mut().and_then(|s| s.release(false));
                if let Some(heard) = heard {
                    emit(&on_input, heard);
                }
            }
        });
        area.add_controller(drag);

        let render: Render = Rc::default();
        RENDER.with(|r| *r.borrow_mut() = Some(render.clone()));
        area.connect_render({
            let render = render.clone();
            move |area, _| {
                if let Some(r) = render.borrow().as_ref() {
                    let scale = area.scale_factor();
                    r.draw(
                        current_fbo(),
                        area.width() * scale,
                        area.height() * scale,
                        true,
                    );
                }
                glib::Propagation::Stop
            }
        });
        Ok(Self {
            overlay,
            area,
            render,
            small,
            corners,
            on_input,
            gliding: Rc::default(),
        })
    }

    pub fn widget(&self) -> &gtk4::Overlay {
        &self.overlay
    }

    pub fn set_page(&self, page: &impl IsA<gtk4::Widget>) {
        self.overlay.set_child(Some(page));
        self.area.insert_before(&self.overlay, Some(page));
    }

    /// Hears clicks and drags on the small video, for the page.
    pub fn on_input(&self, on_input: impl Fn(Outbound) + 'static) {
        *self.on_input.borrow_mut() = Some(Box::new(on_input));
    }

    /// Over the page in `frame`, in the page's pixels; none puts it back beneath, filling the window.
    pub fn frame(&self, frame: Option<VideoFrame>) {
        let next = frame.map(|frame| Small::new(&frame, self.small.borrow().as_ref()));
        round(&self.corners, next.as_ref().map_or((0.0, 0.0), |s| s.radii));
        let lifted = next.as_ref().is_some_and(|s| !s.hidden);
        let gliding = next.as_ref().is_some_and(Small::gliding);
        *self.small.borrow_mut() = next;
        let on_top = self.area.next_sibling().is_none();
        if let Some(page) = self.overlay.child()
            && lifted != on_top
        {
            if lifted {
                self.area.insert_after(&self.overlay, Some(&page));
            } else {
                self.area.insert_before(&self.overlay, Some(&page));
            }
        }
        self.overlay.queue_allocate();
        self.area.queue_render();
        if gliding && !self.gliding.replace(true) {
            let (small, overlay, going) = (
                self.small.clone(),
                self.overlay.downgrade(),
                self.gliding.clone(),
            );
            self.area.add_tick_callback(move |_, _| {
                let more = small.borrow_mut().as_mut().is_some_and(Small::step);
                if let Some(overlay) = overlay.upgrade() {
                    overlay.queue_allocate();
                }
                going.set(more);
                if more {
                    glib::ControlFlow::Continue
                } else {
                    glib::ControlFlow::Break
                }
            });
        }
    }

    pub fn attach(&self, mpv: Arc<Mpv>) {
        let start = {
            let render = self.render.clone();
            move |area: &gtk4::GLArea| {
                area.make_current();
                if let Some(e) = area.error() {
                    return log::error!("OpenGL context: {e}");
                }
                let display = native_display(&area.display());
                let gl = area.context().map(|c| {
                    let (major, minor) = c.version();
                    format!("{:?} {major}.{minor}", c.api())
                });
                log::info!("mpv render context display={display:?} gl={gl:?}");
                match RenderContext::new(
                    mpv.clone(),
                    get_proc_address,
                    std::ptr::null_mut(),
                    display,
                    true, // advanced control
                    8,    // a GtkGLArea's default framebuffer is 8 bits a channel
                ) {
                    Ok(mut ctx) => {
                        ctx.on_update(|| {
                            glib::idle_add_once(update_video);
                        });
                        *render.borrow_mut() = Some(ctx);
                        area.queue_render();
                    }
                    Err(e) => log::error!("{e}"),
                }
            }
        };
        if self.area.is_realized() {
            start(&self.area);
        } else {
            self.area.connect_realize(start);
        }
        self.area.connect_unrealize({
            let render = self.render.clone();
            move |area| {
                area.make_current();
                render.borrow_mut().take();
            }
        });
    }

    /// The render context goes before mpv, with its OpenGL context current.
    pub fn shutdown(&self) {
        self.area.make_current();
        self.render.borrow_mut().take();
    }

    pub fn resize(&self, _width: u32, _height: u32) {}
}

/// With no file mpv stops drawing, and the last frame would show where the page is see-through.
pub fn clear_video() {
    glib::idle_add_once(|| {
        AREA.with(|a| {
            if let Some(a) = a.borrow().as_ref() {
                a.queue_render();
            }
        })
    });
}

pub fn mpv_options(_video: &VideoSurface) -> Vec<(&'static str, String)> {
    vec![("vo", "libmpv".into()), ("hwdec", "auto-safe".into())]
}

thread_local! {
    static AWAKE: RefCell<Option<Awake>> = const { RefCell::new(None) };
}

struct Awake {
    app: gtk4::Application,
    window: gtk4::Window,
    cookie: Option<u32>,
}

/// GTK holds idle off for a window of its application: through Wayland's idle
/// inhibitor where the compositor has one, else through the desktop session.
pub fn keep_awake_for(window: &gtk4::Window) {
    let app = gtk4::Application::new(
        Some("io.github.viren070.aiostreams"),
        gio::ApplicationFlags::NON_UNIQUE,
    );
    if let Err(e) = app.register(None::<&gio::Cancellable>) {
        return log::warn!("keep awake: {e}");
    }
    window.set_application(Some(&app));
    AWAKE.set(Some(Awake {
        app,
        window: window.clone(),
        cookie: None,
    }));
}

/// Called on mpv's thread.
pub fn keep_awake(on: bool) {
    glib::idle_add_once(move || {
        AWAKE.with_borrow_mut(|awake| {
            let Some(awake) = awake else { return };
            match awake.cookie.take() {
                Some(cookie) if !on => awake.app.uninhibit(cookie),
                None if on => {
                    awake.cookie = Some(awake.app.inhibit(
                        Some(&awake.window),
                        gtk4::ApplicationInhibitFlags::IDLE,
                        Some("Playing a video"),
                    ))
                }
                held => awake.cookie = held,
            }
        })
    });
}

pub fn open_external(url: &str) {
    if let Err(e) = std::process::Command::new("xdg-open").arg(url).spawn() {
        log::warn!("xdg-open {url}: {e}");
    }
}

pub fn fatal(message: &str) -> ! {
    log::error!("{message}");
    eprintln!("AIOStreams: {message}");
    std::process::exit(1)
}

/// The computer's name, which Jellyfin apps give as their device.
pub fn device_name() -> String {
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "Linux".into())
}

/// `("2026-09-24", "21:03:04.123")`.
pub fn local_time() -> (String, String) {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: both write into the zeroed structs passed.
    unsafe {
        libc::clock_gettime(libc::CLOCK_REALTIME, &mut ts);
        libc::localtime_r(&ts.tv_sec, &mut tm);
    }
    (
        format!(
            "{:04}-{:02}-{:02}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday
        ),
        format!(
            "{:02}:{:02}:{:02}.{:03}",
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
            ts.tv_nsec / 1_000_000
        ),
    )
}

/// E.g. `Ubuntu 24.04.4 LTS, kernel 6.8.0-45-generic`.
pub fn os_version() -> String {
    let name = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME="))
                .map(|v| v.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "Linux".into());
    match std::fs::read_to_string("/proc/sys/kernel/osrelease") {
        Ok(kernel) => format!("{name}, kernel {}", kernel.trim()),
        Err(_) => name,
    }
}

pub fn libmpv_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(p) = std::env::var("AIOSTREAMS_LIBMPV") {
        paths.push(PathBuf::from(p));
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from))
    {
        paths.push(dir.join("libmpv.so.2"));
    }
    for dir in [
        "/app/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
        "/usr/lib64",
        "/usr/lib",
    ] {
        paths.push(Path::new(dir).join("libmpv.so.2"));
    }
    paths
}

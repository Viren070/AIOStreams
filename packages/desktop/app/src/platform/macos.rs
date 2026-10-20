// OpenGL is deprecated on macOS, but mpv's render API has no Metal backend.
#![allow(deprecated)]

use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::ptr::{self, NonNull};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use aiostreams_desktop_core::mpv::Mpv;
use aiostreams_desktop_core::playback::Fit;
use aiostreams_desktop_core::render::RenderContext;
use dispatch2::DispatchQueue;
use muda::accelerator::Accelerator;
use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use objc2::rc::Retained;
use objc2::runtime::AnyClass;
use objc2::{
    AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class, msg_send,
};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSModalResponseOK, NSOpenPanel, NSView, NSWindow, NSWindowButton,
    NSWindowOrderingMode,
};
use objc2_core_foundation::{CFString, CFTimeInterval, CGSize};
use objc2_core_graphics::CGColor;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::{NSObject, NSString};
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLContextParameter, CGLCreateContext, CGLError,
    CGLLockContext, CGLOpenGLProfile, CGLPixelFormatAttribute, CGLPixelFormatObj, CGLRetainContext,
    CGLRetainPixelFormat, CGLSetCurrentContext, CGLSetParameter, CGLUnlockContext,
};
use objc2_quartz_core::{
    CAAutoresizingMask, CALayer, CAMetalLayer, CAOpenGLLayer, CATransaction,
    kCAContentsFormatRGBA16Float,
};
use tao::platform::macos::WindowExtMacOS;
use tao::window::{Icon, Window};

mod video;

use video::Output;

/// Custom protocols are served from `<scheme>://localhost` on macOS.
pub const APP_URL: &str = "aiostreams://localhost/";
pub const PLATFORM: &str = "macos";
pub const WEB_DATA_DIR: &str = "WebKit";

/// Held for as long as the app runs.
pub struct SingleInstance(#[allow(dead_code)] Option<std::fs::File>);

/// One copy per data folder, whose web storage two copies cannot share. The
/// system hands links to the running copy itself, as tao's `Opened` event.
pub fn claim_instance(data_dir: &Path, _link: Option<&str>) -> Option<SingleInstance> {
    let _ = std::fs::create_dir_all(data_dir);
    let Ok(file) = std::fs::File::create(data_dir.join("instance.lock")) else {
        return Some(SingleInstance(None));
    };
    file.try_lock().ok().map(|()| SingleInstance(Some(file)))
}

/// OpenGL.framework is linked through the CGL calls, so its symbols are all in reach.
unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    // SAFETY: a plain lookup with the name mpv passed.
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name) }
}

/// The framebuffer and viewport the layer bound for this frame; it draws into its own.
fn frame_target() -> (c_int, c_int, c_int) {
    const DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
    const VIEWPORT: u32 = 0x0BA2;
    type GetIntegerv = unsafe extern "C" fn(u32, *mut c_int);
    // SAFETY: looked up for the current context, with glGetIntegerv's type.
    unsafe {
        let f = get_proc_address(ptr::null_mut(), c"glGetIntegerv".as_ptr());
        if f.is_null() {
            return (0, 0, 0);
        }
        let get: GetIntegerv = std::mem::transmute(f);
        let mut fbo: c_int = 0;
        let mut viewport: [c_int; 4] = [0; 4];
        get(DRAW_FRAMEBUFFER_BINDING, &mut fbo);
        get(VIEWPORT, viewport.as_mut_ptr());
        (fbo, viewport[2], viewport[3])
    }
}

/// A 3.2 core profile, 16 float bits a channel where it can, on the discrete
/// GPU only when the system switches to it. HDR needs the float format: an
/// 8-bit drawable clips the extended range.
fn pixel_format() -> Option<(CGLPixelFormatObj, c_int)> {
    let a = |v: CGLPixelFormatAttribute| v;
    let core = CGLPixelFormatAttribute(CGLOpenGLProfile::CGLOGLPVersion_3_2_Core.0);
    let base = [
        a(CGLPixelFormatAttribute::CGLPFAOpenGLProfile),
        core,
        a(CGLPixelFormatAttribute::CGLPFAAccelerated),
        a(CGLPixelFormatAttribute::CGLPFADoubleBuffer),
        a(CGLPixelFormatAttribute::CGLPFAAllowOfflineRenderers),
        a(CGLPixelFormatAttribute::CGLPFASupportsAutomaticGraphicsSwitching),
    ];
    let float = [
        a(CGLPixelFormatAttribute::CGLPFAColorSize),
        CGLPixelFormatAttribute(64),
        a(CGLPixelFormatAttribute::CGLPFAColorFloat),
    ];
    let attempts: [(Vec<CGLPixelFormatAttribute>, c_int); 3] = [
        ([&base[..], &float[..]].concat(), 16),
        (base.to_vec(), 8),
        (
            vec![
                a(CGLPixelFormatAttribute::CGLPFAOpenGLProfile),
                core,
                a(CGLPixelFormatAttribute::CGLPFADoubleBuffer),
            ],
            8,
        ),
    ];
    attempts.into_iter().find_map(|(mut attribs, depth)| {
        attribs.push(CGLPixelFormatAttribute(0));
        let mut format: CGLPixelFormatObj = ptr::null_mut();
        let mut count = 0;
        // SAFETY: a zero-terminated list, and out-pointers to locals.
        let error = unsafe {
            CGLChoosePixelFormat(
                NonNull::new_unchecked(attribs.as_mut_ptr()),
                NonNull::from(&mut format),
                NonNull::from(&mut count),
            )
        };
        (error == CGLError::NoError && !format.is_null()).then_some((format, depth))
    })
}

pub struct LayerIvars {
    format: CGLPixelFormatObj,
    context: CGLContextObj,
    /// The framebuffer's bits a channel: 16 float where the pixel format allows, else 8.
    depth: c_int,
    render: RefCell<Option<RenderContext>>,
    mpv: RefCell<Option<Arc<Mpv>>>,
    started: Cell<bool>,
    drawn: Cell<bool>,
    skipped: Cell<u32>,
    held: Cell<Held>,
}

/// How long video draws held the main thread, over a window of time.
#[derive(Clone, Copy)]
struct Held {
    since: Instant,
    total: Duration,
    longest: Duration,
}

impl Held {
    const WINDOW: Duration = Duration::from_secs(10);

    fn new() -> Self {
        Self {
            since: Instant::now(),
            total: Duration::ZERO,
            longest: Duration::ZERO,
        }
    }

    /// Warns when draws took more than a tenth of the window, which the web view feels.
    fn add(self, took: Duration) -> Self {
        let held = Self {
            total: self.total + took,
            longest: self.longest.max(took),
            ..self
        };
        let elapsed = held.since.elapsed();
        if elapsed < Self::WINDOW {
            return held;
        }
        if held.total > elapsed / 10 {
            log::warn!(
                "video draws held the main thread {} ms/s over {} s, longest {} ms",
                held.total.as_millis() * 1000 / elapsed.as_millis().max(1),
                elapsed.as_secs(),
                held.longest.as_millis()
            );
        }
        Self::new()
    }
}

define_class!(
    /// Draws mpv's frames when mpv says one is ready, on the main thread.
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "AIOStreamsVideoLayer"]
    #[ivars = LayerIvars]
    pub struct VideoLayer;

    impl VideoLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
            // SAFETY: a format this layer owns; the caller releases the copy.
            unsafe { CGLRetainPixelFormat(self.ivars().format) }
        }

        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, _format: CGLPixelFormatObj) -> CGLContextObj {
            // SAFETY: a context this layer owns; the caller releases the copy.
            unsafe { CGLRetainContext(self.ivars().context) }
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        unsafe fn draw(
            &self,
            context: CGLContextObj,
            format: CGLPixelFormatObj,
            time: CFTimeInterval,
            display: *const CVTimeStamp,
        ) {
            // SAFETY: the context the layer made current for this call.
            unsafe { CGLSetCurrentContext(context) };
            self.ivars().drawn.set(true);
            let skipped = self.ivars().skipped.replace(0);
            if skipped > 0 {
                log::info!("video shown again after {skipped} frames skipped while hidden");
            }
            if let Some(render) = self.ivars().render.borrow().as_ref() {
                let (fbo, width, height) = frame_target();
                if width > 0 && height > 0 {
                    let start = Instant::now();
                    render.render(fbo, width, height, true);
                    let held = &self.ivars().held;
                    held.set(held.get().add(start.elapsed()));
                }
            }
            // SAFETY: the superclass flushes the context.
            unsafe {
                let _: () = msg_send![
                    super(self),
                    drawInCGLContext: context,
                    pixelFormat: format,
                    forLayerTime: time,
                    displayTime: display
                ];
            }
        }
    }
);

define_class!(
    /// mpv's swapchain over MoltenVK presents into this.
    #[unsafe(super(CAMetalLayer, CALayer, NSObject))]
    #[name = "AIOStreamsMetalLayer"]
    pub struct MetalLayer;

    impl MetalLayer {
        /// MoltenVK shrinks the drawable to 1x1 to finish a presentation, which mpv would size to.
        #[unsafe(method(setDrawableSize:))]
        fn set_drawable_size(&self, size: CGSize) {
            if size.width > 1.0 && size.height > 1.0 {
                // SAFETY: the superclass's setter, with the same argument.
                let _: () = unsafe { msg_send![super(self), setDrawableSize: size] };
            }
        }

        /// MoltenVK sets this from mpv's thread, and EDR only turns on when set from the main one.
        #[unsafe(method(setWantsExtendedDynamicRangeContent:))]
        fn set_wants_edr(&self, on: bool) {
            if MainThreadMarker::new().is_some() {
                // SAFETY: the superclass's setter, with the same argument.
                let _: () =
                    unsafe { msg_send![super(self), setWantsExtendedDynamicRangeContent: on] };
                return;
            }
            let layer = SendLayer(self.retain());
            DispatchQueue::main().exec_async(move || {
                let layer = layer;
                layer.0.setWantsExtendedDynamicRangeContent(on);
            });
        }
    }
);

struct SendLayer(Retained<MetalLayer>);

// SAFETY: Core Animation layers may be used from any thread.
unsafe impl Send for SendLayer {}

impl MetalLayer {
    fn create() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        // SAFETY: NSObject's init, on a freshly allocated instance.
        unsafe { msg_send![super(this), init] }
    }
}

/// vo_avfoundation's display layer, from AVFoundation, which only this path loads.
fn sample_buffer_layer() -> Result<Retained<CALayer>, String> {
    // SAFETY: a system framework, opened by its path.
    unsafe {
        libc::dlopen(
            c"/System/Library/Frameworks/AVFoundation.framework/AVFoundation".as_ptr(),
            libc::RTLD_LAZY,
        )
    };
    let class = AnyClass::get(c"AVSampleBufferDisplayLayer").ok_or("no AVFoundation")?;
    // SAFETY: a CALayer subclass, with its plain initializer.
    Ok(unsafe { msg_send![class, new] })
}

thread_local! {
    static LAYER: RefCell<Option<Retained<VideoLayer>>> = const { RefCell::new(None) };
}

impl VideoLayer {
    fn create() -> Result<Retained<Self>, String> {
        let (format, depth) = pixel_format().ok_or("no OpenGL pixel format")?;
        let mut context: CGLContextObj = ptr::null_mut();
        // SAFETY: a format CGL just chose, and an out-pointer to a local.
        let error =
            unsafe { CGLCreateContext(format, ptr::null_mut(), NonNull::from(&mut context)) };
        if error != CGLError::NoError || context.is_null() {
            return Err(format!("no OpenGL context ({})", error.0));
        }
        let swap_interval: c_int = 1;
        // SAFETY: a context just created, and a pointer to a local.
        unsafe {
            CGLSetParameter(
                context,
                CGLContextParameter::CGLCPSwapInterval,
                NonNull::from(&swap_interval),
            )
        };
        let this = Self::alloc().set_ivars(LayerIvars {
            format,
            context,
            depth,
            render: RefCell::default(),
            mpv: RefCell::default(),
            started: Cell::new(false),
            drawn: Cell::new(false),
            skipped: Cell::new(0),
            held: Cell::new(Held::new()),
        });
        // SAFETY: NSObject's init, on a freshly allocated instance.
        let layer: Retained<Self> = unsafe { msg_send![super(this), init] };
        if depth == 16 {
            // SAFETY: the static is a valid, constant string.
            layer.setContentsFormat(unsafe { kCAContentsFormatRGBA16Float });
        }
        Ok(layer)
    }

    fn start(&self) {
        let ivars = self.ivars();
        let Some(mpv) = ivars.mpv.borrow().clone() else {
            return;
        };
        if ivars.started.replace(true) {
            return;
        }
        let _lock = ContextLock::new(ivars.context);
        // Advanced control: mpv waits on the main thread, where nothing may block on mpv.
        match RenderContext::new(
            mpv,
            get_proc_address,
            ptr::null_mut(),
            None,
            true,
            ivars.depth,
        ) {
            Ok(mut render) => {
                render.on_update(|| {
                    DispatchQueue::main().exec_async(|| {
                        if let Some(layer) = LAYER.with(|l| l.borrow().clone()) {
                            layer.update_video();
                        }
                    });
                });
                *ivars.render.borrow_mut() = Some(render);
                log::info!("mpv render context ready");
                self.setNeedsDisplay();
            }
            Err(e) => log::error!("{e}"),
        }
    }

    /// Takes each frame mpv readies, drawn or skipped, so mpv never waits on a hidden window.
    fn update_video(&self) {
        let ivars = self.ivars();
        {
            let render = ivars.render.borrow();
            let Some(r) = render.as_ref() else {
                return;
            };
            let _lock = ContextLock::new(ivars.context);
            if !r.update() {
                return;
            }
        }
        ivars.drawn.set(false);
        self.display();
        CATransaction::flush();
        if ivars.drawn.get() {
            return;
        }
        // Core Animation does not draw a minimised, covered or hidden window, or one on another Space.
        let render = ivars.render.borrow();
        if let Some(r) = render.as_ref() {
            let _lock = ContextLock::new(ivars.context);
            if r.update() {
                r.skip();
                ivars.skipped.set(ivars.skipped.get() + 1);
            }
        }
    }

    fn stop(&self) {
        let ivars = self.ivars();
        let _lock = ContextLock::new(ivars.context);
        ivars.render.borrow_mut().take();
    }
}

/// Holds the OpenGL context locked and current, as mpv's render calls need.
struct ContextLock(CGLContextObj);

impl ContextLock {
    fn new(context: CGLContextObj) -> Self {
        // SAFETY: a live context this layer owns.
        unsafe {
            CGLLockContext(context);
            CGLSetCurrentContext(context);
        }
        Self(context)
    }
}

impl Drop for ContextLock {
    fn drop(&mut self) {
        // SAFETY: the context locked in `new`.
        unsafe { CGLUnlockContext(self.0) };
    }
}

enum Drawn {
    /// Through the render API.
    OpenGl(Retained<VideoLayer>),
    Metal(Retained<MetalLayer>),
    /// mpv adds its subtitle layer beside this one.
    SampleBuffer(Retained<CALayer>),
}

/// A view under the web view, holding the video's layer.
pub struct VideoSurface {
    view: Retained<NSView>,
    root: Retained<CALayer>,
    drawn: Drawn,
}

impl VideoSurface {
    pub fn new(window: &Window) -> Result<Self, String> {
        let mtm = MainThreadMarker::new().ok_or("the window is not on the main thread")?;
        // SAFETY: tao's content view, alive as long as the window.
        let content: &NSView = unsafe { &*window.ns_view().cast::<NSView>() };
        let bounds = content.bounds();
        let view = NSView::initWithFrame(NSView::alloc(mtm), bounds);
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        let sizable =
            CAAutoresizingMask::LayerWidthSizable | CAAutoresizingMask::LayerHeightSizable;
        let (root, drawn) = match video::running() {
            Output::Compatibility => {
                let layer = VideoLayer::create()?;
                layer.setAsynchronous(false);
                layer.setNeedsDisplayOnBoundsChange(true);
                LAYER.with(|l| *l.borrow_mut() = Some(layer.clone()));
                let root = Retained::into_super(Retained::into_super(layer.clone()));
                (root, Drawn::OpenGl(layer))
            }
            Output::Mpv => {
                let layer = MetalLayer::create();
                let root = Retained::into_super(Retained::into_super(layer.clone()));
                (root, Drawn::Metal(layer))
            }
            Output::System => {
                let display = sample_buffer_layer()?;
                display.setAutoresizingMask(sizable);
                let root = CALayer::layer();
                root.setBackgroundColor(Some(&CGColor::new_srgb(0.0, 0.0, 0.0, 1.0)));
                root.addSublayer(&display);
                (root, Drawn::SampleBuffer(display))
            }
        };
        root.setAutoresizingMask(sizable);
        root.setContentsScale(window.scale_factor());
        // A layer-hosting view: the layer is set before the view asks for one.
        view.setLayer(Some(&root));
        view.setWantsLayer(true);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        Ok(Self { view, root, drawn })
    }

    pub fn attach(&self, mpv: Arc<Mpv>) {
        let edr = match &self.drawn {
            Drawn::OpenGl(layer) => {
                *layer.ivars().mpv.borrow_mut() = Some(mpv.clone());
                layer.start();
                self.root.clone()
            }
            Drawn::Metal(_) => self.root.clone(),
            Drawn::SampleBuffer(display) => display.clone(),
        };
        video::attach(edr, self.view.clone(), mpv);
    }

    /// The render context goes before mpv, with its OpenGL context current.
    pub fn shutdown(&self) {
        if let Drawn::OpenGl(layer) = &self.drawn {
            layer.stop();
        }
        LAYER.with(|l| l.borrow_mut().take());
    }

    pub fn resize(&self, width: u32, _height: u32) {
        let bounds = self.view.bounds();
        self.root.setFrame(bounds);
        if bounds.size.width > 0.0 {
            self.root
                .setContentsScale(f64::from(width) / bounds.size.width);
        }
        match &self.drawn {
            Drawn::OpenGl(layer) => layer.setNeedsDisplay(),
            Drawn::Metal(layer) => {
                let scale = self.root.contentsScale();
                layer.setDrawableSize(CGSize::new(
                    bounds.size.width * scale,
                    bounds.size.height * scale,
                ));
            }
            Drawn::SampleBuffer(display) => {
                CATransaction::begin();
                CATransaction::setDisableActions(true);
                display.setFrame(self.root.bounds());
                CATransaction::commit();
            }
        }
    }

    pub fn refresh_hdr(&self) {
        video::refresh();
    }
}

/// From any thread.
pub fn update_hdr(gamma: Option<String>, primaries: Option<String>) {
    video::update(gamma, primaries);
}

pub fn load_video_output(data_dir: &Path) {
    video::load(data_dir);
}

pub fn video_outputs() -> (Vec<&'static str>, &'static str, &'static str) {
    video::state()
}

pub fn choose_video_output(output: &str) {
    video::choose(output);
}

pub fn fit_video(fit: Fit) -> Fit {
    video::fit(fit)
}

pub fn relaunch() -> bool {
    video::relaunch();
    true
}

/// The bundle's own icon shows in the Dock.
pub fn window_icon() -> Option<Icon> {
    None
}

/// The traffic lights sit over the page, which hides them with the player's controls.
pub fn set_window_buttons(window: &Window, visible: bool) {
    // SAFETY: tao's window, alive as long as `window`.
    let ns_window: &NSWindow = unsafe { &*window.ns_window().cast::<NSWindow>() };
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(kind) {
            button.setHidden(!visible);
        }
    }
}

/// The menu bar: macOS sends Cmd+Q and the web view's copy and paste through it.
/// Quit goes through `on_quit`, so the app closes the way its own button does.
pub fn install_menu(on_quit: impl Fn() + Send + Sync + 'static) -> Option<Menu> {
    let quit = MenuItem::with_id(
        QUIT,
        "Quit AIOStreams",
        true,
        "CmdOrCtrl+Q".parse::<Accelerator>().ok(),
    );
    let separator = PredefinedMenuItem::separator;
    let app = Submenu::with_items(
        "AIOStreams",
        true,
        &[
            &PredefinedMenuItem::about(Some("About AIOStreams"), None),
            &separator(),
            &PredefinedMenuItem::services(None),
            &separator(),
            &PredefinedMenuItem::hide(None),
            &PredefinedMenuItem::hide_others(None),
            &PredefinedMenuItem::show_all(None),
            &separator(),
            &quit,
        ],
    );
    let edit = Submenu::with_items(
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(None),
            &PredefinedMenuItem::redo(None),
            &separator(),
            &PredefinedMenuItem::cut(None),
            &PredefinedMenuItem::copy(None),
            &PredefinedMenuItem::paste(None),
            &PredefinedMenuItem::select_all(None),
        ],
    );
    let window = Submenu::with_items(
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(None),
            &PredefinedMenuItem::maximize(None),
            &PredefinedMenuItem::fullscreen(None),
            &separator(),
            &PredefinedMenuItem::close_window(None),
        ],
    );
    let (Ok(app), Ok(edit), Ok(window)) = (app, edit, window) else {
        log::warn!("could not build the menu bar");
        return None;
    };
    let menu = Menu::with_items(&[&app, &edit, &window]).ok()?;
    menu.init_for_nsapp();
    window.set_as_windows_menu_for_nsapp();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id == QUIT {
            on_quit();
        }
    }));
    Some(menu)
}

const QUIT: &str = "quit";

pub fn mpv_options(video: &VideoSurface) -> Vec<(&'static str, String)> {
    match &video.drawn {
        Drawn::OpenGl(_) => vec![
            ("vo", "libmpv".into()),
            ("hwdec", "auto-safe".into()),
            // Frames arrive when due, so drawing one barely waits on the main thread.
            ("video-timing-offset", "0".into()),
            // Needs OpenGL 4.4, which macOS lacks, and each try waits on the main thread.
            ("vd-lavc-dr", "no".into()),
        ],
        Drawn::Metal(layer) => vec![
            ("vo", "gpu-next".into()),
            ("gpu-api", "vulkan".into()),
            ("gpu-context", "moltenvk".into()),
            ("wid", wid(layer)),
            ("hwdec", "auto-safe".into()),
            // Only read when mpv starts.
            ("target-colorspace-hint", "yes".into()),
            ("sub-hdr-peak", video::REFERENCE_WHITE.to_string()),
            ("image-subs-hdr-peak", video::REFERENCE_WHITE.to_string()),
        ],
        Drawn::SampleBuffer(display) => vec![
            ("vo", "avfoundation".into()),
            ("wid", wid(display)),
            // Composited subtitles would take the video through SDR.
            ("avfoundation-composite-osd", "no".into()),
            ("hwdec", "videotoolbox".into()),
            ("hwdec-codecs", "all".into()),
            ("hwdec-software-fallback", "yes".into()),
        ],
    }
}

/// The layer's address, which mpv draws to; the surface keeps the layer alive.
fn wid(layer: &CALayer) -> String {
    (std::ptr::from_ref(layer) as usize).to_string()
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        kind: &CFString,
        level: u32,
        name: &CFString,
        id: &mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}

const ASSERTION_LEVEL_ON: u32 = 255;

static AWAKE: Mutex<Option<u32>> = Mutex::new(None);

pub fn keep_awake(on: bool) {
    let Ok(mut held) = AWAKE.lock() else { return };
    match (on, *held) {
        (true, None) => {
            let mut id = 0;
            let kind = CFString::from_static_str("PreventUserIdleDisplaySleep");
            let name = CFString::from_static_str("Playing video");
            match unsafe { IOPMAssertionCreateWithName(&kind, ASSERTION_LEVEL_ON, &name, &mut id) }
            {
                0 => *held = Some(id),
                code => log::warn!("keep awake: IOPMAssertionCreateWithName returned {code}"),
            }
        }
        (false, Some(id)) => {
            unsafe { IOPMAssertionRelease(id) };
            *held = None;
        }
        _ => {}
    }
}

pub fn open_external(url: &str) {
    if let Err(e) = std::process::Command::new("open").arg(url).spawn() {
        log::warn!("open {url}: {e}");
    }
}

/// Shown in a dialog too, since an app opened from Finder has no terminal.
pub fn choose_program(_window: &Window, title: &str) -> Option<PathBuf> {
    let panel = NSOpenPanel::openPanel(MainThreadMarker::new()?);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(false);
    panel.setMessage(Some(&NSString::from_str(title)));
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    let path = PathBuf::from(panel.URL()?.path()?.to_string());
    // A picked app runs the program of the same name inside it.
    if path.extension().is_some_and(|e| e == "app") {
        let name = path.file_stem()?.to_owned();
        return Some(path.join("Contents/MacOS").join(name));
    }
    Some(path)
}

pub fn choose_folder(_window: &Window, title: &str) -> Option<PathBuf> {
    let panel = NSOpenPanel::openPanel(MainThreadMarker::new()?);
    panel.setCanChooseFiles(false);
    panel.setCanChooseDirectories(true);
    panel.setCanCreateDirectories(true);
    panel.setAllowsMultipleSelection(false);
    panel.setMessage(Some(&NSString::from_str(title)));
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    Some(PathBuf::from(panel.URL()?.path()?.to_string()))
}

pub fn fatal(message: &str) -> ! {
    log::error!("{message}");
    eprintln!("AIOStreams: {message}");
    let script = format!(
        "display alert \"AIOStreams could not start\" message {} as critical",
        applescript_string(message)
    );
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .status();
    std::process::exit(1)
}

fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    let text = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

/// The computer's name, which Jellyfin apps give as their device.
pub fn device_name() -> String {
    command_output("scutil", &["--get", "ComputerName"])
        .or_else(|| command_output("hostname", &["-s"]))
        .unwrap_or_else(|| "Mac".into())
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

/// E.g. `macOS 15.3.1 (24D70), arm64`.
pub fn os_version() -> String {
    let version = command_output("sw_vers", &["-productVersion"]).unwrap_or_else(|| "?".into());
    let build = command_output("sw_vers", &["-buildVersion"]).unwrap_or_else(|| "?".into());
    format!("macOS {version} ({build}), {}", std::env::consts::ARCH)
}

pub fn libmpv_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(p) = std::env::var("AIOSTREAMS_LIBMPV") {
        paths.push(PathBuf::from(p));
    }
    if video::running() != Output::Compatibility {
        paths.extend(video::mpvkit_library());
    }
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from))
    {
        paths.push(dir.join("libmpv.2.dylib"));
        paths.push(dir.join("../Frameworks/libmpv.2.dylib"));
    }
    if cfg!(debug_assertions) {
        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        paths.push(PathBuf::from(format!(
            "{}/../vendor/macos-{arch}/libmpv.2.dylib",
            env!("CARGO_MANIFEST_DIR")
        )));
    }
    for dir in ["/opt/homebrew/lib", "/usr/local/lib", "/opt/local/lib"] {
        paths.push(Path::new(dir).join("libmpv.2.dylib"));
    }
    paths
}

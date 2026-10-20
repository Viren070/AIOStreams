//! Which output draws the video, and the display's HDR for it.

use std::cell::RefCell;
use std::ffi::CStr;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use aiostreams_desktop_core::mpv::Mpv;
use aiostreams_desktop_core::playback::Fit;
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
use objc2::{MainThreadMarker, msg_send, sel};
use objc2_app_kit::{NSApplicationDidChangeScreenParametersNotification, NSScreen, NSView};
use objc2_core_foundation::CFString;
use objc2_core_graphics::CGColorSpace;
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSOperatingSystemVersion, NSOperationQueue,
    NSProcessInfo, NSString,
};
use objc2_quartz_core::{CALayer, CAOpenGLLayer};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Output {
    /// gpu-next over MoltenVK into a Metal layer.
    Mpv,
    /// vo_avfoundation into an AVSampleBufferDisplayLayer.
    System,
    /// The render API into an OpenGL layer.
    Compatibility,
}

impl Output {
    const ALL: [Self; 3] = [Self::Mpv, Self::System, Self::Compatibility];

    pub fn id(self) -> &'static str {
        match self {
            Self::Mpv => "mpv",
            Self::System => "system",
            Self::Compatibility => "compatibility",
        }
    }

    fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|o| o.id() == id)
    }
}

/// The nits of PQ at SDR white.
pub const REFERENCE_WHITE: f64 = 203.0;

static CHOSEN: AtomicU8 = AtomicU8::new(0);
static RUNNING: AtomicU8 = AtomicU8::new(0);
static FILE: OnceLock<PathBuf> = OnceLock::new();

fn get(cell: &AtomicU8) -> Output {
    Output::ALL[usize::from(cell.load(Ordering::Relaxed))]
}

fn put(cell: &AtomicU8, output: Output) {
    let index = Output::ALL.iter().position(|o| *o == output).unwrap_or(0);
    cell.store(index as u8, Ordering::Relaxed);
}

pub fn running() -> Output {
    get(&RUNNING)
}

/// Below macOS 14, or without the MPVKit libmpv, only the render API.
fn choices() -> &'static [Output] {
    static CHOICES: OnceLock<&'static [Output]> = OnceLock::new();
    CHOICES.get_or_init(|| {
        let version = NSOperatingSystemVersion {
            majorVersion: 14,
            minorVersion: 0,
            patchVersion: 0,
        };
        if NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(version)
            && mpvkit_library().is_some()
        {
            &Output::ALL
        } else {
            &[Output::Compatibility]
        }
    })
}

pub fn load(data_dir: &Path) {
    let file = data_dir.join("video-output");
    let saved = std::env::var("AIOSTREAMS_VIDEO_OUTPUT")
        .ok()
        .or_else(|| std::fs::read_to_string(&file).ok());
    let chosen = saved
        .as_deref()
        .and_then(|id| Output::from_id(id.trim()))
        .unwrap_or(Output::Mpv);
    let _ = FILE.set(file);
    put(&CHOSEN, chosen);
    let running = if choices().contains(&chosen) {
        chosen
    } else {
        Output::Compatibility
    };
    put(&RUNNING, running);
    log::info!("video output={} chosen={}", running.id(), chosen.id());
}

/// The outputs to offer, the one drawing and the one chosen for the next start.
pub fn state() -> (Vec<&'static str>, &'static str, &'static str) {
    let offered = if choices().len() > 1 {
        choices().iter().map(|o| o.id()).collect()
    } else {
        Vec::new()
    };
    (offered, running().id(), get(&CHOSEN).id())
}

pub fn choose(id: &str) {
    let Some(output) = Output::from_id(id).filter(|o| choices().contains(o)) else {
        return;
    };
    put(&CHOSEN, output);
    if let Some(file) = FILE.get()
        && let Err(e) = std::fs::write(file, id)
    {
        log::warn!("saving the video output: {e}");
    }
}

/// The libmpv the Metal and AVFoundation outputs draw with.
pub fn mpvkit_library() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let mut candidates = vec![
        dir.join("../Frameworks/libmpv-mpvkit.dylib"),
        dir.join("libmpv-mpvkit.dylib"),
    ];
    if cfg!(debug_assertions) {
        let arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        candidates.push(PathBuf::from(format!(
            "{}/../vendor/macos-{arch}/libmpv-mpvkit.dylib",
            env!("CARGO_MANIFEST_DIR")
        )));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Opens the app again once this copy has quit, as one copy runs per data folder.
pub fn relaunch() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let wait = r#"while kill -0 "$0" 2>/dev/null; do sleep 0.2; done"#;
    let app = exe
        .ancestors()
        .nth(3)
        .filter(|p| p.extension().is_some_and(|e| e == "app"));
    let (script, target) = match app {
        Some(app) => (format!(r#"{wait}; exec open -n "$1""#), app),
        None => (format!(r#"{wait}; exec "$1""#), exe.as_path()),
    };
    if let Err(e) = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg(std::process::id().to_string())
        .arg(target)
        .spawn()
    {
        log::warn!("relaunch: {e}");
    }
}

#[derive(Clone, PartialEq)]
struct Video {
    primaries: String,
    space: &'static str,
}

/// What the layer and mpv were set to for an HDR video.
#[derive(Clone, PartialEq)]
struct Applied {
    video: Video,
    /// Set where mpv tone maps.
    target_peak: Option<u32>,
}

#[derive(Default)]
struct State {
    mpv: Option<Arc<Mpv>>,
    /// The layer whose dynamic range the output sets.
    layer: Option<Retained<CALayer>>,
    view: Option<Retained<NSView>>,
    video: Option<Video>,
    applied: Option<Applied>,
    off_pending: u32,
    refresh_pending: bool,
    observer: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::default();
}

pub fn attach(layer: Retained<CALayer>, view: Retained<NSView>, mpv: Arc<Mpv>) {
    let block = RcBlock::new(|_: NonNull<NSNotification>| refresh());
    // SAFETY: AppKit's own name, observed on the main queue.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidChangeScreenParametersNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    STATE.with_borrow_mut(|s| {
        s.layer = Some(layer);
        s.view = Some(view);
        s.mpv = Some(mpv);
        s.observer = Some(observer);
    });
}

/// The playing video's colour, from any thread.
pub fn update(gamma: Option<String>, primaries: Option<String>) {
    DispatchQueue::main().exec_async(move || {
        let video = gamma
            .filter(|g| matches!(g.as_str(), "pq" | "hlg"))
            .and(primaries)
            .and_then(|primaries| {
                Some(Video {
                    space: pq_colorspace(&primaries)?,
                    primaries,
                })
            });
        let (wait, generation) = STATE.with_borrow_mut(|s| {
            s.off_pending = s.off_pending.wrapping_add(1);
            let wait = video.is_none() && s.applied.is_some();
            s.video = video;
            (wait, s.off_pending)
        });
        // The video goes for a moment between files, which EDR stays on through.
        if wait {
            after(Duration::from_millis(1500), move || {
                if STATE.with_borrow(|s| s.off_pending) == generation {
                    apply();
                }
            });
        } else {
            apply();
        }
    });
}

/// The display's headroom moves with its brightness and with the screen the window is on.
pub fn refresh() {
    let queued = STATE.with_borrow_mut(|s| std::mem::replace(&mut s.refresh_pending, true));
    if !queued {
        after(Duration::from_millis(250), || {
            STATE.with_borrow_mut(|s| s.refresh_pending = false);
            apply();
        });
    }
}

fn after(delay: Duration, work: impl FnOnce() + Send + 'static) {
    if let Ok(when) = DispatchTime::try_from(delay) {
        let _ = DispatchQueue::main().after(when, work);
    }
}

fn apply() {
    let view = STATE.with_borrow(|s| s.view.clone());
    let screen = view
        .as_deref()
        .and_then(|v| v.window())
        .and_then(|w| w.screen())
        .or_else(|| MainThreadMarker::new().and_then(NSScreen::mainScreen));
    let (headroom, potential) = screen.map_or((1.0, 1.0), |s| {
        (
            s.maximumExtendedDynamicRangeColorComponentValue(),
            s.maximumPotentialExtendedDynamicRangeColorComponentValue(),
        )
    });
    // Some screens report no headroom while they show HDR.
    let headroom = if headroom > 1.0 { headroom } else { potential };
    STATE.with_borrow_mut(|s| match s.video.clone().filter(|_| potential > 1.0) {
        Some(video) => s.switch_on(video, headroom),
        None => s.switch_off(),
    });
}

impl State {
    fn switch_on(&mut self, video: Video, headroom: f64) {
        let output = running();
        let target_peak = (output != Output::System).then(|| {
            let peak = (headroom * REFERENCE_WHITE).round() as u32;
            match self.applied.as_ref().and_then(|a| a.target_peak) {
                // Each change rebuilds mpv's shaders, so small drifts are left alone.
                Some(old) if peak.abs_diff(old) * 20 < old => old,
                _ => peak,
            }
        });
        let want = Applied { video, target_peak };
        if self.applied.as_ref() == Some(&want) {
            return;
        }
        let (Some(layer), Some(mpv)) = (self.layer.clone(), self.mpv.clone()) else {
            return;
        };
        if self.applied.as_ref().is_none_or(|a| a.video != want.video) {
            self.switch_off();
            match output {
                Output::Compatibility => {
                    let name = CFString::from_static_str(want.video.space);
                    let space = CGColorSpace::with_name(Some(&name));
                    layer.setWantsExtendedDynamicRangeContent(true);
                    if let Some(layer) = layer.downcast_ref::<CAOpenGLLayer>() {
                        layer.setColorspace(space.as_deref());
                    }
                    // An ICC profile would take mpv's PQ back to SDR.
                    for (name, value) in [
                        ("target-prim", want.video.primaries.as_str()),
                        ("target-trc", "pq"),
                        ("icc-profile", ""),
                    ] {
                        set(&mpv, name, value);
                    }
                }
                Output::Mpv => layer.setWantsExtendedDynamicRangeContent(true),
                Output::System => set_dynamic_range(&layer, true),
            }
        }
        if let Some(peak) = want.target_peak {
            set(&mpv, "target-peak", &peak.to_string());
        }
        log::info!(
            "hdr on primaries={} target-peak={} headroom={headroom:.2}",
            want.video.primaries,
            target_peak.map_or("system".into(), |p| p.to_string()),
        );
        self.applied = Some(want);
    }

    fn switch_off(&mut self) {
        if self.applied.take().is_none() {
            return;
        }
        let (Some(layer), Some(mpv)) = (self.layer.as_deref(), self.mpv.as_deref()) else {
            return;
        };
        match running() {
            Output::Compatibility => {
                layer.setWantsExtendedDynamicRangeContent(false);
                if let Some(layer) = layer.downcast_ref::<CAOpenGLLayer>() {
                    layer.setColorspace(None);
                }
                for name in ["target-prim", "target-trc", "target-peak"] {
                    set(mpv, name, "auto");
                }
            }
            Output::Mpv => {
                layer.setWantsExtendedDynamicRangeContent(false);
                set(mpv, "target-peak", "auto");
            }
            Output::System => set_dynamic_range(layer, false),
        }
        log::info!("hdr off");
    }
}

fn set(mpv: &Mpv, name: &str, value: &str) {
    // With the render API this is mpv's render thread, where only its async calls may run.
    if let Err(e) = mpv.set_property_async(name, value) {
        log::warn!("mpv {name}={value}: {e}");
    }
}

/// A string constant newer than the oldest macOS the app runs on, or from a framework loaded later.
fn constant(name: &CStr) -> Option<&'static NSString> {
    // SAFETY: a lookup by name, null where it is missing.
    let symbol = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    // SAFETY: the symbol is an `NSString *const`.
    (!symbol.is_null()).then(|| unsafe { *symbol.cast::<&'static NSString>() })
}

fn set_dynamic_range(layer: &CALayer, high: bool) {
    let name = if high {
        c"CADynamicRangeHigh"
    } else {
        c"CADynamicRangeStandard"
    };
    match constant(name) {
        Some(range) if layer.respondsToSelector(sel!(setPreferredDynamicRange:)) => {
            layer.setPreferredDynamicRange(range);
        }
        _ => layer.setWantsExtendedDynamicRangeContent(high),
    }
}

/// The PQ colour space Core Animation wants for the video's primaries.
fn pq_colorspace(primaries: &str) -> Option<&'static str> {
    Some(match primaries {
        "bt.2020" => "kCGColorSpaceITUR_2100_PQ",
        "display-p3" => "kCGColorSpaceDisplayP3_PQ",
        _ => return None,
    })
}

/// The system output scales the video itself, so the layer fits it and mpv
/// keeps its own zoom off, which would take the picture out of HDR.
pub fn fit(fit: Fit) -> Fit {
    if running() != Output::System {
        return fit;
    }
    let name = match fit {
        Fit::Fit => c"AVLayerVideoGravityResizeAspect",
        Fit::Crop => c"AVLayerVideoGravityResizeAspectFill",
        Fit::Stretch => c"AVLayerVideoGravityResize",
    };
    if let (Some(gravity), Some(layer)) = (constant(name), STATE.with_borrow(|s| s.layer.clone())) {
        let layer: &AnyObject = &layer;
        // SAFETY: AVSampleBufferDisplayLayer's setter, with one of its gravity constants.
        let _: () = unsafe { msg_send![layer, setVideoGravity: gravity] };
    }
    Fit::Fit
}

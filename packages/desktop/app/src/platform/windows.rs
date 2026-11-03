use std::cell::{Cell, RefCell};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use super::small::{Small, event};
use aiostreams_desktop_core::bridge::{Outbound, VideoFrame};
use aiostreams_desktop_core::mpv::Mpv;
use tao::platform::windows::{IconExtWindows, WindowExtWindows};
use tao::window::{Icon, Window};

use windows_sys::Win32::Foundation::SYSTEMTIME;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE, HWND, LPARAM, LRESULT, POINT, RECT,
    WPARAM,
};
use windows_sys::Win32::Graphics::Gdi::{
    BLACK_BRUSH, CreateRoundRectRgn, GetStockObject, SetWindowRgn,
};
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, LoadLibraryW};
use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegDeleteTreeW,
    RegGetValueW, RegSetKeyValueW,
};
use windows_sys::Win32::System::SystemInformation::{
    GetLocalTime, GlobalMemoryStatusEx, MEMORYSTATUSEX,
};
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Controls::Dialogs::{
    GetOpenFileNameW, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST, OPENFILENAMEW,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows_sys::Win32::UI::Shell::{SetCurrentProcessExplicitAppUserModelID, ShellExecuteW};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, FindWindowExW, FindWindowW, GetClientRect, GetCursorPos,
    GetParent, HWND_BOTTOM, HWND_MESSAGE, HWND_TOP, IsIconic, KillTimer, MB_ICONERROR, MB_OK,
    MessageBoxW, RegisterClassW, SMTO_ABORTIFHUNG, SW_RESTORE, SW_SHOWNORMAL, SWP_NOACTIVATE,
    SWP_NOSIZE, SendMessageTimeoutW, SetForegroundWindow, SetTimer, SetWindowPos, ShowWindow,
    WM_CAPTURECHANGED, WM_COPYDATA, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_TIMER,
    WNDCLASSW, WS_CHILD, WS_VISIBLE,
};

/// The id on the Start menu shortcut Velopack makes, which gives the system's
/// media controls the app's name and icon.
const APP_ID: &str = "velopack.aiostreams-desktop";

/// Set before any window opens.
pub fn claim_app_id() {
    let id = wide(APP_ID);
    unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
}

/// Custom protocols are served from `http://<scheme>.localhost` on Windows.
pub const APP_URL: &str = "http://aiostreams.localhost/";
pub const PLATFORM: &str = "windows";
pub const WEB_DATA_DIR: &str = "WebView2";

/// The main window's class, which a second launch looks the first one up by.
pub const WINDOW_CLASS: &str = "AIOStreamsDesktop";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Held for as long as the app runs.
pub struct SingleInstance(#[allow(dead_code)] HANDLE);

fn instance_key(data_dir: &Path) -> String {
    let key = data_dir.to_string_lossy().to_lowercase();
    // FNV-1a: stable across builds, unlike std's hasher.
    let hash = key.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    format!("AIOStreamsDesktop-{hash:016x}")
}

/// One copy per data folder, whose WebView2 profile two copies cannot share: a
/// second launch hands its link over, brings the first window forward and gets None.
pub fn claim_instance(data_dir: &Path, link: Option<&str>) -> Option<SingleInstance> {
    let key = instance_key(data_dir);
    let name = wide(&format!("Local\\{key}"));
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() || unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
        return Some(SingleInstance(handle));
    }
    if let Some(link) = link {
        hand_over(&key, link);
    }
    unsafe {
        CloseHandle(handle);
        let window = FindWindowW(wide(WINDOW_CLASS).as_ptr(), std::ptr::null());
        if !window.is_null() {
            if IsIconic(window) != 0 {
                ShowWindow(window, SW_RESTORE);
            }
            SetForegroundWindow(window);
        }
    }
    None
}

/// Any program can send a WM_COPYDATA, so a link carries this mark.
const LINK_MARK: usize = 0x4149_4f53;

type Deliver = Box<dyn Fn(String) + Send>;
static DELIVER: OnceLock<Mutex<Deliver>> = OnceLock::new();

fn links_class(key: &str) -> Vec<u16> {
    wide(&format!("{key}-links"))
}

unsafe extern "system" fn links_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_COPYDATA {
        let data = unsafe { &*(lparam as *const COPYDATASTRUCT) };
        if data.dwData != LINK_MARK || data.lpData.is_null() {
            return 0;
        }
        let units = unsafe {
            std::slice::from_raw_parts(data.lpData as *const u16, data.cbData as usize / 2)
        };
        let link = crate::links::accept(&String::from_utf16_lossy(units));
        if let (Some(link), Some(deliver)) = (link, DELIVER.get())
            && let Ok(deliver) = deliver.lock()
        {
            deliver(link);
        }
        return 1;
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Takes the links a second launch hands over, on the thread that runs the event loop.
pub fn listen_links(data_dir: &Path, deliver: impl Fn(String) + Send + 'static) {
    let _ = DELIVER.set(Mutex::new(Box::new(deliver)));
    let class = links_class(&instance_key(data_dir));
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSW {
            lpfnWndProc: Some(links_proc),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&wc);
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if window.is_null() {
            log::warn!("links: could not create the window that receives them");
        }
    }
}

fn hand_over(key: &str, link: &str) {
    let class = links_class(key);
    let units: Vec<u16> = link.encode_utf16().collect();
    let data = COPYDATASTRUCT {
        dwData: LINK_MARK,
        cbData: (units.len() * 2) as u32,
        lpData: units.as_ptr() as *mut _,
    };
    unsafe {
        let window = FindWindowExW(
            HWND_MESSAGE,
            std::ptr::null_mut(),
            class.as_ptr(),
            std::ptr::null(),
        );
        if window.is_null() {
            return log::warn!("links: the running copy takes none");
        }
        SendMessageTimeoutW(
            window,
            WM_COPYDATA,
            0,
            &data as *const COPYDATASTRUCT as LPARAM,
            SMTO_ABORTIFHUNG,
            5000,
            std::ptr::null_mut(),
        );
    }
}

fn scheme_key() -> String {
    format!(r"Software\Classes\{}", crate::links::SCHEME)
}

pub fn register_links() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.display().to_string();
    let root = scheme_key();
    let set = |key: &str, name: Option<&str>, value: &str| {
        let value = wide(value);
        let name = name.map(wide);
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                wide(key).as_ptr(),
                name.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()),
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            );
        }
    };
    set(&root, None, "URL:AIOStreams");
    set(&root, Some("URL Protocol"), "");
    set(
        &format!(r"{root}\DefaultIcon"),
        None,
        &format!("\"{exe}\",0"),
    );
    set(
        &format!(r"{root}\shell\open\command"),
        None,
        &format!("\"{exe}\" \"%1\""),
    );
}

pub fn unregister_links() {
    unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, wide(&scheme_key()).as_ptr()) };
}

type OnInput = Box<dyn Fn(Outbound)>;

thread_local! {
    static SMALL: RefCell<Option<Small>> = const { RefCell::new(None) };
    /// The window's pixels to the page's.
    static SCALE: Cell<f64> = const { Cell::new(1.0) };
    static ON_INPUT: RefCell<Option<OnInput>> = const { RefCell::new(None) };
}

const MOVE_TIMER: usize = 1;

fn emit(message: Outbound) {
    ON_INPUT.with_borrow(|on_input| {
        if let Some(on_input) = on_input {
            on_input(message);
        }
    });
}

fn px(v: f64) -> i32 {
    (v * SCALE.get()).round() as i32
}

fn cursor() -> (f64, f64) {
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point) };
    let scale = SCALE.get();
    (f64::from(point.x) / scale, f64::from(point.y) / scale)
}

/// The system can't smooth a child window's edge, so the curve is stepped.
fn round(hwnd: HWND, size: (f64, f64), radii: (f64, f64)) {
    let (width, height) = (px(size.0), px(size.1));
    let (top, bottom) = (px(radii.0), px(radii.1));
    let region = unsafe {
        match (top, bottom) {
            (0, 0) => std::ptr::null_mut(),
            // Square below: the bottom corners fall outside the window.
            (_, 0) => CreateRoundRectRgn(0, 0, width + 1, height + 2 * top, 2 * top, 2 * top),
            _ => CreateRoundRectRgn(0, 0, width + 1, height + 1, 2 * top, 2 * top),
        }
    };
    unsafe { SetWindowRgn(hwnd, region, 1) };
}

fn move_to(hwnd: HWND, (x, y): (f64, f64)) {
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOP,
            px(x),
            px(y),
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
}

/// Clicks and drags on the small video, which sits over the page and so gets them itself.
/// Capture changes call back in here, so no state is borrowed across them.
unsafe extern "system" fn video_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            let at = cursor();
            if SMALL.with_borrow_mut(|small| small.as_mut().is_some_and(|s| s.press(at))) {
                unsafe {
                    KillTimer(hwnd, MOVE_TIMER);
                    SetCapture(hwnd);
                }
                return 0;
            }
        }
        WM_MOUSEMOVE => {
            let at = cursor();
            let mut client = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            unsafe { GetClientRect(GetParent(hwnd), &mut client) };
            let scale = SCALE.get();
            let room = (
                f64::from(client.right) / scale,
                f64::from(client.bottom) / scale,
            );
            let moved = SMALL.with_borrow_mut(|small| {
                let small = small.as_mut()?;
                let grabbed = small.drag(at, room)?;
                Some((grabbed, small.at, small.size, small.radii))
            });
            if let Some((grabbed, at, size, radii)) = moved {
                if grabbed {
                    round(hwnd, size, radii);
                    emit(event("grabbed", None));
                }
                move_to(hwnd, at);
                emit(event("moving", Some(at)));
                return 0;
            }
        }
        WM_LBUTTONUP | WM_CAPTURECHANGED => {
            let heard = SMALL.with_borrow_mut(|small| small.as_mut()?.release(msg == WM_LBUTTONUP));
            if msg == WM_LBUTTONUP {
                unsafe { ReleaseCapture() };
            }
            if let Some(heard) = heard {
                emit(heard);
                return 0;
            }
        }
        WM_TIMER if wparam == MOVE_TIMER => {
            let step = SMALL.with_borrow_mut(|small| {
                let small = small.as_mut()?;
                let going = small.step();
                Some((small.at, going))
            });
            if let Some((at, _)) = step {
                move_to(hwnd, at);
            }
            if step.is_none_or(|(_, going)| !going) {
                unsafe { KillTimer(hwnd, MOVE_TIMER) };
            }
            return 0;
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// The child window mpv draws into, kept beneath the web view, or over it where
/// the page's mini player leaves room.
pub struct VideoSurface {
    hwnd: HWND,
    size: Cell<(u32, u32)>,
}

impl VideoSurface {
    pub fn new(window: &Window) -> Result<Self, String> {
        let (parent, size) = (window.hwnd(), window.inner_size());
        let (width, height) = (size.width, size.height);
        let class = wide("AIOStreamsVideo");
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(video_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                hbrBackground: GetStockObject(BLACK_BRUSH),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                width as i32,
                height as i32,
                parent as HWND,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("could not create the video window".into());
            }
            Ok(Self {
                hwnd,
                size: Cell::new((width, height)),
            })
        }
    }

    /// mpv draws into the window itself, so it needs no render context.
    pub fn attach(&self, _mpv: Arc<Mpv>) {}

    pub fn shutdown(&self) {}

    /// Hears clicks and drags on the small video, for the page.
    pub fn on_input(&self, on_input: impl Fn(Outbound) + 'static) {
        ON_INPUT.set(Some(Box::new(on_input)));
    }

    pub fn resize(&self, width: u32, height: u32) {
        self.size.set((width, height));
        if SMALL.with_borrow(Option::is_none) {
            self.fill();
        }
    }

    fn fill(&self) {
        let (width, height) = self.size.get();
        unsafe {
            SetWindowPos(
                self.hwnd,
                HWND_BOTTOM,
                0,
                0,
                width as i32,
                height as i32,
                SWP_NOACTIVATE,
            );
        }
    }

    /// Over the page in `frame`, in the page's pixels; none puts it back beneath, filling the window.
    pub fn frame(&self, frame: Option<VideoFrame>, scale: f64) {
        unsafe { KillTimer(self.hwnd, MOVE_TIMER) };
        let Some(frame) = frame else {
            SMALL.set(None);
            unsafe { SetWindowRgn(self.hwnd, std::ptr::null_mut(), 1) };
            return self.fill();
        };
        SCALE.set(scale);
        let small = Small::new(&frame, SMALL.take().as_ref());
        round(self.hwnd, small.size, small.radii);
        let (at, size) = (small.at, small.size);
        // Hidden, it goes beneath the page, which covers it.
        let after = if small.hidden { HWND_BOTTOM } else { HWND_TOP };
        let gliding = small.gliding();
        SMALL.set(Some(small));
        unsafe {
            SetWindowPos(
                self.hwnd,
                after,
                px(at.0),
                px(at.1),
                px(size.0),
                px(size.1),
                SWP_NOACTIVATE,
            );
            if gliding {
                SetTimer(self.hwnd, MOVE_TIMER, 8, None);
            }
        }
    }
}

/// The exe's own icon, embedded by build.rs.
pub fn window_icon() -> Option<Icon> {
    Icon::from_resource(1, None).ok()
}

pub fn mpv_options(video: &VideoSurface) -> Vec<(&'static str, String)> {
    vec![
        ("wid", (video.hwnd as i64).to_string()),
        ("vo", "gpu-next,gpu,".into()),
        ("gpu-context", "d3d11".into()),
        ("hwdec", "auto-safe".into()),
        ("tone-mapping", "bt.2390".into()),
    ]
}

/// mpv keeps the display on itself, as the video is its own window.
pub fn keep_awake(_on: bool) {}

pub fn open_external(url: &str) {
    let (op, file) = (wide("open"), wide(url));
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

pub fn choose_program(window: &Window, title: &str) -> Option<PathBuf> {
    let (filter, title) = (wide("Programs\0*.exe\0"), wide(title));
    let mut file = vec![0u16; 1024];
    let mut dialog = OPENFILENAMEW {
        lStructSize: size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: window.hwnd() as HWND,
        lpstrFilter: filter.as_ptr(),
        lpstrFile: file.as_mut_ptr(),
        nMaxFile: file.len() as u32,
        lpstrTitle: title.as_ptr(),
        Flags: OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };
    // SAFETY: the buffers outlive the call, which writes at most `nMaxFile` units.
    if unsafe { GetOpenFileNameW(&mut dialog) } == 0 {
        return None;
    }
    let length = file.iter().position(|&c| c == 0).unwrap_or(file.len());
    Some(OsString::from_wide(&file[..length]).into())
}

pub fn choose_folder(window: &Window, title: &str) -> Option<PathBuf> {
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, CoTaskMemFree};
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH,
    };
    use windows::core::HSTRING;
    // SAFETY: the web view has set up COM on this thread, where every call runs.
    unsafe {
        let dialog: IFileOpenDialog =
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
        dialog
            .SetOptions(dialog.GetOptions().ok()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
            .ok()?;
        dialog.SetTitle(&HSTRING::from(title)).ok()?;
        dialog
            .Show(Some(windows::Win32::Foundation::HWND(window.hwnd() as _)))
            .ok()?;
        let name = dialog
            .GetResult()
            .ok()?
            .GetDisplayName(SIGDN_FILESYSPATH)
            .ok()?;
        let path = name.to_string().ok();
        CoTaskMemFree(Some(name.0 as _));
        path.map(PathBuf::from)
    }
}

pub fn fatal(message: &str) -> ! {
    log::error!("{message}");
    let (text, title) = (wide(message), wide("AIOStreams"));
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        )
    };
    std::process::exit(1)
}

/// The computer's name, which Jellyfin apps give as their device.
pub fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows".into())
}

pub fn total_memory() -> Option<u64> {
    // SAFETY: MEMORYSTATUSEX is plain data, which the call fills.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut status) != 0).then_some(status.ullTotalPhys)
    }
}

/// `("2026-09-24", "21:03:04.123")`.
pub fn local_time() -> (String, String) {
    let mut t: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut t) };
    (
        format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay),
        format!(
            "{:02}:{:02}:{:02}.{:03}",
            t.wHour, t.wMinute, t.wSecond, t.wMilliseconds
        ),
    )
}

fn os_value(name: &str, flags: u32, data: &mut [u8]) -> Option<usize> {
    let key = wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
    let mut size = data.len() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            wide(name).as_ptr(),
            flags,
            std::ptr::null_mut(),
            data.as_mut_ptr().cast(),
            &mut size,
        )
    };
    (status == 0).then_some(size as usize)
}

/// E.g. `Windows 11 24H2, build 26100.4652`; the registry's product name says 10 on 11.
pub fn os_version() -> String {
    let text = |name: &str| {
        let mut buf = [0u8; 256];
        let size = os_value(name, RRF_RT_REG_SZ, &mut buf)?;
        let units: Vec<u16> = buf[..size]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .take_while(|&u| u != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    };
    let mut ubr = [0u8; 4];
    let revision = os_value("UBR", RRF_RT_REG_DWORD, &mut ubr).map(|_| u32::from_le_bytes(ubr));
    let build = text("CurrentBuild").unwrap_or_default();
    let name = match build.parse::<u32>() {
        Ok(n) if n >= 22000 => "Windows 11",
        Ok(_) => "Windows 10",
        Err(_) => "Windows",
    };
    let release = text("DisplayVersion")
        .map(|r| format!(" {r}"))
        .unwrap_or_default();
    let revision = revision.map(|r| format!(".{r}")).unwrap_or_default();
    format!("{name}{release}, build {build}{revision}")
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
        paths.push(dir.join("libmpv-2.dll"));
    }
    if cfg!(debug_assertions) {
        paths.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../vendor")
                .join(std::env::consts::ARCH)
                .join("libmpv-2.dll"),
        );
    }
    paths
}

/// libmpv imports vulkan-1.dll, which GPU drivers install. Where Windows has none, loading
/// the copy in the `vulkan` folder beside libmpv first is what resolves that import.
pub fn load_vulkan_loader(libmpv: &Path) {
    if !unsafe { LoadLibraryW(wide("vulkan-1.dll").as_ptr()) }.is_null() {
        return;
    }
    let bundled = libmpv.with_file_name("vulkan").join("vulkan-1.dll");
    let path = wide(&bundled.to_string_lossy());
    if unsafe { LoadLibraryW(path.as_ptr()) }.is_null() {
        let error = std::io::Error::last_os_error();
        log::warn!("could not load {}: {error}", bundled.display());
    } else {
        log::info!("Windows has no vulkan-1.dll; loaded {}", bundled.display());
    }
}

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use aiostreams_desktop_core::mpv::Mpv;
use tao::platform::windows::{IconExtWindows, WindowExtWindows};
use tao::window::{Icon, Window};

use windows_sys::Win32::Foundation::SYSTEMTIME;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows_sys::Win32::Graphics::Gdi::{BLACK_BRUSH, GetStockObject};
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegDeleteTreeW,
    RegGetValueW, RegSetKeyValueW,
};
use windows_sys::Win32::System::SystemInformation::GetLocalTime;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, FindWindowExW, FindWindowW, HWND_BOTTOM, HWND_MESSAGE,
    IsIconic, MB_ICONERROR, MB_OK, MessageBoxW, RegisterClassW, SMTO_ABORTIFHUNG, SW_RESTORE,
    SW_SHOWNORMAL, SWP_NOACTIVATE, SendMessageTimeoutW, SetForegroundWindow, SetWindowPos,
    ShowWindow, WM_COPYDATA, WNDCLASSW, WS_CHILD, WS_VISIBLE,
};

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

unsafe extern "system" fn video_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// The child window mpv draws into, kept beneath the web view.
pub struct VideoSurface {
    hwnd: HWND,
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
            Ok(Self { hwnd })
        }
    }

    /// mpv draws into the window itself, so it needs no render context.
    pub fn attach(&self, _mpv: Arc<Mpv>) {}

    pub fn shutdown(&self) {}

    pub fn resize(&self, width: u32, height: u32) {
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
    ]
}

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

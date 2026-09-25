use std::path::{Path, PathBuf};

use tao::platform::windows::IconExtWindows;
use tao::window::Icon;

use windows_sys::Win32::Foundation::SYSTEMTIME;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HANDLE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows_sys::Win32::Graphics::Gdi::{BLACK_BRUSH, GetStockObject};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Registry::{
    HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegGetValueW,
};
use windows_sys::Win32::System::SystemInformation::GetLocalTime;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, FindWindowW, HWND_BOTTOM, IsIconic, MB_ICONERROR, MB_OK,
    MessageBoxW, RegisterClassW, SW_RESTORE, SW_SHOWNORMAL, SWP_NOACTIVATE, SetForegroundWindow,
    SetWindowPos, ShowWindow, WNDCLASSW, WS_CHILD, WS_VISIBLE,
};

/// Custom protocols are served from `http://<scheme>.localhost` on Windows.
pub const APP_URL: &str = "http://aiostreams.localhost/";
pub const PLATFORM: &str = "windows";

/// The main window's class, which a second launch looks the first one up by.
pub const WINDOW_CLASS: &str = "AIOStreamsDesktop";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Held for as long as the app runs.
pub struct SingleInstance(#[allow(dead_code)] HANDLE);

/// One copy per data folder, whose WebView2 profile two copies cannot share: a
/// second launch brings the first window forward and gets None.
pub fn claim_instance(data_dir: &Path) -> Option<SingleInstance> {
    let key = data_dir.to_string_lossy().to_lowercase();
    // FNV-1a: stable across builds, unlike std's hasher.
    let hash = key.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    let name = wide(&format!("Local\\AIOStreamsDesktop-{hash:016x}"));
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() || unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
        return Some(SingleInstance(handle));
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
    pub fn new(parent: isize, width: u32, height: u32) -> Result<Self, String> {
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

    pub fn wid(&self) -> String {
        (self.hwnd as i64).to_string()
    }

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

pub fn mpv_options(wid: &str) -> Vec<(&'static str, String)> {
    vec![
        ("wid", wid.to_string()),
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

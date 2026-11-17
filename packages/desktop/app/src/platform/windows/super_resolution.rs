//! The graphics card's own video upscaling, which mpv's d3d11vpp filter asks the driver for.

use std::mem::{offset_of, size_of, zeroed};
use std::sync::{Arc, LazyLock};

use aiostreams_desktop_core::upscale::{Display, DisplayProbe};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL, D3D11CreateDevice,
    ID3D11VideoContext, ID3D11VideoDevice,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_RATIONAL;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::core::{GUID, Interface};
use windows_sys::Win32::Devices::Display::{
    DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_DEVICE_INFO_TYPE, DISPLAYCONFIG_MODE_INFO,
    DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME, DisplayConfigGetDeviceInfo,
    GetDisplayConfigBufferSizes, QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig,
};
use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HWND};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFOEXW, MonitorFromWindow,
};

/// The driver extensions mpv's filter turns each maker's upscaling on with.
const NVIDIA_PPE_INTERFACE: GUID = GUID::from_u128(0xd43ce1b3_1f4b_48ac_baee_c3c25375e6f7);
const INTEL_VPE_INTERFACE: GUID = GUID::from_u128(0xedd1d4b9_8659_4cbc_a4d6_9831a2163ac3);
const NVIDIA: u32 = 0x10de;
const INTEL: u32 = 0x8086;

#[repr(C)]
struct NvidiaExtension {
    version: u32,
    method: u32,
    enable: u32,
}

#[repr(C)]
struct IntelExtension {
    function: u32,
    param: *const u32,
}

/// mpv's `scaling-mode` for the card, where it upscales.
static SCALING: LazyLock<Option<&'static str>> = LazyLock::new(|| {
    let scaling = probe().unwrap_or(None);
    log::info!("graphics card upscaling={}", scaling.unwrap_or("none"));
    scaling
});

/// Runs the driver check off the window's thread, so nothing waits for it later.
pub fn check_super_resolution() {
    std::thread::spawn(|| LazyLock::force(&SCALING));
}

pub fn super_resolution() -> bool {
    SCALING.is_some()
}

/// Asks the driver for its upscaling on a small video processor, on the default card that mpv
/// draws with too. This says the card and driver have it, not that the driver's switch for it is on.
fn probe() -> windows::core::Result<Option<&'static str>> {
    let (mut device, mut context) = (None, None);
    // SAFETY: plain out-parameters; the interfaces release themselves.
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let (Some(device), Some(context)) = (device, context) else {
        return Ok(None);
    };
    // SAFETY: plain getters on live interfaces.
    let vendor = unsafe {
        device
            .cast::<IDXGIDevice>()?
            .GetAdapter()?
            .GetDesc()?
            .VendorId
    };
    let video: ID3D11VideoDevice = device.cast()?;
    let video_context: ID3D11VideoContext = context.cast()?;
    let rate = DXGI_RATIONAL {
        Numerator: 60,
        Denominator: 1,
    };
    let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputFrameRate: rate,
        InputWidth: 1280,
        InputHeight: 720,
        OutputFrameRate: rate,
        OutputWidth: 1920,
        OutputHeight: 1080,
        Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    };
    // SAFETY: `desc` and each extension outlive the calls that read them.
    unsafe {
        let processor =
            video.CreateVideoProcessor(&video.CreateVideoProcessorEnumerator(&desc)?, 0)?;
        match vendor {
            NVIDIA => {
                let extension = NvidiaExtension {
                    version: 1,
                    method: 2,
                    enable: 1,
                };
                let result = video_context.VideoProcessorSetStreamExtension(
                    &processor,
                    0,
                    &NVIDIA_PPE_INTERFACE,
                    size_of::<NvidiaExtension>() as u32,
                    (&raw const extension).cast(),
                );
                Ok((result >= 0).then_some("nvidia"))
            }
            // The version and mode go on the output, the scaling on the stream. The calls also
            // succeed on Intel chips too old to upscale, which then scale as before.
            INTEL => {
                for (function, param, output) in
                    [(0x01, 3, true), (0x20, 1, true), (0x37, 2, false)]
                {
                    let extension = IntelExtension {
                        function,
                        param: &param,
                    };
                    let (size, data) = (size_of::<IntelExtension>() as u32, &raw const extension);
                    let result = if output {
                        video_context.VideoProcessorSetOutputExtension(
                            &processor,
                            &INTEL_VPE_INTERFACE,
                            size,
                            data.cast(),
                        )
                    } else {
                        video_context.VideoProcessorSetStreamExtension(
                            &processor,
                            0,
                            &INTEL_VPE_INTERFACE,
                            size,
                            data.cast(),
                        )
                    };
                    if result < 0 {
                        return Ok(None);
                    }
                }
                Ok(Some("intel"))
            }
            _ => Ok(None),
        }
    }
}

/// The screen under the video window, while the card can upscale.
pub fn display_probe(video: HWND) -> Option<DisplayProbe> {
    let video = video as isize;
    Some(Arc::new(move || screen(video as HWND, (*SCALING)?)))
}

fn screen(window: HWND, scaling: &'static str) -> Option<Display> {
    // SAFETY: the info is sized for the extended form it is read as.
    let info = unsafe {
        let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFOEXW = zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        (GetMonitorInfoW(monitor, (&raw mut info).cast()) != 0).then_some(info)?
    };
    let rect = info.monitorInfo.rcMonitor;
    Some(Display {
        width: f64::from(rect.right - rect.left),
        height: f64::from(rect.bottom - rect.top),
        scaling,
        hdr: scaling == "nvidia"
            && active_paths().is_some_and(|paths| {
                paths
                    .iter()
                    .find(|path| source_name(path) == Some(info.szDevice))
                    .is_some_and(in_hdr)
            }),
    })
}

fn active_paths() -> Option<Vec<DISPLAYCONFIG_PATH_INFO>> {
    // The layout can change between asking for the sizes and the paths.
    for _ in 0..3 {
        let (mut count, mut modes) = (0, 0);
        // SAFETY: the buffers are as long as the counts passed with them.
        unsafe {
            if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut count, &mut modes)
                != ERROR_SUCCESS
            {
                return None;
            }
            let mut paths = vec![zeroed::<DISPLAYCONFIG_PATH_INFO>(); count as usize];
            let mut mode_info = vec![zeroed::<DISPLAYCONFIG_MODE_INFO>(); modes as usize];
            match QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut count,
                paths.as_mut_ptr(),
                &mut modes,
                mode_info.as_mut_ptr(),
                std::ptr::null_mut(),
            ) {
                ERROR_SUCCESS => {
                    paths.truncate(count as usize);
                    return Some(paths);
                }
                ERROR_INSUFFICIENT_BUFFER => {}
                _ => return None,
            }
        }
    }
    None
}

fn source_name(path: &DISPLAYCONFIG_PATH_INFO) -> Option<[u16; 32]> {
    // SAFETY: the header gives the request's real size.
    unsafe {
        let mut name: DISPLAYCONFIG_SOURCE_DEVICE_NAME = zeroed();
        name.header = DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
            size: size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
            adapterId: path.sourceInfo.adapterId,
            id: path.sourceInfo.id,
        };
        (DisplayConfigGetDeviceInfo(&mut name.header) == 0).then_some(name.viewGdiDeviceName)
    }
}

/// `DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2`, which ends with the field the first version lacks.
#[repr(C)]
struct AdvancedColorInfo {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    value: u32,
    color_encoding: i32,
    bits_per_color_channel: u32,
    active_color_mode: i32,
}

const GET_ADVANCED_COLOR_INFO_2: DISPLAYCONFIG_DEVICE_INFO_TYPE = 15;
const ADVANCED_COLOR_MODE_HDR: i32 = 2;
const ADVANCED_COLOR_ENABLED: u32 = 1 << 1;
const WIDE_COLOR_ENFORCED: u32 = 1 << 2;

/// HDR mode, rather than SDR with or without the system's colour management.
fn in_hdr(path: &DISPLAYCONFIG_PATH_INFO) -> bool {
    let ask = |kind, size: usize| {
        // SAFETY: `size` covers no more of the struct than the request writes.
        unsafe {
            let mut info: AdvancedColorInfo = zeroed();
            info.header = DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: kind,
                size: size as u32,
                adapterId: path.targetInfo.adapterId,
                id: path.targetInfo.id,
            };
            (DisplayConfigGetDeviceInfo(&mut info.header) == 0).then_some(info)
        }
    };
    if let Some(info) = ask(GET_ADVANCED_COLOR_INFO_2, size_of::<AdvancedColorInfo>()) {
        return info.active_color_mode == ADVANCED_COLOR_MODE_HDR;
    }
    // Before Windows 11 24H2.
    let first = offset_of!(AdvancedColorInfo, active_color_mode);
    ask(DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO, first).is_some_and(|info| {
        info.value & (ADVANCED_COLOR_ENABLED | WIDE_COLOR_ENFORCED) == ADVANCED_COLOR_ENABLED
    })
}

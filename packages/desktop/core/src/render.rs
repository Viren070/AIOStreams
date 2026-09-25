//! libmpv's render API for OpenGL, where mpv draws into a surface the app owns.

use std::ffi::{c_char, c_int, c_void};
use std::ptr;
use std::sync::Arc;

use crate::mpv::Mpv;

const PARAM_INVALID: c_int = 0;
const PARAM_API_TYPE: c_int = 1;
const PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const PARAM_OPENGL_FBO: c_int = 3;
const PARAM_FLIP_Y: c_int = 4;
const PARAM_X11_DISPLAY: c_int = 8;
const PARAM_WL_DISPLAY: c_int = 9;

#[repr(C)]
struct Param {
    kind: c_int,
    data: *mut c_void,
}

pub type GetProcAddress = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;

/// Lets hardware decoding hand frames to OpenGL without a copy.
#[derive(Clone, Copy, Debug)]
pub enum NativeDisplay {
    X11(*mut c_void),
    Wayland(*mut c_void),
}

#[repr(C)]
struct OpenGlInitParams {
    get_proc_address: GetProcAddress,
    get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
struct OpenGlFbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
}

type Context = *mut c_void;
type UpdateCallback = unsafe extern "C" fn(*mut c_void);

struct Api {
    create: unsafe extern "C" fn(*mut Context, crate::mpv::Handle, *mut Param) -> c_int,
    render: unsafe extern "C" fn(Context, *mut Param) -> c_int,
    set_update_callback: unsafe extern "C" fn(Context, Option<UpdateCallback>, *mut c_void),
    update: unsafe extern "C" fn(Context) -> u64,
    free: unsafe extern "C" fn(Context),
}

type OnUpdate = Box<dyn Fn() + Send + Sync>;

/// Must be created and used on the thread whose OpenGL context is current.
/// It keeps mpv alive, since mpv must outlive it.
pub struct RenderContext {
    api: Api,
    ctx: Context,
    on_update: Option<Box<OnUpdate>>,
    mpv: Arc<Mpv>,
}

unsafe extern "C" fn trampoline(data: *mut c_void) {
    // SAFETY: `data` is the boxed callback, alive until it is replaced or freed.
    let f = unsafe { &*(data as *const OnUpdate) };
    f();
}

impl RenderContext {
    pub fn new(
        mpv: Arc<Mpv>,
        get_proc_address: GetProcAddress,
        get_proc_address_ctx: *mut c_void,
        display: Option<NativeDisplay>,
    ) -> Result<Self, String> {
        // SAFETY: the types match mpv's render.h.
        let api = unsafe {
            Api {
                create: mpv.symbol("mpv_render_context_create")?,
                render: mpv.symbol("mpv_render_context_render")?,
                set_update_callback: mpv.symbol("mpv_render_context_set_update_callback")?,
                update: mpv.symbol("mpv_render_context_update")?,
                free: mpv.symbol("mpv_render_context_free")?,
            }
        };
        let mut init = OpenGlInitParams {
            get_proc_address,
            get_proc_address_ctx,
        };
        let mut params = vec![
            Param {
                kind: PARAM_API_TYPE,
                data: c"opengl".as_ptr() as *mut c_void,
            },
            Param {
                kind: PARAM_OPENGL_INIT_PARAMS,
                data: (&raw mut init).cast(),
            },
        ];
        match display {
            Some(NativeDisplay::X11(d)) => params.push(Param {
                kind: PARAM_X11_DISPLAY,
                data: d,
            }),
            Some(NativeDisplay::Wayland(d)) => params.push(Param {
                kind: PARAM_WL_DISPLAY,
                data: d,
            }),
            None => {}
        }
        params.push(Param {
            kind: PARAM_INVALID,
            data: ptr::null_mut(),
        });
        let mut ctx: Context = ptr::null_mut();
        // SAFETY: a parameter list ending in INVALID, and a handle mpv.new initialised.
        let code = unsafe { (api.create)(&mut ctx, mpv.handle(), params.as_mut_ptr()) };
        if code < 0 {
            return Err(format!("mpv render context: {}", mpv.error(code)));
        }
        Ok(Self {
            api,
            ctx,
            on_update: None,
            mpv,
        })
    }

    /// Called on one of mpv's threads whenever a new frame is ready.
    pub fn on_update(&mut self, f: impl Fn() + Send + Sync + 'static) {
        let boxed: Box<OnUpdate> = Box::new(Box::new(f));
        let data = (&*boxed as *const OnUpdate).cast_mut().cast();
        // SAFETY: the box outlives the callback: it is replaced or cleared before it drops.
        unsafe { (self.api.set_update_callback)(self.ctx, Some(trampoline), data) };
        self.on_update = Some(boxed);
    }

    pub fn render(&self, fbo: i32, width: i32, height: i32, flip_y: bool) {
        // SAFETY: valid context; the update flags are only acknowledged.
        unsafe { (self.api.update)(self.ctx) };
        let mut target = OpenGlFbo {
            fbo,
            w: width,
            h: height,
            internal_format: 0,
        };
        let mut flip: c_int = flip_y.into();
        let mut params = [
            Param {
                kind: PARAM_OPENGL_FBO,
                data: (&raw mut target).cast(),
            },
            Param {
                kind: PARAM_FLIP_Y,
                data: (&raw mut flip).cast(),
            },
            Param {
                kind: PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];
        // SAFETY: a parameter list ending in INVALID, on the thread with the GL context.
        let code = unsafe { (self.api.render)(self.ctx, params.as_mut_ptr()) };
        if code < 0 {
            log::warn!("mpv render: {}", self.mpv.error(code));
        }
    }
}

impl Drop for RenderContext {
    fn drop(&mut self) {
        // SAFETY: the callback is cleared before its box drops, then the context is freed.
        unsafe {
            (self.api.set_update_callback)(self.ctx, None, ptr::null_mut());
            (self.api.free)(self.ctx);
        }
    }
}

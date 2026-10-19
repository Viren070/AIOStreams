use std::ffi::{CStr, CString, c_char, c_int, c_void};

#[repr(C)]
pub struct Frame {
    pub width: c_int,
    pub height: c_int,
    pub bits: c_int,
    pub log2_chroma_w: c_int,
    pub log2_chroma_h: c_int,
    pub planar_yuv: c_int,
    pub data: [*const u8; 3],
    pub linesize: [c_int; 3],
    pub color_range: c_int,
    pub color_primaries: c_int,
    pub color_trc: c_int,
    pub colorspace: c_int,
    pub has_dovi: c_int,
    pub pix_fmt: *const c_char,
}

unsafe extern "C" {
    fn ffd_open(
        name: *const c_char,
        threads: c_int,
        skip_loop_filter: c_int,
        fast: c_int,
        low_delay: c_int,
        err: *mut c_char,
        errlen: c_int,
    ) -> *mut c_void;
    fn ffd_decode(
        d: *mut c_void,
        buf: *const u8,
        size: c_int,
        out: *mut Frame,
        err: *mut c_char,
        errlen: c_int,
    ) -> c_int;
    fn ffd_close(d: *mut c_void);
}

pub struct Options {
    pub threads: i32,
    pub skip_loop_filter: bool,
    pub fast: bool,
}

pub struct Decoder {
    d: *mut c_void,
    frame: Frame,
}

unsafe impl Send for Decoder {}

fn message(err: &[c_char]) -> String {
    unsafe { CStr::from_ptr(err.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

impl Decoder {
    pub fn open(name: &str, o: &Options) -> Result<Decoder, String> {
        let mut err = [0 as c_char; 256];
        let name = CString::new(name).unwrap();
        let d = unsafe {
            ffd_open(
                name.as_ptr(),
                o.threads,
                o.skip_loop_filter as c_int,
                o.fast as c_int,
                1,
                err.as_mut_ptr(),
                256,
            )
        };
        if d.is_null() {
            Err(message(&err))
        } else {
            Ok(Decoder {
                d,
                frame: unsafe { std::mem::zeroed() },
            })
        }
    }

    /// Decodes one packet; the frame borrows the decoder until the next call.
    pub fn decode(&mut self, packet: &[u8]) -> Result<&Frame, String> {
        let mut err = [0 as c_char; 256];
        let ret = unsafe {
            ffd_decode(
                self.d,
                packet.as_ptr(),
                packet.len() as c_int,
                &mut self.frame,
                err.as_mut_ptr(),
                256,
            )
        };
        if ret < 0 {
            return Err(message(&err));
        }
        Ok(&self.frame)
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { ffd_close(self.d) }
    }
}

impl Frame {
    pub fn pix_fmt(&self) -> String {
        unsafe { CStr::from_ptr(self.pix_fmt) }
            .to_string_lossy()
            .into_owned()
    }
}

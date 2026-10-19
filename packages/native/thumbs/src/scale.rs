use crate::decode::Frame;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Transfer {
    Sdr,
    Pq,
    Hlg,
}

pub struct Color {
    kr: f32,
    kb: f32,
    full: bool,
    transfer: Transfer,
    bt2020: bool,
    lin: Vec<f32>,
    enc: Vec<u8>,
}

const LIN_SIZE: usize = 4096;
const ENC_SIZE: usize = 4096;

fn pq_eotf(e: f32) -> f32 {
    let (m1, m2) = (2610.0 / 16384.0, 2523.0 / 4096.0 * 128.0);
    let (c1, c2, c3) = (
        3424.0 / 4096.0,
        2413.0 / 4096.0 * 32.0,
        2392.0 / 4096.0 * 32.0,
    );
    let p = e.max(0.0).powf(1.0 / m2);
    10000.0 * ((p - c1).max(0.0) / (c2 - c3 * p)).powf(1.0 / m1)
}

fn hlg_inverse_oetf(e: f32) -> f32 {
    let a = 0.178_832_77_f32;
    let (b, c) = (1.0 - 4.0 * a, 0.5 - a * (4.0 * a).ln());
    if e <= 0.5 {
        e * e / 3.0
    } else {
        (((e - c) / a).exp() + b) / 12.0
    }
}

impl Color {
    /// Codes are ITU-T H.273.
    pub fn new(matrix: i32, range: i32, transfer: i32, primaries: i32, height: i32) -> Color {
        let (kr, kb) = match matrix {
            1 => (0.2126, 0.0722),
            9 | 10 => (0.2627, 0.0593),
            5 | 6 => (0.299, 0.114),
            _ if primaries == 9 => (0.2627, 0.0593),
            _ if height > 576 => (0.2126, 0.0722),
            _ => (0.299, 0.114),
        };
        let transfer = match transfer {
            16 => Transfer::Pq,
            18 => Transfer::Hlg,
            _ => Transfer::Sdr,
        };
        let mut c = Color {
            kr,
            kb,
            full: range == 2,
            transfer,
            bt2020: primaries == 9 || matrix == 9,
            lin: Vec::new(),
            enc: Vec::new(),
        };
        if transfer != Transfer::Sdr {
            // Signal to display light in units of SDR white (100 nits).
            c.lin = (0..LIN_SIZE)
                .map(|i| {
                    let e = i as f32 / (LIN_SIZE - 1) as f32;
                    match transfer {
                        Transfer::Pq => pq_eotf(e) / 100.0,
                        _ => hlg_inverse_oetf(e) * 1000.0 / 100.0,
                    }
                })
                .collect();
            c.enc = (0..ENC_SIZE)
                .map(|i| {
                    let l = i as f32 / (ENC_SIZE - 1) as f32;
                    let v = if l <= 0.0031308 {
                        12.92 * l
                    } else {
                        1.055 * l.powf(1.0 / 2.4) - 0.055
                    };
                    (v * 255.0 + 0.5) as u8
                })
                .collect();
        }
        c
    }

    pub fn transfer(&self) -> Transfer {
        self.transfer
    }

    #[inline]
    fn rgb(&self, y: f32, cb: f32, cr: f32, out: &mut [u8]) {
        let (kr, kb) = (self.kr, self.kb);
        let r = y + 2.0 * (1.0 - kr) * cr;
        let b = y + 2.0 * (1.0 - kb) * cb;
        let g = (y - kr * r - kb * b) / (1.0 - kr - kb);
        if self.transfer == Transfer::Sdr {
            out[0] = (r.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            out[1] = (g.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            out[2] = (b.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            return;
        }
        let lin = |v: f32| self.lin[((v.clamp(0.0, 1.0) * (LIN_SIZE - 1) as f32) + 0.5) as usize];
        let (mut r, mut g, mut b) = (lin(r), lin(g), lin(b));
        if self.transfer == Transfer::Hlg {
            // HLG system gamma 1.2 at 1000 nits.
            let ys = (0.2627 * r + 0.678 * g + 0.0593 * b).max(1e-6) * 100.0 / 1000.0;
            let f = ys.powf(0.2);
            r *= f;
            g *= f;
            b *= f;
        }
        if self.bt2020 {
            (r, g, b) = (
                1.6605 * r - 0.5876 * g - 0.0728 * b,
                -0.1246 * r + 1.1329 * g - 0.0083 * b,
                -0.0182 * r - 0.1006 * g + 1.1187 * b,
            );
        }
        // Extended Reinhard on the brightest channel, 1000-nit peak.
        let m = r.max(g).max(b);
        if m > 0.0 {
            const PEAK2: f32 = 10.0 * 10.0;
            let s = (1.0 + m / PEAK2) / (1.0 + m);
            r *= s;
            g *= s;
            b *= s;
        }
        let enc = |v: f32| self.enc[((v.clamp(0.0, 1.0) * (ENC_SIZE - 1) as f32) + 0.5) as usize];
        out[0] = enc(r);
        out[1] = enc(g);
        out[2] = enc(b);
    }
}

/// `n` evenly spread taps inside each output cell along one axis, flattened, shifted by `offset`.
fn taps(src: usize, out: usize, n: usize, offset: usize) -> Vec<u32> {
    let mut v = Vec::with_capacity(out * n);
    for o in 0..out {
        let a = o * src / out;
        let w = ((o + 1) * src / out).max(a + 1) - a;
        for t in 0..n {
            v.push((offset + a + (2 * t + 1) * w / (2 * n)) as u32);
        }
    }
    v
}

struct Plane {
    xs: Vec<u32>,
    ys: Vec<u32>,
    n: usize,
    shift_y: u32,
    sums: Vec<u32>,
}

/// A thumbnail built strip by strip: each decoded strip adds the taps that fall inside it.
pub struct Accum {
    ow: usize,
    oh: usize,
    bits: i32,
    /// Colour codes the bitstream signals: matrix, range, transfer, primaries.
    pub signalled: Option<[i32; 4]>,
    planes: [Plane; 3],
}

fn add_plane<T: Copy + Into<u32>, const N: usize>(
    p: &mut Plane,
    ow: usize,
    data: *const u8,
    stride: usize,
    first: usize,
    rows: usize,
) {
    let lo = p.ys.partition_point(|&y| (y as usize) < first);
    let hi = p.ys.partition_point(|&y| (y as usize) < first + rows);
    for k in lo..hi {
        let oy = k / N;
        let row = unsafe { data.add((p.ys[k] as usize - first) * stride) as *const T };
        let sums = &mut p.sums[oy * ow..(oy + 1) * ow];
        for (sum, cell) in sums.iter_mut().zip(p.xs.as_chunks::<N>().0) {
            let mut s = 0u32;
            for &x in cell {
                s += unsafe { (*row.add(x as usize)).into() };
            }
            *sum += s;
        }
    }
}

type AddPlane = fn(&mut Plane, usize, *const u8, usize, usize, usize);

fn add_for(wide: bool, n: usize) -> AddPlane {
    match (wide, n) {
        (false, 1) => add_plane::<u8, 1>,
        (false, 2) => add_plane::<u8, 2>,
        (false, 3) => add_plane::<u8, 3>,
        (false, _) => add_plane::<u8, 4>,
        (true, 1) => add_plane::<u16, 1>,
        (true, 2) => add_plane::<u16, 2>,
        (true, 3) => add_plane::<u16, 3>,
        (true, _) => add_plane::<u16, 4>,
    }
}

/// The shown part of a picture, in coded luma samples, and its chroma subsampling shifts.
#[derive(Clone, Copy)]
pub struct Area {
    pub width: usize,
    pub height: usize,
    pub left: usize,
    pub top: usize,
    pub chroma: (u32, u32),
}

impl Accum {
    /// Samples about `samples` taps per cell edge.
    pub fn new(area: Area, ow: usize, oh: usize, samples: usize) -> Accum {
        let n_taps = |src: usize, out: usize| samples.clamp(1, 4).min((src / out).max(1));
        let plane = |sx: u32, sy: u32| {
            let (pw, ph) = (
                (area.width + (1 << sx) - 1) >> sx,
                (area.height + (1 << sy) - 1) >> sy,
            );
            let n = n_taps(pw, ow).min(n_taps(ph, oh));
            Plane {
                xs: taps(pw, ow, n, area.left >> sx),
                ys: taps(ph, oh, n, area.top >> sy),
                n,
                shift_y: sy,
                sums: vec![0; ow * oh],
            }
        };
        let (sx, sy) = area.chroma;
        Accum {
            ow,
            oh,
            bits: 8,
            signalled: None,
            planes: [plane(0, 0), plane(sx, sy), plane(sx, sy)],
        }
    }

    pub fn whole(f: &Frame, ow: usize, oh: usize, samples: usize) -> Result<Accum, String> {
        let area = Area {
            width: f.width as usize,
            height: f.height as usize,
            left: 0,
            top: 0,
            chroma: (f.log2_chroma_w as u32, f.log2_chroma_h as u32),
        };
        let mut a = Accum::new(area, ow, oh, samples);
        a.add(f, 0, f.height as usize)?;
        Ok(a)
    }

    /// Adds the first `rows` luma rows of a decoded strip whose first row is coded luma row `y`.
    pub fn add(&mut self, f: &Frame, y: usize, rows: usize) -> Result<(), String> {
        if f.planar_yuv == 0 {
            return Err(format!("unsupported pixel format {}", f.pix_fmt()));
        }
        self.bits = f.bits;
        self.signalled
            .get_or_insert([f.colorspace, f.color_range, f.color_trc, f.color_primaries]);
        let ow = self.ow;
        for (i, p) in self.planes.iter_mut().enumerate() {
            let shift = if i == 0 { 0 } else { f.log2_chroma_h as u32 };
            debug_assert_eq!(shift, p.shift_y);
            let rows = (rows.min(f.height as usize) + (1 << shift) - 1) >> shift;
            add_for(f.bits > 8, p.n)(p, ow, f.data[i], f.linesize[i] as usize, y >> shift, rows);
        }
        Ok(())
    }

    pub fn rgb(&self, color: &Color) -> Vec<u8> {
        let scale = (1u32 << (self.bits - 8)) as f32;
        let (yo, ys, cs, co) = if color.full {
            (
                0.0,
                1.0 / (255.0 * scale),
                1.0 / (255.0 * scale),
                128.0 * scale,
            )
        } else {
            (
                16.0 * scale,
                1.0 / (219.0 * scale),
                1.0 / (224.0 * scale),
                128.0 * scale,
            )
        };
        let mean = |p: &Plane, i: usize| p.sums[i] as f32 / (p.n * p.n) as f32;
        let [py, pu, pv] = &self.planes;
        let mut rgb = vec![0u8; self.ow * self.oh * 3];
        for i in 0..self.ow * self.oh {
            color.rgb(
                (mean(py, i) - yo) * ys,
                (mean(pu, i) - co) * cs,
                (mean(pv, i) - co) * cs,
                &mut rgb[i * 3..i * 3 + 3],
            );
        }
        rgb
    }
}

pub fn jpeg(rgb: &[u8], w: usize, h: usize, quality: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 * 1024);
    jpeg_encoder::Encoder::new(&mut out, quality)
        .encode(rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
        .expect("jpeg");
    out
}

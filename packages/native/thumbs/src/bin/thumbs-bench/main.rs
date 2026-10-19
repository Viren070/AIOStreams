mod metrics;
mod scrub;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use aiostreams_container::{Options, RangeReader};
use aiostreams_thumbs::{codec, decode, hevc, pool, scale};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Meta {
    codec: String,
    display_width: u64,
    display_height: u64,
    colour: [u64; 4],
    keyframes: Vec<Kf>,
}

#[derive(Serialize, Deserialize)]
struct Kf {
    time_ms: u64,
    file: String,
}

struct Args {
    pos: Vec<String>,
    opts: HashMap<String, String>,
}

impl Args {
    fn parse() -> Args {
        let (mut pos, mut opts) = (Vec::new(), HashMap::new());
        let mut it = std::env::args().skip(1).peekable();
        while let Some(a) = it.next() {
            match a.strip_prefix("--") {
                Some(k) => {
                    let v = if it.peek().is_some_and(|n| !n.starts_with("--")) {
                        it.next().unwrap()
                    } else {
                        "1".into()
                    };
                    opts.insert(k.to_string(), v);
                }
                None => pos.push(a),
            }
        }
        Args { pos, opts }
    }
    fn num(&self, k: &str, d: f64) -> f64 {
        self.opts.get(k).and_then(|v| v.parse().ok()).unwrap_or(d)
    }
    fn has(&self, k: &str) -> bool {
        self.opts.contains_key(k)
    }
}

type Res<T> = Result<T, String>;

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.get(v.len() / 2)
        .map_or(0.0, |m| (m * 10.0).round() / 10.0)
}

fn load(dir: &Path) -> Res<(Meta, Vec<Vec<u8>>)> {
    let meta: Meta =
        serde_json::from_slice(&std::fs::read(dir.join("meta.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let packets = meta
        .keyframes
        .iter()
        .map(|k| std::fs::read(dir.join(&k.file)).map_err(|e| e.to_string()))
        .collect::<Res<_>>()?;
    Ok((meta, packets))
}

fn fetch(a: &Args) -> Res<()> {
    let out = PathBuf::from(a.opts.get("out").ok_or("--out dir")?);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let mut r = RangeReader::new(a.pos.get(1).ok_or("url")?, Options::default())
        .map_err(|e| e.to_string())?;
    let t = Instant::now();
    let k = aiostreams_container::keyframes(&mut r).map_err(|e| e.to_string())?;
    let v = k.track.video.clone().ok_or("no video")?;
    eprintln!(
        "index {:.0} ms, {} KB in {} requests, {} keyframes, {}",
        t.elapsed().as_secs_f64() * 1e3,
        r.bytes / 1024,
        r.requests,
        k.entries.len(),
        k.track.codec
    );
    let kind = codec::Kind::from_codec_id(&k.track.codec).ok_or("codec")?;
    let config = codec::Config::new(kind, &k.track.private)?;
    let n = a.num("n", 12.0) as u64;
    let mut kfs = Vec::new();
    for i in 0..n {
        let index = k.at(k.duration_ms * (3 + i * 94 / (n.max(2) - 1)) / 100);
        let (bytes, t) = (r.bytes, Instant::now());
        let frame = k
            .frame(&mut r, index, 512 * 1024)
            .map_err(|e| e.to_string())?;
        eprintln!(
            "kf {i:2} at {:>7.1}s: {:>5} KB, read {:>5} KB, {:>4.0} ms",
            k.entries[index].time_ms as f64 / 1e3,
            frame.len() / 1024,
            (r.bytes - bytes) / 1024,
            t.elapsed().as_secs_f64() * 1e3
        );
        let file = format!("kf_{i:02}.bin");
        std::fs::write(out.join(&file), config.packet(&frame)?).map_err(|e| e.to_string())?;
        kfs.push(Kf {
            time_ms: k.entries[index].time_ms,
            file,
        });
    }
    let meta = Meta {
        codec: k.track.codec.clone(),
        display_width: v.display_width,
        display_height: v.display_height,
        colour: [v.matrix, v.range, v.transfer, v.primaries],
        keyframes: kfs,
    };
    std::fs::write(
        out.join("meta.json"),
        serde_json::to_string_pretty(&meta).unwrap(),
    )
    .map_err(|e| e.to_string())
}

fn decode(a: &Args) -> Res<()> {
    let dir = PathBuf::from(a.pos.get(1).ok_or("dir")?);
    let (meta, packets) = load(&dir)?;
    if a.has("idle") {
        aiostreams_thumbs::priority::background();
    }
    let kind = codec::Kind::from_codec_id(&meta.codec).ok_or("codec")?;
    let options = decode::Options {
        threads: a.num("threads", 1.0) as i32,
        skip_loop_filter: a.num("skiplf", 1.0) != 0.0,
        fast: false,
    };
    let ow = a.num("width", 320.0) as usize;
    let oh =
        ((ow as u64 * meta.display_height / meta.display_width.max(1)) as usize).div_ceil(2) * 2;
    let samples = a.num("samples", 2.0) as usize;
    let split = a.num("split", 0.0) as usize;
    let (rss0, _) = metrics::rss_mb();
    let mut dec = decode::Decoder::open(kind.decoder(), &options)?;
    let strips = (split > 0).then(|| pool::Pool::new(split, kind.decoder(), a.has("idle")));
    let [m, r, t, p] = meta.colour.map(|c| c as i32);
    let color = scale::Color::new(m, r, t, p, meta.display_height as i32);
    let (mut walls, mut cpus, mut sheet) = (Vec::new(), Vec::new(), Vec::new());
    let repeat = a.num("repeat", 3.0) as usize;
    for round in 0..repeat {
        for p in &packets {
            let (c0, t0) = (metrics::cpu_ms(), Instant::now());
            let acc = match strips
                .as_ref()
                .and_then(|s| hevc::split(p).map(|sp| (s, sp)))
            {
                Some((s, sp)) => s.run(sp, ow, oh, samples)?,
                None => {
                    let f = dec.decode(p)?;
                    scale::Accum::whole(f, ow, oh, samples)?
                }
            };
            let rgb = acc.rgb(&color);
            let jpeg = scale::jpeg(&rgb, ow, oh, 75);
            if round > 0 || repeat == 1 {
                walls.push(t0.elapsed().as_secs_f64() * 1e3);
                cpus.push(metrics::cpu_ms() - c0);
            }
            if round == 0 {
                sheet.push(rgb);
                if a.has("verbose") {
                    eprintln!("{} KB -> {} B jpeg", p.len() / 1024, jpeg.len());
                }
            }
        }
    }
    let (rss1, peak) = metrics::rss_mb();
    if let Some(path) = a.opts.get("sheet") {
        let cols = a.num("cols", 4.0) as usize;
        let (sw, sh) = (ow * cols, oh * sheet.len().div_ceil(cols));
        let mut img = vec![0u8; sw * sh * 3];
        for (k, rgb) in sheet.iter().enumerate() {
            let (cx, cy) = ((k % cols) * ow, (k / cols) * oh);
            for y in 0..oh {
                let d = ((cy + y) * sw + cx) * 3;
                img[d..d + ow * 3].copy_from_slice(&rgb[y * ow * 3..(y + 1) * ow * 3]);
            }
        }
        std::fs::write(path, scale::jpeg(&img, sw, sh, 80)).map_err(|e| e.to_string())?;
    }
    println!(
        "{}",
        serde_json::json!({ "wall_med": median(walls), "cpu_med": median(cpus), "rss_before": rss0, "rss_after": rss1, "rss_peak": peak, "split": split })
    );
    Ok(())
}

fn verify(a: &Args) -> Res<()> {
    let (meta, packets) = load(&PathBuf::from(a.pos.get(1).ok_or("dir")?))?;
    let kind = codec::Kind::from_codec_id(&meta.codec).ok_or("codec")?;
    let options = decode::Options {
        threads: 1,
        skip_loop_filter: a.num("skiplf", 1.0) != 0.0,
        fast: false,
    };
    let (mut whole, mut strip) = (
        decode::Decoder::open(kind.decoder(), &options)?,
        decode::Decoder::open(kind.decoder(), &options)?,
    );
    for (n, p) in packets.iter().enumerate() {
        let Some(split) = hevc::split(p) else {
            println!("kf {n}: not splittable");
            continue;
        };
        let f = whole.decode(p)?;
        let bps = if f.bits > 8 { 2 } else { 1 };
        let shifts = [
            (0, 0),
            (f.log2_chroma_w, f.log2_chroma_h),
            (f.log2_chroma_w, f.log2_chroma_h),
        ];
        let planes: Vec<Vec<u8>> = (0..3)
            .map(|i| {
                let (w, h) = (
                    (f.width >> shifts[i].0) as usize * bps,
                    (f.height >> shifts[i].1) as usize,
                );
                (0..h)
                    .flat_map(|y| {
                        unsafe {
                            std::slice::from_raw_parts(f.data[i].add(y * f.linesize[i] as usize), w)
                        }
                        .to_vec()
                    })
                    .collect()
            })
            .collect();
        let (fw, fh) = (f.width, f.height);
        let (mut diff, mut compared) = ([0usize; 3], 0usize);
        for piece in &split.pieces {
            let s = strip.decode(&piece.packet)?;
            for i in 0..3 {
                let (sx, sy) = shifts[i];
                let w = (fw >> sx) as usize * bps;
                let left = (split.area.left >> sx) * bps;
                for row in 0..(piece.rows.min(s.height as u32) >> sy) as usize {
                    let Some(y) =
                        ((piece.y as usize >> sy) + row).checked_sub(split.area.top >> sy)
                    else {
                        continue;
                    };
                    if y >= (fh >> sy) as usize {
                        continue;
                    }
                    let got = unsafe {
                        std::slice::from_raw_parts(
                            s.data[i].add(row * s.linesize[i] as usize + left),
                            w,
                        )
                    };
                    diff[i] += got
                        .iter()
                        .zip(&planes[i][y * w..(y + 1) * w])
                        .filter(|(g, w)| g != w)
                        .count();
                    compared += w;
                }
            }
        }
        println!(
            "kf {n}: {} strips, {compared} bytes compared, differing y/u/v {diff:?}",
            split.pieces.len()
        );
    }
    Ok(())
}

fn main() {
    let a = Args::parse();
    let r = match a.pos.first().map(String::as_str) {
        Some("fetch") => fetch(&a),
        Some("decode") => decode(&a),
        Some("verify") => verify(&a),
        Some("scrub") => scrub::run(&a.pos, a.num("steps", 20.0) as usize, a.num("interval", 200.0) as u64, a.num("workers", 2.0) as usize),
        _ => Err("thumbs-bench fetch <url|file> --out dir [--n 12] | decode <dir> [--threads 1] [--split N] [--idle] [--samples 2] [--repeat 3] [--sheet f.jpg --cols 4] | verify <dir> [--skiplf 0] | scrub <url> [--steps 20] [--interval 200] [--workers 2]".into()),
    };
    if let Err(e) = r {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

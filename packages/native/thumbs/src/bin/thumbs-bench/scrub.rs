use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use aiostreams_container::Options;
use aiostreams_thumbs::{Settings, Thumbnailer, priority};

/// The newest wanted position and when it was asked for, and whether the run is over.
type Wanted = (Mutex<(Option<(u64, Instant)>, bool)>, Condvar);

/// A held seek key: the wanted position moves every `interval_ms`; one thread makes the newest thumbnail.
pub fn run(pos: &[String], steps: usize, interval_ms: u64, workers: usize) -> Result<(), String> {
    let url = pos.get(1).ok_or("url")?;
    let t0 = Instant::now();
    let mut thumbs = Thumbnailer::open(
        url,
        Options::default(),
        Settings {
            workers,
            ..Settings::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let open_ms = t0.elapsed().as_secs_f64() * 1e3;
    let duration = thumbs.keyframes().duration_ms;
    let wanted: Arc<Wanted> = Arc::default();
    let shown: Arc<Mutex<Vec<(u64, f64)>>> = Arc::default();
    let worker = {
        let (wanted, shown) = (wanted.clone(), shown.clone());
        std::thread::spawn(move || {
            priority::background();
            loop {
                let (ms, asked) = {
                    let (m, cv) = &*wanted;
                    let mut s = m.lock().unwrap();
                    loop {
                        if let Some(w) = s.0.take() {
                            break w;
                        }
                        if s.1 {
                            return;
                        }
                        s = cv.wait(s).unwrap();
                    }
                };
                if thumbs.get(ms).is_ok() {
                    shown
                        .lock()
                        .unwrap()
                        .push((ms, asked.elapsed().as_secs_f64() * 1e3));
                }
            }
        })
    };
    let start = Instant::now();
    let mut last = 0;
    for i in 0..steps {
        last = duration / 10 + duration / 2 * i as u64 / (steps.max(2) - 1) as u64;
        let (m, cv) = &*wanted;
        m.lock().unwrap().0 = Some((last, Instant::now()));
        cv.notify_all();
        std::thread::sleep(Duration::from_millis(interval_ms));
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline && !shown.lock().unwrap().iter().any(|s| s.0 == last) {
        std::thread::sleep(Duration::from_millis(5));
    }
    let settled = start.elapsed().as_secs_f64() * 1e3 - (steps - 1) as f64 * interval_ms as f64;
    {
        let (m, cv) = &*wanted;
        m.lock().unwrap().1 = true;
        cv.notify_all();
    }
    worker.join().ok();
    let shown = shown.lock().unwrap();
    let mut latency: Vec<f64> = shown.iter().map(|s| s.1).collect();
    latency.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "{{\"open_ms\":{open_ms:.0},\"asked\":{steps},\"shown\":{},\"request_to_image_med\":{:.0},\"settled_ms\":{settled:.0}}}",
        shown.len(),
        latency.get(latency.len() / 2).copied().unwrap_or(0.0)
    );
    Ok(())
}

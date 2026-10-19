use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex};

use aiostreams_container::{Keyframes, Options};

use crate::{Result, Settings, Source, Thumbnail, priority};

struct State {
    wanted: Option<usize>,
    /// The newest packet fetched and not yet rendered.
    fetched: Option<(usize, Vec<u8>)>,
    cache: HashMap<usize, Arc<Thumbnail>>,
    order: VecDeque<usize>,
    closed: bool,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

/// Thumbnails for a seek bar: the newest position asked for wins, and the next keyframe is
/// fetched while the previous one renders.
pub struct Session {
    shared: Arc<Shared>,
    keyframes: Arc<Keyframes>,
}

impl Session {
    /// `ready` runs on a background thread with each thumbnail made.
    pub fn open(
        url: &str,
        options: Options,
        settings: Settings,
        ready: impl Fn(Arc<Thumbnail>) + Send + 'static,
    ) -> Result<Session> {
        let mut source = Source::open(url, options)?;
        let keyframes = source.keyframes().clone();
        let (keep, capacity) = (settings.keep_decoders, settings.cache);
        let mut renderer = source.renderer(settings);
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                wanted: None,
                fetched: None,
                cache: HashMap::new(),
                order: VecDeque::new(),
                closed: false,
            }),
            wake: Condvar::new(),
        });
        {
            let shared = shared.clone();
            std::thread::spawn(move || {
                let mut last = None;
                loop {
                    let index = {
                        let mut s = shared.state.lock().unwrap();
                        loop {
                            if s.closed {
                                return;
                            }
                            match s.wanted {
                                Some(i) if Some(i) != last && !s.cache.contains_key(&i) => break i,
                                _ => s = shared.wake.wait(s).unwrap(),
                            }
                        }
                    };
                    last = Some(index);
                    if let Ok(packet) = source.packet(index) {
                        shared.state.lock().unwrap().fetched = Some((index, packet));
                        shared.wake.notify_all();
                    }
                }
            });
        }
        {
            let (shared, keyframes) = (shared.clone(), keyframes.clone());
            std::thread::spawn(move || {
                priority::background();
                loop {
                    let (index, packet) = {
                        let mut s = shared.state.lock().unwrap();
                        loop {
                            if s.closed {
                                return;
                            }
                            if let Some(f) = s.fetched.take() {
                                break f;
                            }
                            let (next, idle) = shared.wake.wait_timeout(s, keep).unwrap();
                            s = next;
                            if idle.timed_out() && s.fetched.is_none() {
                                renderer.release();
                            }
                        }
                    };
                    let Ok(jpeg) = renderer.render(&packet) else {
                        continue;
                    };
                    let thumbnail = Arc::new(Thumbnail {
                        time_ms: keyframes.entries[index].time_ms,
                        width: renderer.width(),
                        height: renderer.height(),
                        jpeg,
                    });
                    {
                        let mut s = shared.state.lock().unwrap();
                        if s.cache.insert(index, thumbnail.clone()).is_none() {
                            s.order.push_back(index);
                            while s.order.len() > capacity {
                                let old = s.order.pop_front().unwrap();
                                s.cache.remove(&old);
                            }
                        }
                    }
                    shared.wake.notify_all();
                    ready(thumbnail);
                }
            });
        }
        Ok(Session { shared, keyframes })
    }

    pub fn keyframes(&self) -> &Keyframes {
        &self.keyframes
    }

    /// The thumbnail for `ms` if it was made before; otherwise it is made and passed to `ready`.
    pub fn want(&self, ms: u64) -> Option<Arc<Thumbnail>> {
        let index = self.keyframes.at(ms);
        let mut s = self.shared.state.lock().unwrap();
        if let Some(t) = s.cache.get(&index) {
            return Some(t.clone());
        }
        s.wanted = Some(index);
        self.shared.wake.notify_all();
        None
    }
}

/// The threads stop after the read or render they are in, without holding up the caller.
impl Drop for Session {
    fn drop(&mut self) {
        self.shared.state.lock().unwrap().closed = true;
        self.shared.wake.notify_all();
    }
}

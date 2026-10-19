//! Seek-bar thumbnails, made outside mpv from the file the page names.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use aiostreams_container::Options;
use aiostreams_thumbs::{Event, Settings, Thumbnail, Thumbnails};

use crate::bridge::Outbound;
use crate::player::Emit;

const PATH: &str = "/thumbnail/";
const KEPT: usize = 256;

/// The page loads each thumbnail from a path rather than taking its bytes in a message.
#[derive(Default)]
struct Images {
    by_key: HashMap<String, Arc<Thumbnail>>,
    order: VecDeque<String>,
}

static IMAGES: LazyLock<Mutex<Images>> = LazyLock::new(Mutex::default);
static FILES: AtomicU64 = AtomicU64::new(0);

/// The JPEG at a `/thumbnail/<key>.jpg` path the page was sent.
pub fn image(path: &str) -> Option<Vec<u8>> {
    let key = path.strip_prefix(PATH)?.strip_suffix(".jpg")?;
    IMAGES.lock().ok()?.by_key.get(key).map(|t| t.jpeg.clone())
}

fn keep(key: String, thumbnail: Arc<Thumbnail>) {
    let Ok(mut images) = IMAGES.lock() else {
        return;
    };
    if images.by_key.insert(key.clone(), thumbnail).is_none() {
        images.order.push_back(key);
        while images.order.len() > KEPT {
            if let Some(old) = images.order.pop_front() {
                images.by_key.remove(&old);
            }
        }
    }
}

/// One file's thumbnails at a time.
pub struct Previews {
    current: Mutex<Option<(String, Thumbnails)>>,
    emit: Emit,
}

impl Previews {
    pub fn new(emit: Emit) -> Self {
        Self {
            current: Mutex::default(),
            emit,
        }
    }

    pub fn want(
        &self,
        url: &str,
        headers: &BTreeMap<String, String>,
        position_ms: Option<f64>,
        showing_ms: Option<f64>,
    ) {
        let Ok(mut current) = self.current.lock() else {
            return;
        };
        if current.as_ref().is_none_or(|(open, _)| open != url) {
            let options = Options {
                headers: headers.clone().into_iter().collect(),
                timeout: Duration::from_secs(10),
                connect_timeout: Duration::from_secs(5),
                ..Options::default()
            };
            let file = FILES.fetch_add(1, Ordering::Relaxed);
            let (emit, named) = (self.emit.clone(), url.to_owned());
            let on = move |event| {
                let (position_ms, src) = match event {
                    Event::Thumbnail(t) => {
                        let key = format!("{file}-{}", t.time_ms);
                        let (at, src) = (t.time_ms, format!("{PATH}{key}.jpg"));
                        keep(key, t);
                        (Some(at), Some(src))
                    }
                    Event::Unavailable(e) => {
                        log::info!("no thumbnails: {e}");
                        (None, None)
                    }
                };
                emit(Outbound::PlayerThumbnail {
                    url: named.clone(),
                    position_ms,
                    src,
                });
            };
            let thumbnails = Thumbnails::new(url, options, Settings::default(), on);
            *current = Some((url.to_owned(), thumbnails));
        }
        if let Some((_, thumbnails)) = current.as_ref() {
            match position_ms {
                Some(ms) => thumbnails.want(ms.max(0.0) as u64, showing_ms.map(|s| s as u64)),
                None => thumbnails.prepare(),
            }
        }
    }

    pub fn clear(&self) {
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
    }
}

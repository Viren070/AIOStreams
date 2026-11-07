//! Lines for the app's log, which problem reports read.

use std::borrow::Cow;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use log::Level;

/// What FFmpeg and mpv say on every load of some files, which tells of nothing wrong.
const HARMLESS: &[&str] = &[
    "Disabling http_persistent",
    "Disabling http_multiple",
    "mime type is not rfc8216 compliant",
];

/// mpv's warnings and errors, with a few of each kind a minute let through and
/// the rest counted, as a broken stream can print one per frame. Lines
/// differing only in numbers are of a kind.
#[derive(Default)]
pub struct MpvLog {
    kinds: HashMap<String, Kind>,
}

struct Kind {
    since: Instant,
    level: Level,
    last: String,
    seen: u32,
}

impl MpvLog {
    const KEEP: u32 = 3;
    const WINDOW: Duration = Duration::from_secs(60);
    const MAX_KINDS: usize = 64;

    pub fn push(&mut self, level: &str, prefix: &str, text: &str) {
        let text = text.trim_end();
        if text.is_empty() || HARMLESS.iter().any(|h| text.contains(h)) {
            return;
        }
        let level = if matches!(level, "error" | "fatal") {
            Level::Error
        } else {
            Level::Warn
        };
        let line = format!("[{prefix}] {text}");
        let now = Instant::now();
        let shape = shape(&line);
        if let Some(kind) = self.kinds.get_mut(&shape)
            && now.duration_since(kind.since) < Self::WINDOW
        {
            kind.seen += 1;
            if kind.seen <= Self::KEEP {
                log::log!(target: "mpv", level, "{line}");
            }
            kind.last = line;
            return;
        }
        if let Some(kind) = self.kinds.remove(&shape) {
            kind.held();
        }
        if self.kinds.len() >= Self::MAX_KINDS
            && let Some(oldest) = self
                .kinds
                .iter()
                .min_by_key(|(_, k)| k.since)
                .map(|(shape, _)| shape.clone())
            && let Some(kind) = self.kinds.remove(&oldest)
        {
            kind.held();
        }
        log::log!(target: "mpv", level, "{line}");
        self.kinds.insert(
            shape,
            Kind {
                since: now,
                level,
                last: line,
                seen: 1,
            },
        );
    }

    /// Writes the counts still held back, as a file ends.
    pub fn flush(&mut self) {
        for (_, kind) in self.kinds.drain() {
            kind.held();
        }
    }
}

impl Kind {
    fn held(&self) {
        if self.seen > MpvLog::KEEP {
            let more = self.seen - MpvLog::KEEP;
            log::log!(target: "mpv", self.level, "{more} more like: {}", self.last);
        }
    }
}

fn shape(line: &str) -> String {
    let mut shape = String::with_capacity(line.len());
    let mut digits = false;
    for c in line.chars() {
        if c.is_ascii_digit() {
            if !digits {
                shape.push('#');
            }
            digits = true;
        } else {
            shape.push(c);
            digits = false;
        }
    }
    shape
}

/// `text` with its links' logins masked: an address's user, an Xtream login's path, secret
/// query values, and long encoded parts, which addons fill with their settings, keys among them.
pub fn mask_links(text: &str) -> Cow<'_, str> {
    let Some(mut start) = next_link(text) else {
        return Cow::Borrowed(text);
    };
    let mut masked = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        masked.push_str(&rest[..start]);
        let link = &rest[start..];
        let end = link
            .find(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | '<' | '>'))
            .unwrap_or(link.len());
        masked.push_str(&mask_link(&link[..end]));
        rest = &link[end..];
        match next_link(rest) {
            Some(next) => start = next,
            None => break,
        }
    }
    masked.push_str(rest);
    Cow::Owned(masked)
}

fn next_link(text: &str) -> Option<usize> {
    match (text.find("http://"), text.find("https://")) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn mask_link(link: &str) -> String {
    let Ok(mut url) = url::Url::parse(link) else {
        return link.into();
    };
    if !matches!(url.scheme(), "http" | "https") {
        return link.into();
    }
    if !url.username().is_empty() || url.password().is_some() {
        let _ = url.set_password(None);
        let _ = url.set_username("***");
    }
    let path = url
        .path_segments()
        .map(|segments| masked_path(&segments.collect::<Vec<_>>()));
    if let Some(path) = path {
        url.set_path(&path);
    }
    if url.query_pairs().any(|(key, _)| secret(&key)) {
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(key, value)| {
                let value = if secret(&key) {
                    "***".into()
                } else {
                    value.into_owned()
                };
                (key.into_owned(), value)
            })
            .collect();
        url.query_pairs_mut().clear().extend_pairs(pairs);
    }
    url.into()
}

fn masked_path(segments: &[&str]) -> String {
    const XTREAM: &[&str] = &["live", "movie", "series", "timeshift", "hls"];
    let mut login = 0;
    let mut masked = Vec::with_capacity(segments.len());
    for (i, segment) in segments.iter().enumerate() {
        let hidden = login > 0 || encoded(segment);
        masked.push(if hidden { "***" } else { segment });
        login = if login > 0 {
            login - 1
        } else if i + 3 < segments.len() && XTREAM.iter().any(|x| segment.eq_ignore_ascii_case(x)) {
            2
        } else {
            0
        };
    }
    format!("/{}", masked.join("/"))
}

fn encoded(segment: &str) -> bool {
    segment.len() >= 32
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_%=+-".contains(&b))
}

fn secret(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["pass", "token", "apikey", "api_key", "key", "auth"]
        .iter()
        .any(|s| key.starts_with(s))
}

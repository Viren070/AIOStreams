//! `aiostreams://` links, passed to the page as they arrived: the page decodes
//! each value once, so nothing here decodes them.

pub const SCHEME: &str = "aiostreams";

const MAX_LEN: usize = 8192;

pub fn accept(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let scheme = raw.split_once(':')?.0;
    (raw.len() <= MAX_LEN && scheme.eq_ignore_ascii_case(SCHEME)).then(|| raw.to_owned())
}

/// Links wait here until the page says it can take them, which it says again after each load.
#[derive(Default)]
pub struct Inbox {
    pending: Vec<String>,
    ready: bool,
}

impl Inbox {
    /// Returns the link when the page can take it now.
    pub fn receive(&mut self, link: String) -> Option<String> {
        if self.ready {
            return Some(link);
        }
        self.pending.push(link);
        None
    }

    pub fn ready(&mut self) -> Vec<String> {
        self.ready = true;
        std::mem::take(&mut self.pending)
    }

    pub fn page_loading(&mut self) {
        self.ready = false;
    }
}

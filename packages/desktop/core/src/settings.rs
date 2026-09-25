use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// A Jellyfin base; the web app is at `<server>/web`.
    pub server: Option<String>,
}

const FILE: &str = "settings.json";

pub fn load(dir: &Path) -> Settings {
    fs::read_to_string(dir.join(FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, settings: &Settings) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(dir.join(FILE), serde_json::to_string_pretty(settings)?)
}

/// Accepts what a user would paste: a bare host, the web app's address, or a
/// Jellyfin base. A bare host means AIOStreams' own `/jellyfin` mount.
pub fn normalize_server(input: &str) -> Result<String, String> {
    let input = input.trim();
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("http://{input}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|e| format!("not a valid address: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("the address must start with http:// or https://".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/index.html", "/web"] {
        if let Some(rest) = path.strip_suffix(suffix) {
            path = rest.to_string();
        }
    }
    if path.is_empty() {
        path = "/jellyfin".into();
    }
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

pub fn origin(server: &str) -> Option<String> {
    Url::parse(server)
        .ok()
        .map(|u| u.origin().ascii_serialization())
}

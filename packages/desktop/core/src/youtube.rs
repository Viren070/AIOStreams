//! A YouTube video's stream, asked of its player API as YouTube's apps ask. The
//! links only play from the address that asked, so the app resolves them itself.

use std::time::Duration;

use serde_json::{Map, Value, json};

struct Client {
    name: &'static str,
    id: &'static str,
    version: &'static str,
    user_agent: &'static str,
    key: Option<&'static str>,
    fields: &'static [(&'static str, &'static str)],
    /// An HLS playlist of every size, where the muxed formats stop at 360p.
    hls: bool,
}

const CLIENTS: &[Client] = &[
    Client {
        name: "VISIONOS",
        id: "101",
        version: "1.02",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        key: None,
        fields: &[
            ("deviceMake", "Apple"),
            ("deviceModel", "RealityDevice17,1"),
            ("osName", "visionOS"),
            ("osVersion", "26.5.23O471"),
        ],
        hls: true,
    },
    Client {
        name: "ANDROID",
        id: "3",
        version: "20.10.41",
        user_agent: "com.google.android.youtube/20.10.41 (Linux; U; Android 11) gzip",
        key: Some("AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"),
        fields: &[
            ("deviceMake", "Google"),
            ("deviceModel", "Pixel 5"),
            ("osName", "Android"),
            ("osVersion", "11"),
            ("androidSdkVersion", "30"),
            ("platform", "MOBILE"),
        ],
        hls: false,
    },
];

pub fn resolve(video_id: &str) -> Option<String> {
    let valid = video_id.len() == 11
        && video_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid {
        return None;
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    CLIENTS
        .iter()
        .find_map(|client| match ask(&agent, client, video_id) {
            Ok(url) => url,
            Err(e) => {
                log::warn!("youtube {}: {e}", client.name);
                None
            }
        })
}

fn ask(agent: &ureq::Agent, client: &Client, video_id: &str) -> Result<Option<String>, String> {
    let mut visitor: Option<String> = None;
    for _ in 0..2 {
        let answer = player(agent, client, video_id, visitor.as_deref())?;
        if answer["playabilityStatus"]["status"] == "OK" {
            let streaming = &answer["streamingData"];
            return Ok(if client.hls {
                streaming["hlsManifestUrl"].as_str().map(String::from)
            } else {
                streaming["formats"]
                    .as_array()
                    .and_then(|formats| formats.iter().find_map(|f| f["url"].as_str()))
                    .map(String::from)
            });
        }
        // Without a visitor id YouTube refuses, but hands one out for the next ask.
        match answer["responseContext"]["visitorData"].as_str() {
            Some(id) => visitor = Some(id.to_string()),
            None => return Ok(None),
        }
    }
    Ok(None)
}

fn player(
    agent: &ureq::Agent,
    client: &Client,
    video_id: &str,
    visitor: Option<&str>,
) -> Result<Value, String> {
    let mut fields = Map::new();
    fields.insert("clientName".into(), client.name.into());
    fields.insert("clientVersion".into(), client.version.into());
    fields.insert("hl".into(), "en".into());
    fields.insert("gl".into(), "US".into());
    if let Some(id) = visitor {
        fields.insert("visitorData".into(), id.into());
    }
    for (name, value) in client.fields {
        fields.insert((*name).into(), (*value).into());
    }
    let body = json!({
        "videoId": video_id,
        "context": { "client": fields },
        "contentCheckOk": true,
        "racyCheckOk": true,
    });
    let key = client.key.map(|k| format!("key={k}&")).unwrap_or_default();
    let mut request = agent
        .post(format!(
            "https://www.youtube.com/youtubei/v1/player?{key}prettyPrint=false"
        ))
        .header("Content-Type", "application/json")
        .header("User-Agent", client.user_agent)
        .header("Origin", "https://www.youtube.com")
        .header("Referer", "https://www.youtube.com/")
        .header("X-YouTube-Client-Name", client.id)
        .header("X-YouTube-Client-Version", client.version);
    if let Some(id) = visitor {
        request = request.header("X-Goog-Visitor-Id", id);
    }
    let mut response = request.send(body.to_string()).map_err(|e| e.to_string())?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

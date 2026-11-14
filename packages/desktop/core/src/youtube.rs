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

pub struct Stream {
    pub url: String,
    pub original_language: Option<String>,
    /// What mpv plays for `url`, which FFmpeg would open every variant of before playing.
    pub playable: Option<String>,
}

pub fn resolve(video_id: &str) -> Option<Stream> {
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

fn ask(agent: &ureq::Agent, client: &Client, video_id: &str) -> Result<Option<Stream>, String> {
    let mut visitor: Option<String> = None;
    for _ in 0..2 {
        let answer = player(agent, client, video_id, visitor.as_deref())?;
        if answer["playabilityStatus"]["status"] == "OK" {
            let streaming = &answer["streamingData"];
            let url = if client.hls {
                streaming["hlsManifestUrl"].as_str()
            } else {
                streaming["formats"]
                    .as_array()
                    .and_then(|formats| formats.iter().find_map(|f| f["url"].as_str()))
            };
            let original = original_audio(streaming);
            return Ok(url.map(|url| Stream {
                url: url.to_string(),
                original_language: original
                    .and_then(|id| id.split('.').next())
                    .map(String::from),
                playable: client.hls.then(|| playable(agent, url, original)).flatten(),
            }));
        }
        // Without a visitor id YouTube refuses, but hands one out for the next ask.
        match answer["responseContext"]["visitorData"].as_str() {
            Some(id) => visitor = Some(id.to_string()),
            None => return Ok(None),
        }
    }
    Ok(None)
}

/// The original audio's id, such as `en-US.4`, which a manifest with dubs doesn't mark.
fn original_audio(streaming: &Value) -> Option<&str> {
    streaming["adaptiveFormats"]
        .as_array()?
        .iter()
        .map(|format| &format["audioTrack"])
        .find(|track| track["audioIsDefault"] == true)?["id"]
        .as_str()
}

fn playable(agent: &ureq::Agent, url: &str, original: Option<&str>) -> Option<String> {
    let master = agent
        .get(url)
        .call()
        .and_then(|mut response| response.body_mut().read_to_string())
        .inspect_err(|e| log::warn!("youtube playlist: {e}"))
        .ok()?;
    one_variant(&master, original)
}

type Attributes<'a> = Vec<(&'a str, &'a str)>;

fn attributes(mut list: &str) -> Attributes<'_> {
    let mut all = Vec::new();
    while let Some((name, rest)) = list.split_once('=') {
        let (value, rest) = match rest.strip_prefix('"') {
            Some(quoted) => quoted.split_once('"').unwrap_or((quoted, "")),
            None => rest.split_once(',').unwrap_or((rest, "")),
        };
        all.push((name, value));
        list = rest.strip_prefix(',').unwrap_or(rest);
    }
    all
}

fn get<'a>(attributes: &Attributes<'a>, name: &str) -> Option<&'a str> {
    attributes.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
}

fn edl_value(value: &str) -> String {
    format!("%{}%{value}", value.len())
}

/// The largest H.264 variant of `master` with its group's audio as an EDL, each
/// audio opened only once mpv picks it by language.
fn one_variant(master: &str, original: Option<&str>) -> Option<String> {
    let mut audio = Vec::new();
    let mut best: Option<((u32, u64), Attributes, &str)> = None;
    let mut lines = master.lines();
    while let Some(line) = lines.next() {
        if let Some(list) = line.strip_prefix("#EXT-X-MEDIA:") {
            let media = attributes(list);
            if get(&media, "TYPE") == Some("AUDIO") {
                audio.push(media);
            }
        } else if let Some(list) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let variant = attributes(list);
            let uri = lines.next()?.trim();
            let height = get(&variant, "RESOLUTION")
                .and_then(|r| r.split_once('x')?.1.parse().ok())
                .unwrap_or(0);
            let bandwidth = get(&variant, "BANDWIDTH")
                .and_then(|b| b.parse().ok())
                .unwrap_or(0);
            let h264 = get(&variant, "CODECS").is_some_and(|c| c.starts_with("avc1"));
            if h264
                && best
                    .as_ref()
                    .is_none_or(|(size, ..)| (height, bandwidth) > *size)
            {
                best = Some(((height, bandwidth), variant, uri));
            }
        }
    }
    let (_, variant, uri) = best?;
    let Some(group) = get(&variant, "AUDIO") else {
        return Some(uri.to_string());
    };
    if !get(&variant, "CODECS")?.contains("mp4a") {
        return None;
    }
    let mut tracks: Vec<_> = audio
        .iter()
        .filter(|media| get(media, "GROUP-ID") == Some(group) && get(media, "URI").is_some())
        .collect();
    if let Some(original) = original {
        tracks.sort_by_key(|media| get(media, "YT-EXT-AUDIO-CONTENT-ID") != Some(original));
    }
    if tracks.is_empty() {
        return None;
    }
    let mut edl = format!("edl://{}", edl_value(uri));
    for media in tracks {
        edl.push_str(";!new_stream;!no_clip;!delay_open,media_type=audio,codec=aac");
        let meta: Vec<_> = [("lang", "LANGUAGE"), ("title", "NAME")]
            .into_iter()
            .filter_map(|(key, name)| Some(format!("{key}={}", edl_value(get(media, name)?))))
            .collect();
        if !meta.is_empty() {
            edl.push_str(&format!(";!track_meta,{}", meta.join(",")));
        }
        edl.push_str(&format!(";{}", edl_value(get(media, "URI")?)));
    }
    Some(edl)
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

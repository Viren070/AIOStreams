use std::time::{Duration, Instant};

use crate::mkv::Segment;
use crate::{Options, RangeReader, Result, TrackKind};

/// How long a line whose index entry has no duration shows, at most, before the next.
const UNTIMED_MS: u64 = 4_000;

/// A few requests for the head, the tracks and the index, or the players' own reading takes over.
pub fn index_options() -> Options {
    Options {
        timeout: Duration::from_secs(4),
        connect_timeout: Duration::from_secs(3),
        max_bytes: Some(24 << 20),
        max_requests: Some(16),
        deadline: Some(Instant::now() + Duration::from_secs(7)),
        ..Options::default()
    }
}

/// One of the file's subtitle tracks and when its lines show, in milliseconds.
#[derive(Debug, Clone)]
pub struct SubtitleTimeline {
    pub number: u64,
    pub codec: String,
    pub language: Option<String>,
    pub lines: Vec<(u64, u64)>,
}

/// Every subtitle track of a Matroska file in file order, with the lines its Cues index lists.
/// Muxers index every subtitle frame with its duration; a track they didn't index comes back empty.
pub fn subtitle_timelines(r: &mut RangeReader) -> Result<Vec<SubtitleTimeline>> {
    let segment = Segment::open(r)?;
    let mut tracks: Vec<SubtitleTimeline> = segment
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Subtitle)
        .map(|t| SubtitleTimeline {
            number: t.number,
            codec: t.codec.clone(),
            language: t.language.clone(),
            lines: Vec::new(),
        })
        .collect();
    if tracks.is_empty() {
        return Ok(tracks);
    }
    let cues = segment.cues(r)?;
    for track in &mut tracks {
        let mut points: Vec<_> = cues.iter().filter(|c| c.track == track.number).collect();
        points.sort_by_key(|c| c.time);
        points.dedup_by_key(|c| c.time);
        for (i, cue) in points.iter().enumerate() {
            let start = segment.ms(cue.time);
            let end = match cue.duration {
                Some(duration) => segment.ms(cue.time + duration),
                None => {
                    let next = points.get(i + 1).map_or(u64::MAX, |n| segment.ms(n.time));
                    (start + UNTIMED_MS).min(next)
                }
            };
            if end > start {
                track.lines.push((start, end));
            }
        }
    }
    Ok(tracks)
}

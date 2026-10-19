pub mod codec;
pub mod decode;
pub mod hevc;
pub mod pool;
pub mod priority;
pub mod scale;

use aiostreams_container::{Keyframes, Options, RangeReader};

#[derive(Debug)]
pub enum Error {
    Container(aiostreams_container::Error),
    Decode(String),
}

impl From<aiostreams_container::Error> for Error {
    fn from(e: aiostreams_container::Error) -> Self {
        Error::Container(e)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Error::Container(e) => e.fmt(f),
            Error::Decode(e) => write!(f, "decode: {e}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub struct Settings {
    pub width: usize,
    /// Decoders for the strips of a split picture, and slice threads otherwise.
    pub workers: usize,
    pub samples: usize,
    pub quality: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            width: 320,
            workers: 2,
            samples: 2,
            quality: 75,
        }
    }
}

pub struct Thumbnail {
    pub time_ms: u64,
    pub width: usize,
    pub height: usize,
    pub jpeg: Vec<u8>,
}

/// Thumbnails of one file, a keyframe each. Blocking; call `priority::background` on its thread.
pub struct Thumbnailer {
    reader: RangeReader,
    keyframes: Keyframes,
    kind: codec::Kind,
    config: codec::Config,
    settings: Settings,
    height: usize,
    guess: u64,
    decoder: Option<decode::Decoder>,
    strips: Option<pool::Pool>,
}

fn known(code: i32, fallback: u64) -> i32 {
    if code != 0 && code != 2 {
        code
    } else {
        fallback as i32
    }
}

impl Thumbnailer {
    pub fn open(url: &str, options: Options, settings: Settings) -> Result<Thumbnailer> {
        let mut reader = RangeReader::new(url, options)?;
        let keyframes = aiostreams_container::keyframes(&mut reader)?;
        let track = &keyframes.track;
        let kind = codec::Kind::from_codec_id(&track.codec)
            .ok_or_else(|| Error::Decode(format!("codec {}", track.codec)))?;
        let config = codec::Config::new(kind, &track.private).map_err(Error::Decode)?;
        let video = track
            .video
            .as_ref()
            .ok_or_else(|| Error::Decode("no video dimensions".into()))?;
        let height = ((settings.width as u64 * video.display_height / video.display_width.max(1))
            as usize)
            .div_ceil(2)
            * 2;
        let byterate = reader.size.unwrap_or(0) / (keyframes.duration_ms / 1000).max(1);
        let guess = (byterate / 12).clamp(96 * 1024, 2 << 20);
        Ok(Thumbnailer {
            reader,
            keyframes,
            kind,
            config,
            settings,
            height,
            guess,
            decoder: None,
            strips: None,
        })
    }

    pub fn keyframes(&self) -> &Keyframes {
        &self.keyframes
    }

    /// The thumbnail of the keyframe at or before `ms`.
    pub fn get(&mut self, ms: u64) -> Result<Thumbnail> {
        let index = self.keyframes.at(ms);
        let frame = self.keyframes.frame(&mut self.reader, index, self.guess)?;
        self.guess = self.guess.max(frame.len() as u64 * 5 / 4);
        let packet = self.config.packet(&frame).map_err(Error::Decode)?;
        let (w, h, s) = (self.settings.width, self.height, self.settings.samples);
        let acc = match (self.kind == codec::Kind::Hevc && self.settings.workers > 1)
            .then(|| hevc::split(&packet))
            .flatten()
        {
            Some(split) => {
                let workers = self.settings.workers;
                let pool = self.strips.get_or_insert_with(|| {
                    pool::Pool::new(workers, codec::Kind::Hevc.decoder(), true)
                });
                pool.run(split, w, h, s).map_err(Error::Decode)?
            }
            None => {
                if self.decoder.is_none() {
                    let options = decode::Options {
                        threads: self.settings.workers as i32,
                        skip_loop_filter: true,
                        fast: false,
                    };
                    self.decoder = Some(
                        decode::Decoder::open(self.kind.decoder(), &options)
                            .map_err(Error::Decode)?,
                    );
                }
                let f = self
                    .decoder
                    .as_mut()
                    .unwrap()
                    .decode(&packet)
                    .map_err(Error::Decode)?;
                scale::Accum::whole(f, w, h, s).map_err(Error::Decode)?
            }
        };
        let video = self.keyframes.track.video.as_ref().unwrap();
        let [m, r, t, p] = acc.signalled.unwrap_or([2, 0, 2, 2]);
        let color = scale::Color::new(
            known(m, video.matrix),
            if r != 0 { r } else { video.range as i32 },
            known(t, video.transfer),
            known(p, video.primaries),
            video.height as i32,
        );
        let jpeg = scale::jpeg(&acc.rgb(&color), w, h, self.settings.quality);
        Ok(Thumbnail {
            time_ms: self.keyframes.entries[index].time_ms,
            width: w,
            height: h,
            jpeg,
        })
    }

    /// Frees the decoders until the next thumbnail.
    pub fn release(&mut self) {
        self.decoder = None;
        self.strips = None;
    }
}

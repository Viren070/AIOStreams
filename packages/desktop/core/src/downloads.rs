//! Downloads the page hands over. Each runs on its own thread, resumes from
//! what is already on disk, and the queue outlives the app.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ureq::ResponseExt;

use crate::bridge::{DownloadJob, DownloadStatus, FileKind, Outbound};

const PROGRESS_EVERY: Duration = Duration::from_millis(500);
/// No timeout bounds a stalled read on its own, so each request ends after
/// this and the next one carries on from what was written.
const REQUEST_LIMIT: Duration = Duration::from_secs(90);
const RETRY_SECONDS: &[u64] = &[2, 5, 15, 30, 60];
const MAX_CONCURRENT: u32 = 4;
const EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "avi", "mov", "webm", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg", "ogv",
    "3gp", "srt", "vtt", "ass", "ssa", "sub", "sup", "idx", "ttml", "jpg", "jpeg", "png", "webp",
    "avif", "json",
];
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum State {
    Queued,
    Downloading,
    Paused,
    Failed,
    Done,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            State::Queued => "queued",
            State::Downloading => "downloading",
            State::Paused => "paused",
            State::Failed => "failed",
            State::Done => "done",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Job {
    #[serde(flatten)]
    spec: DownloadJob,
    /// Where it was saved, as the folder for new downloads can change.
    folder: PathBuf,
    state: State,
    bytes: u64,
    total: Option<u64>,
    error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    folder: Option<PathBuf>,
    concurrent: Option<u32>,
    jobs: Vec<Job>,
}

pub enum Command {
    Add(Vec<DownloadJob>),
    Pause(String),
    Resume(String),
    Retry(String),
    Remove { id: String, files: bool },
    List,
    SetFolder(PathBuf),
    SetConcurrent(u32),
}

enum Failure {
    Stopped,
    Error(String),
}

enum Event {
    Command(Command),
    Progress {
        id: String,
        bytes: u64,
        total: Option<u64>,
    },
    Finished {
        id: String,
        result: Result<(), Failure>,
    },
}

/// What playback and the file manager need, readable without the queue's thread.
#[derive(Default)]
struct Shared {
    folder: PathBuf,
    jobs: HashMap<String, Placed>,
}

struct Placed {
    done: bool,
    video: Option<PathBuf>,
    subtitles: Vec<PathBuf>,
}

pub struct Downloads {
    events: Sender<Event>,
    shared: Arc<Mutex<Shared>>,
}

impl Downloads {
    /// `emit` is called on the queue's own thread.
    pub fn start(
        state_file: PathBuf,
        default_folder: PathBuf,
        emit: impl Fn(Outbound) + Send + 'static,
    ) -> Downloads {
        let saved: Saved = fs::read(&state_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let (events, received) = mpsc::channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let mut queue = Queue {
            folder: saved.folder.unwrap_or(default_folder),
            concurrent: saved.concurrent.unwrap_or(2).clamp(1, MAX_CONCURRENT),
            jobs: saved.jobs,
            running: HashMap::new(),
            removing: HashMap::new(),
            speeds: HashMap::new(),
            events: events.clone(),
            emit: Box::new(emit),
            state_file,
            shared: shared.clone(),
            agent: agent(),
        };
        for job in &mut queue.jobs {
            if job.state == State::Downloading {
                job.state = State::Queued;
            }
        }
        thread::Builder::new()
            .name("downloads".into())
            .spawn(move || queue.run(received))
            .expect("could not start the downloads thread");
        let downloads = Downloads { events, shared };
        downloads.send(Command::List);
        downloads
    }

    pub fn send(&self, command: Command) {
        let _ = self.events.send(Event::Command(command));
    }

    pub fn folder(&self) -> PathBuf {
        self.shared
            .lock()
            .map(|s| s.folder.clone())
            .unwrap_or_default()
    }

    pub fn job_folder(&self, id: &str) -> Option<PathBuf> {
        let shared = self.shared.lock().ok()?;
        shared
            .jobs
            .get(id)?
            .video
            .as_ref()?
            .parent()
            .map(Path::to_path_buf)
    }

    /// `download:<id>` is a finished download's video, `download:<id>/<n>` its nth subtitle.
    pub fn local_file(&self, reference: &str) -> Option<PathBuf> {
        let rest = reference.strip_prefix("download:")?;
        let (id, index) = match rest.split_once('/') {
            Some((id, n)) => (id, Some(n.parse::<usize>().ok()?)),
            None => (rest, None),
        };
        let shared = self.shared.lock().ok()?;
        let placed = shared.jobs.get(id).filter(|p| p.done)?;
        match index {
            None => placed.video.clone(),
            Some(n) => placed.subtitles.get(n).cloned(),
        }
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_LIMIT))
        .timeout_connect(Some(Duration::from_secs(20)))
        .user_agent(concat!("AIOStreams Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

struct Speed {
    since: Instant,
    from: u64,
    value: u64,
}

struct Queue {
    folder: PathBuf,
    concurrent: u32,
    jobs: Vec<Job>,
    running: HashMap<String, Arc<AtomicBool>>,
    /// Removed while running: its files go once its thread lets go of them.
    removing: HashMap<String, Job>,
    speeds: HashMap<String, Speed>,
    events: Sender<Event>,
    emit: Box<dyn Fn(Outbound) + Send>,
    state_file: PathBuf,
    shared: Arc<Mutex<Shared>>,
    agent: ureq::Agent,
}

impl Queue {
    fn run(mut self, received: Receiver<Event>) {
        let mut last_progress = Instant::now();
        loop {
            match received.recv_timeout(PROGRESS_EVERY) {
                Ok(Event::Command(command)) => self.command(command),
                Ok(Event::Progress { id, bytes, total }) => {
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.spec.id == id) {
                        job.bytes = bytes;
                        job.total = total.or(job.total);
                    }
                }
                Ok(Event::Finished { id, result }) => self.finished(&id, result),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if last_progress.elapsed() >= PROGRESS_EVERY {
                last_progress = Instant::now();
                self.report_progress();
            }
        }
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Add(jobs) => {
                for spec in jobs {
                    if self.jobs.iter().any(|j| j.spec.id == spec.id) {
                        continue;
                    }
                    if let Err(e) = check(&spec) {
                        log::warn!("download {}: {e}", spec.id);
                        (self.emit)(Outbound::Error {
                            message: format!("Can't download {}: {e}", spec.title),
                        });
                        continue;
                    }
                    log::info!("download added id={} title={}", spec.id, spec.title);
                    self.jobs.push(Job {
                        spec,
                        folder: self.folder.clone(),
                        state: State::Queued,
                        bytes: 0,
                        total: None,
                        error: None,
                    });
                }
            }
            Command::Pause(id) => {
                if let Some(stop) = self.running.get(&id) {
                    stop.store(true, Ordering::Relaxed);
                }
                self.set_state(&id, |s| s != State::Done, State::Paused);
            }
            Command::Resume(id) => self.set_state(&id, |s| s == State::Paused, State::Queued),
            Command::Retry(id) => self.set_state(&id, |s| s == State::Failed, State::Queued),
            Command::Remove { id, files } => {
                let Some(at) = self.jobs.iter().position(|j| j.spec.id == id) else {
                    return;
                };
                let job = self.jobs.remove(at);
                if let Some(stop) = self.running.get(&id) {
                    stop.store(true, Ordering::Relaxed);
                    if files {
                        self.removing.insert(id, job);
                    }
                } else if files {
                    self.delete_files(&job);
                }
            }
            Command::List => {}
            Command::SetFolder(folder) => {
                log::info!("download folder={}", folder.display());
                self.folder = folder;
            }
            Command::SetConcurrent(n) => self.concurrent = n.clamp(1, MAX_CONCURRENT),
        }
        self.changed();
    }

    fn set_state(&mut self, id: &str, when: impl Fn(State) -> bool, state: State) {
        if let Some(job) = self
            .jobs
            .iter_mut()
            .find(|j| j.spec.id == id && when(j.state))
        {
            job.state = state;
            job.error = None;
        }
    }

    fn finished(&mut self, id: &str, result: Result<(), Failure>) {
        self.running.remove(id);
        self.speeds.remove(id);
        if let Some(job) = self.removing.remove(id) {
            self.delete_files(&job);
        }
        if let Some(job) = self.jobs.iter_mut().find(|j| j.spec.id == id) {
            match result {
                Ok(()) => {
                    log::info!("download done id={id}");
                    job.state = State::Done;
                    job.total = job.total.or(Some(job.bytes));
                    job.bytes = job.total.unwrap_or(job.bytes);
                }
                // Paused or removed, which the command already recorded.
                Err(Failure::Stopped) => {}
                Err(Failure::Error(e)) => {
                    log::warn!("download failed id={id}: {e}");
                    job.state = State::Failed;
                    job.error = Some(e);
                }
            }
        }
        self.changed();
    }

    /// Starts what fits, saves the queue and tells the page.
    fn changed(&mut self) {
        let free = (self.concurrent as usize).saturating_sub(self.running.len());
        let next: Vec<usize> = self
            .jobs
            .iter()
            .enumerate()
            .filter(|(_, j)| j.state == State::Queued && !self.running.contains_key(&j.spec.id))
            .map(|(i, _)| i)
            .take(free)
            .collect();
        for i in next {
            let job = &mut self.jobs[i];
            job.state = State::Downloading;
            let stop = Arc::new(AtomicBool::new(false));
            self.running.insert(job.spec.id.clone(), stop.clone());
            let (spec, folder, events, agent) = (
                job.spec.clone(),
                job.folder.clone(),
                self.events.clone(),
                self.agent.clone(),
            );
            let _ = thread::Builder::new()
                .name("download".into())
                .spawn(move || work(spec, folder, agent, stop, events));
        }
        self.save();
        self.share();
        (self.emit)(Outbound::DownloadState {
            folder: self.folder.to_string_lossy().into_owned(),
            jobs: self
                .jobs
                .iter()
                .map(|j| DownloadStatus {
                    id: j.spec.id.clone(),
                    state: j.state.name(),
                    bytes: j.bytes,
                    total: j.total,
                    error: j.error.clone(),
                })
                .collect(),
        });
    }

    fn report_progress(&mut self) {
        let now = Instant::now();
        for job in self.jobs.iter().filter(|j| j.state == State::Downloading) {
            let speed = self.speeds.entry(job.spec.id.clone()).or_insert(Speed {
                since: now,
                from: job.bytes,
                value: 0,
            });
            // Measured over a few seconds, so the number holds still enough to read.
            let elapsed = now.duration_since(speed.since).as_secs_f64();
            if elapsed >= 2.0 {
                speed.value = (job.bytes.saturating_sub(speed.from) as f64 / elapsed) as u64;
                speed.since = now;
                speed.from = job.bytes;
            }
            (self.emit)(Outbound::DownloadProgress {
                id: job.spec.id.clone(),
                bytes: job.bytes,
                total: job.total,
                speed: speed.value,
            });
        }
    }

    fn save(&self) {
        let saved = Saved {
            folder: Some(self.folder.clone()),
            concurrent: Some(self.concurrent),
            jobs: self.jobs.clone(),
        };
        let Ok(bytes) = serde_json::to_vec(&saved) else {
            return;
        };
        let temporary = self.state_file.with_extension("json.tmp");
        if fs::write(&temporary, bytes).is_ok() {
            let _ = fs::rename(&temporary, &self.state_file);
        }
    }

    fn share(&self) {
        let Ok(mut shared) = self.shared.lock() else {
            return;
        };
        shared.folder = self.folder.clone();
        shared.jobs = self
            .jobs
            .iter()
            .map(|job| {
                let of = |kind| {
                    job.spec
                        .files
                        .iter()
                        .filter(move |f| f.kind == kind)
                        .filter_map(|f| place(&job.folder, &f.path).ok())
                };
                (
                    job.spec.id.clone(),
                    Placed {
                        done: job.state == State::Done,
                        video: of(FileKind::Video).next(),
                        subtitles: of(FileKind::Subtitle).collect(),
                    },
                )
            })
            .collect();
    }

    /// Leaves files another download still uses, such as a show's poster.
    fn delete_files(&self, job: &Job) {
        let others: Vec<PathBuf> = self
            .jobs
            .iter()
            .flat_map(|j| {
                let folder = j.folder.clone();
                j.spec
                    .files
                    .iter()
                    .map(|f| f.path.clone())
                    .chain(j.spec.texts.iter().map(|t| t.path.clone()))
                    .filter_map(move |p| place(&folder, &p).ok())
                    .collect::<Vec<_>>()
            })
            .collect();
        let paths = job
            .spec
            .files
            .iter()
            .map(|f| &f.path)
            .chain(job.spec.texts.iter().map(|t| &t.path))
            .filter_map(|p| place(&job.folder, p).ok());
        for path in paths {
            if others.contains(&path) {
                continue;
            }
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(part_of(&path));
            // Empty folders up to the downloads folder go too.
            let mut dir = path.parent();
            while let Some(d) = dir {
                if d == job.folder || fs::remove_dir(d).is_err() {
                    break;
                }
                dir = d.parent();
            }
        }
        log::info!("download files deleted id={}", job.spec.id);
    }
}

fn check(spec: &DownloadJob) -> Result<(), String> {
    let id_ok = !spec.id.is_empty()
        && spec.id.len() <= 64
        && spec
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !id_ok {
        return Err("bad id".into());
    }
    for file in &spec.files {
        if !file.url.starts_with("http://") && !file.url.starts_with("https://") {
            return Err("only http(s) addresses".into());
        }
        place(Path::new("."), &file.path)?;
    }
    for text in &spec.texts {
        place(Path::new("."), &text.path)?;
    }
    Ok(())
}

/// Inside `folder`, a known media, subtitle, image or details file, or nothing.
fn place(folder: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let mut out = folder.to_path_buf();
    let mut parts = 0;
    for component in path.components() {
        let Component::Normal(part) = component else {
            return Err(format!("{relative} is not a relative path"));
        };
        let part = part.to_str().ok_or("not unicode")?;
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let bad = part.is_empty()
            || part.len() > 200
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            || RESERVED.contains(&stem.as_str());
        if bad {
            return Err(format!("{part} is not a usable name"));
        }
        out.push(part);
        parts += 1;
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if parts == 0 || !EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("{relative} is not a media file"));
    }
    Ok(out)
}

fn part_of(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    path.with_file_name(name)
}

fn work(
    spec: DownloadJob,
    folder: PathBuf,
    agent: ureq::Agent,
    stop: Arc<AtomicBool>,
    events: Sender<Event>,
) {
    let result = (|| {
        for text in &spec.texts {
            let path = place(&folder, &text.path).map_err(Failure::Error)?;
            if !path.exists() {
                write_text(&path, &text.text).map_err(Failure::Error)?;
            }
        }
        // Subtitles and art first, so they are there while the video comes.
        let mut files: Vec<_> = spec.files.iter().collect();
        files.sort_by_key(|f| f.kind == FileKind::Video);
        for file in files {
            let path = place(&folder, &file.path).map_err(Failure::Error)?;
            let report = |bytes, total| {
                if file.kind == FileKind::Video {
                    let _ = events.send(Event::Progress {
                        id: spec.id.clone(),
                        bytes,
                        total,
                    });
                }
            };
            match fetch(&agent, &file.url, &path, &stop, report) {
                // Art or a subtitle missing never costs the video.
                Err(Failure::Error(e)) if file.kind != FileKind::Video => {
                    log::warn!("download {}: skipped {}: {e}", spec.id, file.path)
                }
                result => result?,
            }
        }
        Ok(())
    })();
    let _ = events.send(Event::Finished {
        id: spec.id,
        result,
    });
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

/// `bytes a-b/total`, or the length of a whole answer.
fn total_of(response: &ureq::http::Response<ureq::Body>, offset: u64) -> Option<u64> {
    let header = |name| response.headers().get(name)?.to_str().ok();
    if let Some(range) = header("content-range") {
        return range.rsplit('/').next()?.parse().ok();
    }
    header("content-length")?
        .parse::<u64>()
        .ok()
        .map(|n| n + offset)
}

fn fetch(
    agent: &ureq::Agent,
    url: &str,
    path: &Path,
    stop: &AtomicBool,
    report: impl Fn(u64, Option<u64>),
) -> Result<(), Failure> {
    if let Ok(meta) = fs::metadata(path) {
        report(meta.len(), Some(meta.len()));
        return Ok(());
    }
    let fail = |e: std::io::Error| Failure::Error(e.to_string());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(fail)?;
    }
    let part = part_of(path);
    // Later ranges go to where the first request was sent on to; an address
    // that has since expired is asked for again through `url`.
    let mut address = url.to_string();
    let mut failures = 0;
    let mut total = None;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Stopped);
        }
        let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if total.is_some_and(|t| have >= t) {
            return fs::rename(&part, path).map_err(fail);
        }
        let mut request = agent.get(&address);
        if have > 0 {
            request = request.header("Range", format!("bytes={have}-"));
        }
        let error = match request.call() {
            Ok(response) => {
                if response.status() == 200 && have > 0 {
                    have = 0;
                }
                total = total_of(&response, have).or(total);
                address = response.get_uri().to_string();
                let mut file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .append(have > 0)
                    .truncate(have == 0)
                    .open(&part)
                    .map_err(fail)?;
                let mut reader = response.into_body().into_reader();
                let mut buffer = vec![0u8; 256 * 1024];
                let mut written = 0u64;
                let ended = loop {
                    if stop.load(Ordering::Relaxed) {
                        return Err(Failure::Stopped);
                    }
                    match reader.read(&mut buffer) {
                        Ok(0) => break None,
                        Ok(n) => {
                            file.write_all(&buffer[..n]).map_err(fail)?;
                            written += n as u64;
                            report(have + written, total);
                        }
                        Err(e) => break Some(e.to_string()),
                    }
                };
                file.flush().map_err(fail)?;
                let complete = match total {
                    Some(t) => have + written >= t,
                    None => ended.is_none(),
                };
                if complete {
                    return fs::rename(&part, path).map_err(fail);
                }
                if written > 0 {
                    failures = 0;
                    continue;
                }
                ended.unwrap_or_else(|| "the answer ended early".into())
            }
            Err(ureq::Error::StatusCode(416)) if have > 0 => {
                return fs::rename(&part, path).map_err(fail);
            }
            Err(ureq::Error::StatusCode(code @ (401 | 403 | 404 | 410))) if address != url => {
                log::info!("download address expired ({code}), asking again");
                address = url.to_string();
                continue;
            }
            Err(ureq::Error::StatusCode(code)) if code < 500 && code != 429 => {
                return Err(Failure::Error(format!("The server answered {code}")));
            }
            Err(e) => e.to_string(),
        };
        let Some(wait) = RETRY_SECONDS.get(failures) else {
            return Err(Failure::Error(error));
        };
        failures += 1;
        log::info!("download retry in {wait}s: {error}");
        let until = Instant::now() + Duration::from_secs(*wait);
        while Instant::now() < until {
            if stop.load(Ordering::Relaxed) {
                return Err(Failure::Stopped);
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
}

//! Downloads the page hands over. Each runs on its own thread, resumes from
//! what is already on disk, and the queue outlives the app.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, LazyLock, Mutex, TryLockError, Weak};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use unicode_normalization::UnicodeNormalization;
use ureq::ResponseExt;

use crate::bridge::{DownloadJob, DownloadStatus, FileKind, Outbound};
use crate::playback::{is_header_name, is_header_value};

const PROGRESS_EVERY: Duration = Duration::from_millis(500);
/// No timeout bounds a stalled read on its own, so each request ends after
/// this and the next one carries on from what was written.
const REQUEST_LIMIT: Duration = Duration::from_secs(90);
const RETRY_SECONDS: &[u64] = &[2, 5, 15, 30, 60];
const MAX_REDIRECTS: usize = 10;
const MAX_CONCURRENT: u32 = 4;
type DestinationLocks = HashMap<PathBuf, Weak<Mutex<()>>>;
static DESTINATION_LOCKS: LazyLock<Mutex<DestinationLocks>> = LazyLock::new(Mutex::default);
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

#[derive(Default)]
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

    pub fn is_local(&self, path: &str) -> bool {
        let Ok(shared) = self.shared.lock() else {
            return false;
        };
        let path = Path::new(path);
        shared
            .jobs
            .values()
            .filter(|p| p.done)
            .any(|p| p.video.as_deref() == Some(path) || p.subtitles.iter().any(|s| s == path))
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
                        job.total = total;
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
                .map(|j| {
                    let placed = if j.state == State::Done {
                        self.placed(j)
                    } else {
                        Placed::default()
                    };
                    DownloadStatus {
                        id: j.spec.id.clone(),
                        state: j.state.name(),
                        bytes: j.bytes,
                        total: j.total,
                        error: j.error.clone(),
                        video: placed.video.map(|p| p.to_string_lossy().into_owned()),
                        subtitles: placed
                            .subtitles
                            .iter()
                            .map(|p| p.to_string_lossy().into_owned())
                            .collect(),
                    }
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

    fn placed(&self, job: &Job) -> Placed {
        let of = |kind| {
            job.spec
                .files
                .iter()
                .filter(move |f| f.kind == kind)
                .filter_map(|f| place(&job.folder, &f.path).ok())
        };
        Placed {
            done: job.state == State::Done,
            video: of(FileKind::Video).next(),
            subtitles: of(FileKind::Subtitle).collect(),
        }
    }

    fn share(&self) {
        let jobs = self
            .jobs
            .iter()
            .map(|job| (job.spec.id.clone(), self.placed(job)))
            .collect();
        if let Ok(mut shared) = self.shared.lock() {
            shared.folder = self.folder.clone();
            shared.jobs = jobs;
        }
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
        for (name, value) in &file.headers {
            if !is_header_name(name) || !is_header_value(value) {
                return Err(format!("header {name} is not allowed"));
            }
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
            match fetch(&agent, &file.url, &file.headers, &path, &stop, report) {
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

fn response_header<'a>(
    response: &'a ureq::http::Response<ureq::Body>,
    name: &str,
) -> Option<&'a str> {
    response.headers().get(name)?.to_str().ok()
}

fn range_number(value: &str) -> Option<u64> {
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

fn byte_range(value: &str) -> Option<&str> {
    let (unit, range) = value.split_once(' ')?;
    unit.eq_ignore_ascii_case("bytes").then_some(range)
}

/// Returns the number of bytes in this response and the length of the resource, if known.
fn partial_range(range: Option<&str>, offset: u64) -> Option<(u64, Option<u64>)> {
    let (span, total) = byte_range(range?)?.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let start = range_number(start)?;
    let end = range_number(end)?;
    let total = if total == "*" {
        None
    } else {
        Some(range_number(total)?)
    };
    if start != offset || end == u64::MAX || total.is_some_and(|length| end >= length) {
        return None;
    }
    Some((end.checked_sub(start)? + 1, total))
}

fn checked_status(
    response: ureq::http::Response<ureq::Body>,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    let code = response.status().as_u16();
    if code >= 400 && code != 416 {
        return Err(ureq::Error::StatusCode(code));
    }
    Ok(response)
}

/// With headers, follows redirects itself, as ureq drops `Authorization` and `Cookie` on the way.
fn get(
    agent: &ureq::Agent,
    url: &str,
    headers: &BTreeMap<String, String>,
    from: u64,
) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    let mut address = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let mut request = agent.get(&address).header("Accept-Encoding", "identity");
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        if headers.is_empty() {
            return checked_status(
                request
                    .config()
                    .http_status_as_error(false)
                    .build()
                    .call()?,
            );
        }
        for (name, value) in headers {
            if !name.eq_ignore_ascii_case("accept-encoding") && !name.eq_ignore_ascii_case("range")
            {
                request = request.header(name, value);
            }
        }
        let response = checked_status(
            request
                .config()
                .http_status_as_error(false)
                .max_redirects(0)
                .build()
                .call()?,
        )?;
        let location = response.headers().get("location");
        let Some(location) = location.filter(|_| response.status().is_redirection()) else {
            return Ok(response);
        };
        let next = location
            .to_str()
            .ok()
            .and_then(|l| url::Url::parse(&address).ok()?.join(l).ok())
            .ok_or_else(|| ureq::Error::BadUri(format!("{location:?}")))?;
        address = next.into();
    }
    Err(ureq::Error::TooManyRedirects)
}

fn rollback_partial(file: fs::File, path: &Path, length: u64) -> std::io::Result<()> {
    // Windows requires a write handle without append access to set the length.
    drop(file);
    OpenOptions::new().write(true).open(path)?.set_len(length)
}

// Jobs for different episodes can share the same artwork and partial file.
fn destination_lock(path: &Path) -> Arc<Mutex<()>> {
    let key = path
        .parent()
        .zip(path.file_name())
        .and_then(|(parent, name)| fs::canonicalize(parent).ok().map(|dir| dir.join(name)))
        .unwrap_or_else(|| path.to_path_buf());
    // APFS treats canonically equivalent filename spellings as aliases.
    #[cfg(target_os = "macos")]
    let key = PathBuf::from(key.to_string_lossy().nfd().collect::<String>());
    // The file may not exist yet. Use a conservative case-insensitive key on
    // platforms where the destination volume commonly ignores case.
    #[cfg(any(windows, target_os = "macos"))]
    let key = PathBuf::from(key.to_string_lossy().to_uppercase());
    let mut locks = DESTINATION_LOCKS.lock().unwrap();
    locks.retain(|_, lock| lock.strong_count() != 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

fn fetch(
    agent: &ureq::Agent,
    url: &str,
    headers: &BTreeMap<String, String>,
    path: &Path,
    stop: &AtomicBool,
    report: impl Fn(u64, Option<u64>),
) -> Result<(), Failure> {
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::Stopped);
    }
    let fail = |e: std::io::Error| Failure::Error(e.to_string());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(fail)?;
    }
    let lock = destination_lock(path);
    let _destination = loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Stopped);
        }
        match lock.try_lock() {
            Ok(guard) => break guard,
            Err(TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(200)),
            Err(TryLockError::Poisoned(error)) => break error.into_inner(),
        }
    };
    if let Ok(meta) = fs::metadata(path) {
        report(meta.len(), Some(meta.len()));
        return Ok(());
    }
    let part = part_of(path);
    // Later ranges go to where the first request was sent on to; an address
    // that has since expired is asked for again through `url`.
    let mut address = url.to_string();
    let mut failures = 0;
    let mut total = None;
    'download: loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Stopped);
        }
        let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let resumed = have > 0;
        let error = match get(agent, &address, headers, have) {
            Ok(response) => {
                let range = response_header(&response, "content-range");
                let content_length = response_header(&response, "content-length")
                    .and_then(|value| value.parse::<u64>().ok());
                let expected = match response.status().as_u16() {
                    200 => {
                        have = 0;
                        total = content_length;
                        content_length
                    }
                    206 => {
                        let (length, resource_length) =
                            partial_range(range, have).ok_or_else(|| {
                                Failure::Error(
                                    "The server answered with an invalid Content-Range".into(),
                                )
                            })?;
                        if content_length.is_some_and(|value| value != length)
                            || total.is_some_and(|old| {
                                resource_length.is_some_and(|new| old != new) || have + length > old
                            })
                        {
                            return Err(Failure::Error("The range lengths do not match".into()));
                        }
                        total = resource_length.or(total);
                        Some(length)
                    }
                    416 => {
                        let resource_length = range
                            .and_then(byte_range)
                            .and_then(|value| value.strip_prefix("*/"))
                            .and_then(range_number);
                        if have > 0
                            && resource_length == Some(have)
                            && total.is_none_or(|t| t == have)
                        {
                            fs::rename(&part, path).map_err(fail)?;
                            report(have, Some(have));
                            return Ok(());
                        }
                        return Err(Failure::Error(
                            "The server's range total does not match the partial file".into(),
                        ));
                    }
                    code => return Err(Failure::Error(format!("The server answered {code}"))),
                };
                let whole = response.status() == 200;
                address = response.get_uri().to_string();
                let mut file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .append(have > 0)
                    .truncate(have == 0)
                    .open(&part)
                    .map_err(fail)?;
                if resumed && whole {
                    report(0, total);
                }
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
                            if expected.is_some_and(|length| n as u64 > length - written) {
                                rollback_partial(file, &part, have).map_err(fail)?;
                                report(have, total);
                                return Err(Failure::Error(
                                    "The answer exceeds its declared length".into(),
                                ));
                            }
                            file.write_all(&buffer[..n]).map_err(fail)?;
                            written += n as u64;
                            report(have + written, total);
                        }
                        Err(e) => break Some(e.to_string()),
                    }
                };
                file.flush().map_err(fail)?;
                if ended.is_none() && expected.is_some_and(|length| written != length) {
                    rollback_partial(file, &part, have).map_err(fail)?;
                    report(have, total);
                    return Err(Failure::Error(
                        "The answer ended before its declared length".into(),
                    ));
                }
                let complete =
                    ended.is_none() && (total == Some(have + written) || whole && total.is_none());
                if complete {
                    drop(file);
                    fs::rename(&part, path).map_err(fail)?;
                    let size = have + written;
                    report(size, Some(size));
                    return Ok(());
                }
                if written > 0 && (!whole || !resumed) {
                    failures = 0;
                    continue 'download;
                }
                ended.unwrap_or_else(|| "the answer ended early".into())
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

#[cfg(test)]
mod range_tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn fetch_waits_for_the_other_owner_before_checking_the_destination() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let dir = std::env::temp_dir().join(format!(
            "aio-destination-{}-{}",
            std::process::id(),
            listener.local_addr().unwrap().port()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("poster.jpg");
        fs::write(&path, b"poster").unwrap();
        let lock = destination_lock(&path);
        let owner = lock.lock().unwrap();
        let (started, starting) = mpsc::channel();
        let (finished, finishing) = mpsc::channel();
        let worker = thread::spawn(move || {
            started.send(()).unwrap();
            let result = fetch(
                &agent(),
                "",
                &BTreeMap::new(),
                &path,
                &AtomicBool::new(false),
                |bytes, total| {
                    assert_eq!((bytes, total), (6, Some(6)));
                },
            );
            finished.send(result.is_ok()).unwrap();
        });
        starting.recv().unwrap();
        assert_eq!(
            finishing.recv_timeout(Duration::from_millis(250)),
            Err(RecvTimeoutError::Timeout)
        );
        drop(owner);
        assert!(finishing.recv_timeout(Duration::from_secs(5)).unwrap());
        worker.join().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn destination_lock_normalizes_path_aliases() {
        let folder = std::env::temp_dir();
        let lower = destination_lock(&folder.join("poster.jpg"));
        let alias = destination_lock(&folder.join(".").join("poster.jpg"));
        let upper = destination_lock(&folder.join("Poster.jpg"));
        assert!(Arc::ptr_eq(&lower, &alias));
        assert_eq!(
            Arc::ptr_eq(&lower, &upper),
            cfg!(any(windows, target_os = "macos"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn destination_lock_matches_apfs_unicode_aliases() {
        let folder = std::env::temp_dir();
        let composed = destination_lock(&folder.join("caf\u{e9}.jpg"));
        let decomposed = destination_lock(&folder.join("cafe\u{301}.jpg"));
        assert!(Arc::ptr_eq(&composed, &decomposed));
    }

    #[test]
    fn validates_range_offsets_totals_and_body_lengths() {
        let partial = |range, body| ("206 Partial Content", Some(range), None, body);
        let unsatisfied = |range| ("416 Range Not Satisfiable", Some(range), Some(0), "");
        for (case, responses, want) in [
            ("wrong offset", vec![partial("bytes 0-2/6", "def")], None),
            (
                "wrong declared length",
                vec![("206 Partial Content", Some("bytes 3-4/6"), Some(3), "def")],
                None,
            ),
            ("overlong body", vec![partial("bytes 3-4/6", "def")], None),
            ("short body", vec![partial("bytes 3-5/6", "de")], None),
            (
                "wrong unsatisfied total",
                vec![unsatisfied("bytes */4")],
                None,
            ),
            (
                "missing unsatisfied total",
                vec![("416 Range Not Satisfiable", None, Some(0), "")],
                None,
            ),
            (
                "matching unsatisfied total",
                vec![unsatisfied("bytes */3")],
                Some("abc"),
            ),
            (
                "matching unsatisfied total with uppercase range unit",
                vec![unsatisfied("BYTES */3")],
                Some("abc"),
            ),
            (
                "valid range",
                vec![partial("bytes 3-5/6", "def")],
                Some("abcdef"),
            ),
            (
                "valid range with mixed-case range unit",
                vec![partial("Bytes 3-5/6", "def")],
                Some("abcdef"),
            ),
            (
                "unknown range followed by another range",
                vec![partial("bytes 3-4/*", "de"), partial("bytes 5-5/6", "f")],
                Some("abcdef"),
            ),
            (
                "interrupted range resumes at the bytes actually received",
                vec![
                    ("206 Partial Content", Some("bytes 3-5/6"), Some(3), "d"),
                    partial("bytes 4-5/6", "ef"),
                ],
                Some("abcdef"),
            ),
            (
                "range ignored",
                vec![("200 OK", None, Some(3), "def")],
                Some("def"),
            ),
            (
                "unknown-length replacement supersedes the old total",
                vec![
                    partial("bytes 3-4/6", "de"),
                    ("200 OK", None, None, "new file"),
                ],
                Some("new file"),
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let dir = std::env::temp_dir().join(format!(
                "aio-range-{}-{}",
                std::process::id(),
                listener.local_addr().unwrap().port()
            ));
            let path = dir.join("video.mp4");
            fs::create_dir_all(&dir).unwrap();
            fs::write(part_of(&path), b"abc").unwrap();
            let server = thread::spawn(move || {
                let mut offset = 3;
                for (status, range, length, body) in responses {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut request = [0; 4096];
                    let bytes = stream.read(&mut request).unwrap();
                    let request = String::from_utf8_lossy(&request[..bytes]).to_ascii_lowercase();
                    assert!(request.contains(&format!("range: bytes={offset}-")));
                    assert!(request.contains("accept-encoding: identity"));
                    let mut response = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
                    if let Some(range) = range {
                        response.push_str(&format!("Content-Range: {range}\r\n"));
                    }
                    if let Some(length) = length {
                        response.push_str(&format!("Content-Length: {length}\r\n"));
                    }
                    response.push_str("\r\n");
                    response.push_str(body);
                    stream.write_all(response.as_bytes()).unwrap();
                    offset += body.len();
                }
            });
            let first_progress = std::cell::Cell::new(None);
            let progress = std::cell::Cell::new(None);
            let result = fetch(
                &agent(),
                &url,
                &BTreeMap::new(),
                &path,
                &AtomicBool::new(false),
                |bytes, total| {
                    if first_progress.get().is_none() {
                        first_progress.set(Some((bytes, total)));
                    }
                    progress.set(Some((bytes, total)));
                },
            );
            if case == "range ignored" {
                assert_eq!(first_progress.get(), Some((0, Some(3))));
            }
            if let Some(expected) = want {
                assert!(result.is_ok(), "{case}");
                assert_eq!(fs::read(&path).unwrap(), expected.as_bytes(), "{case}");
                let size = expected.len() as u64;
                assert_eq!(progress.get(), Some((size, Some(size))), "{case}");
            } else {
                assert!(result.is_err(), "{case}");
                assert!(!path.exists(), "{case}");
                assert_eq!(fs::read(part_of(&path)).unwrap(), b"abc", "{case}");
                if case == "short body" {
                    assert_eq!(progress.get(), Some((3, Some(6))));
                }
            }
            server.join().unwrap();
            fs::remove_dir_all(dir).unwrap();
        }
    }
}

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};

use crate::platform;

const PREFIX: &str = "aiostreams-desktop-";
/// Days of logs kept, one file for each day the app was started.
const KEEP: usize = 7;

struct FileLogger {
    file: Mutex<Option<File>>,
    level: LevelFilter,
}

/// `aiostreams_desktop_core::player` logs as `player`, the app itself as `app`.
fn short_target(target: &str) -> &str {
    match target.rsplit("::").next().unwrap_or(target) {
        "aiostreams_desktop" => "app",
        name => name,
    }
}

fn ours(target: &str) -> bool {
    target.starts_with("aiostreams_desktop") || matches!(target, "mpv" | "web" | "panic")
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        // Other crates only get through with something worth reading.
        metadata.level() <= self.level
            && (ours(metadata.target()) || metadata.level() <= Level::Warn)
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let (date, time) = platform::local_time();
        // Continuation lines, as in a stack trace, are indented under their entry.
        let message = record.args().to_string().replace('\n', "\n    ");
        let line = format!(
            "{date} {time} {:<5} {}: {message}\n",
            record.level(),
            short_target(record.target()),
        );
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        if let Ok(mut file) = self.file.lock()
            && let Some(file) = file.as_mut()
        {
            let _ = file.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock()
            && let Some(file) = file.as_mut()
        {
            let _ = file.flush();
        }
    }
}

fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut logs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(".log"))
        })
        .collect();
    logs.sort();
    let excess = logs.len().saturating_sub(KEEP);
    for old in &logs[..excess] {
        let _ = std::fs::remove_file(old);
    }
}

/// Logs to today's file in `dir`; `AIOSTREAMS_LOG` (e.g. `debug`) sets the level.
pub fn init(dir: &Path) -> PathBuf {
    let level = std::env::var("AIOSTREAMS_LOG")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(LevelFilter::Info);
    let _ = std::fs::create_dir_all(dir);
    let (date, _) = platform::local_time();
    let path = dir.join(format!("{PREFIX}{date}.log"));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();
    prune(dir);
    let logger = Box::leak(Box::new(FileLogger {
        file: Mutex::new(file),
        level,
    }));
    if log::set_logger(logger).is_ok() {
        log::set_max_level(level);
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(target: "panic", "{info}");
        log::logger().flush();
        previous(info);
    }));
    path
}

pub fn tail(path: &Path, lines: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

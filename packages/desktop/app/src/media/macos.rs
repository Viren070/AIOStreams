//! Now Playing in Control Center and the menu bar, which the media keys drive.

use std::cell::RefCell;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

use aiostreams_desktop_core::now_playing::{self, MediaKey};
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::NSImage;
use objc2_core_foundation::CGSize;
use objc2_foundation::{NSArray, NSMutableDictionary, NSNumber, NSString, NSURL};
use objc2_media_player::{
    MPChangePlaybackPositionCommandEvent, MPMediaItemArtwork, MPMediaItemPropertyArtist,
    MPMediaItemPropertyArtwork, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle,
    MPNowPlayingInfoCenter, MPNowPlayingInfoMediaType, MPNowPlayingInfoPropertyElapsedPlaybackTime,
    MPNowPlayingInfoPropertyMediaType, MPNowPlayingInfoPropertyPlaybackRate,
    MPNowPlayingPlaybackState, MPRemoteCommand, MPRemoteCommandCenter, MPRemoteCommandEvent,
    MPRemoteCommandHandlerStatus,
};

const SKIP_SECONDS: f64 = 10.0;

type Keys = Arc<Mutex<Box<dyn Fn(MediaKey) + Send>>>;

/// What one command sends, from the event it carries.
type Press = fn(&MPRemoteCommandEvent) -> Option<MediaKey>;

/// Call on the main thread.
pub fn start(keys: impl Fn(MediaKey) + Send + 'static) {
    let keys: Keys = Arc::new(Mutex::new(Box::new(keys)));
    // SAFETY: on the main thread, with handlers that match each command's event.
    unsafe {
        let center = MPRemoteCommandCenter::sharedCommandCenter();
        let on = |command: Retained<MPRemoteCommand>, press: Press| {
            let keys = keys.clone();
            let handler = RcBlock::new(move |event: NonNull<MPRemoteCommandEvent>| {
                let Some(key) = press(event.as_ref()) else {
                    return MPRemoteCommandHandlerStatus::CommandFailed;
                };
                if let Ok(keys) = keys.lock() {
                    keys(key);
                }
                MPRemoteCommandHandlerStatus::Success
            });
            command.setEnabled(true);
            command.addTargetWithHandler(&handler);
        };
        on(center.playCommand(), |_| Some(MediaKey::Play));
        on(center.pauseCommand(), |_| Some(MediaKey::Pause));
        on(center.togglePlayPauseCommand(), |_| Some(MediaKey::Toggle));
        on(center.stopCommand(), |_| Some(MediaKey::Stop));
        on(center.nextTrackCommand(), |_| Some(MediaKey::Next));
        on(center.previousTrackCommand(), |_| Some(MediaKey::Previous));
        let intervals = NSArray::from_retained_slice(&[NSNumber::new_f64(SKIP_SECONDS)]);
        let forward = center.skipForwardCommand();
        forward.setPreferredIntervals(&intervals);
        on(Retained::into_super(forward), |_| {
            Some(MediaKey::Skip {
                offset: (SKIP_SECONDS * 1000.0) as i64,
            })
        });
        let backward = center.skipBackwardCommand();
        backward.setPreferredIntervals(&intervals);
        on(Retained::into_super(backward), |_| {
            Some(MediaKey::Skip {
                offset: -(SKIP_SECONDS * 1000.0) as i64,
            })
        });
        on(
            Retained::into_super(center.changePlaybackPositionCommand()),
            |event| {
                let event = event.downcast_ref::<MPChangePlaybackPositionCommandEvent>()?;
                Some(MediaKey::Seek {
                    position: (event.positionTime() * 1000.0) as i64,
                })
            },
        );
    }

    now_playing::start(|snapshot| {
        let shown = snapshot.map(|s| Shown {
            title: s.item.title.clone(),
            subtitle: s.item.subtitle.clone(),
            artwork: s.item.artwork.clone(),
            duration: s.duration.map(|d| d.as_secs_f64()),
            position: s.position.as_secs_f64(),
            playing: s.playing,
        });
        DispatchQueue::main().exec_async(move || {
            LAST.with_borrow_mut(|last| *last = shown);
            render();
        });
    });
}

/// What Now Playing shows, rebuilt whole on every change.
struct Shown {
    title: String,
    subtitle: Option<String>,
    artwork: Option<String>,
    duration: Option<f64>,
    position: f64,
    playing: bool,
}

thread_local! {
    static LAST: RefCell<Option<Shown>> = const { RefCell::new(None) };
    /// The artwork of one address, loaded once and added to every rebuild.
    static ART: RefCell<Option<(String, Retained<MPMediaItemArtwork>)>> = const { RefCell::new(None) };
    static LOADING: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// A loaded image on its way to the main thread.
struct Image(Retained<NSImage>);
// SAFETY: only read once loaded, which NSImage allows from any thread.
unsafe impl Send for Image {}

/// Loads off the main thread; one that finishes after the title changed is dropped.
fn load(url: String) {
    std::thread::spawn(move || {
        let image = NSURL::URLWithString(&NSString::from_str(&url))
            .and_then(|address| NSImage::initWithContentsOfURL(NSImage::alloc(), &address))
            .map(Image);
        DispatchQueue::main().exec_async(move || {
            LOADING.with_borrow_mut(|loading| *loading = None);
            let current = LAST.with_borrow(|last| {
                last.as_ref().and_then(|s| s.artwork.clone()) == Some(url.clone())
            });
            let Some(Image(image)) = image.filter(|_| current) else {
                return;
            };
            let size = image.size();
            let handler = RcBlock::new(move |_: CGSize| NonNull::from(&*image));
            // SAFETY: the handler owns the image it points to.
            let artwork = unsafe {
                MPMediaItemArtwork::initWithBoundsSize_requestHandler(
                    MPMediaItemArtwork::alloc(),
                    size,
                    &handler,
                )
            };
            ART.with_borrow_mut(|art| *art = Some((url, artwork)));
            render();
        });
    });
}

/// On the main queue.
fn render() {
    // SAFETY: each key is given a value of the type Apple documents for it.
    unsafe {
        let center = MPNowPlayingInfoCenter::defaultCenter();
        LAST.with_borrow(|last| {
            let Some(shown) = last else {
                center.setNowPlayingInfo(None);
                center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
                return;
            };
            let info: Retained<NSMutableDictionary<NSString, AnyObject>> =
                NSMutableDictionary::new();
            let text = |key: &NSString, value: &str| info.insert(key, &*NSString::from_str(value));
            let number = |key: &NSString, value: f64| info.insert(key, &*NSNumber::new_f64(value));
            text(MPMediaItemPropertyTitle, &shown.title);
            if let Some(subtitle) = &shown.subtitle {
                text(MPMediaItemPropertyArtist, subtitle);
            }
            if let Some(duration) = shown.duration {
                number(MPMediaItemPropertyPlaybackDuration, duration);
            }
            number(MPNowPlayingInfoPropertyElapsedPlaybackTime, shown.position);
            number(
                MPNowPlayingInfoPropertyPlaybackRate,
                if shown.playing { 1.0 } else { 0.0 },
            );
            info.insert(
                MPNowPlayingInfoPropertyMediaType,
                &*NSNumber::new_usize(MPNowPlayingInfoMediaType::Video.0),
            );
            if let Some(url) = &shown.artwork {
                let loaded = ART.with_borrow(|art| match art {
                    Some((from, artwork)) if from == url => {
                        info.insert(MPMediaItemPropertyArtwork, &**artwork);
                        true
                    }
                    _ => false,
                });
                let started = LOADING.with_borrow(|loading| loading.as_ref() == Some(url));
                if !loaded && !started {
                    LOADING.with_borrow_mut(|loading| *loading = Some(url.clone()));
                    load(url.clone());
                }
            }
            center.setNowPlayingInfo(Some(&**info));
            center.setPlaybackState(if shown.playing {
                MPNowPlayingPlaybackState::Playing
            } else {
                MPNowPlayingPlaybackState::Paused
            });
        });
    }
}

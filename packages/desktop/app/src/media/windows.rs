//! The media panel Windows shows by the volume flyout, which the media keys drive.

use std::sync::{Arc, Mutex};

use aiostreams_desktop_core::now_playing::{self, MediaKey, Snapshot};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
    SystemMediaTransportControls, SystemMediaTransportControlsButton,
    SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;
use windows::core::{HSTRING, Result, factory};

/// The panel's skip buttons carry no amount.
const SKIP_MS: i64 = 10_000;

type Keys = Arc<Mutex<Box<dyn Fn(MediaKey) + Send>>>;

fn press(keys: &Keys, key: MediaKey) {
    if let Ok(keys) = keys.lock() {
        keys(key);
    }
}

struct Panel {
    controls: SystemMediaTransportControls,
    /// Title, subtitle and artwork last shown, as the thumbnail is fetched on every change.
    shown: Option<(String, Option<String>, Option<String>)>,
}

pub fn start(hwnd: isize, keys: impl Fn(MediaKey) + Send + 'static) {
    match attach(hwnd, keys) {
        Ok(panel) => {
            let panel = Mutex::new(panel);
            now_playing::start(move |snapshot| {
                if let Ok(mut panel) = panel.lock()
                    && let Err(e) = panel.update(snapshot)
                {
                    log::warn!("media controls: {e}");
                }
            });
        }
        Err(e) => log::warn!("media controls unavailable: {e}"),
    }
}

fn attach(hwnd: isize, keys: impl Fn(MediaKey) + Send + 'static) -> Result<Panel> {
    let interop = factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    let controls: SystemMediaTransportControls =
        unsafe { interop.GetForWindow(HWND(hwnd as *mut _)) }?;
    let keys: Keys = Arc::new(Mutex::new(Box::new(keys)));
    let buttons = keys.clone();
    controls.ButtonPressed(&TypedEventHandler::<
        SystemMediaTransportControls,
        SystemMediaTransportControlsButtonPressedEventArgs,
    >::new(move |_, args| {
        let Some(args) = args.as_ref() else {
            return Ok(());
        };
        let key = match args.Button()? {
            SystemMediaTransportControlsButton::Play => MediaKey::Play,
            SystemMediaTransportControlsButton::Pause => MediaKey::Pause,
            SystemMediaTransportControlsButton::Stop => MediaKey::Stop,
            SystemMediaTransportControlsButton::Next => MediaKey::Next,
            SystemMediaTransportControlsButton::Previous => MediaKey::Previous,
            SystemMediaTransportControlsButton::FastForward => MediaKey::Skip { offset: SKIP_MS },
            SystemMediaTransportControlsButton::Rewind => MediaKey::Skip { offset: -SKIP_MS },
            _ => return Ok(()),
        };
        press(&buttons, key);
        Ok(())
    }))?;
    controls.PlaybackPositionChangeRequested(&TypedEventHandler::<
        SystemMediaTransportControls,
        PlaybackPositionChangeRequestedEventArgs,
    >::new(move |_, args| {
        let Some(args) = args.as_ref() else {
            return Ok(());
        };
        let position = std::time::Duration::from(args.RequestedPlaybackPosition()?);
        press(
            &keys,
            MediaKey::Seek {
                position: position.as_millis() as i64,
            },
        );
        Ok(())
    }))?;
    controls.SetIsPlayEnabled(true)?;
    controls.SetIsPauseEnabled(true)?;
    controls.SetIsStopEnabled(true)?;
    controls.SetIsFastForwardEnabled(true)?;
    controls.SetIsRewindEnabled(true)?;
    controls.SetIsEnabled(false)?;
    Ok(Panel {
        controls,
        shown: None,
    })
}

impl Panel {
    fn update(&mut self, snapshot: Option<&Snapshot>) -> Result<()> {
        let Some(s) = snapshot else {
            self.shown = None;
            return self.controls.SetIsEnabled(false);
        };
        self.controls.SetIsEnabled(true)?;
        self.controls.SetPlaybackStatus(if s.playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        })?;
        self.controls.SetIsNextEnabled(s.item.next)?;
        self.controls.SetIsPreviousEnabled(s.item.previous)?;

        let shown = Some((
            s.item.title.clone(),
            s.item.subtitle.clone(),
            s.item.artwork.clone(),
        ));
        if self.shown != shown {
            let display = self.controls.DisplayUpdater()?;
            display.SetType(MediaPlaybackType::Video)?;
            let video = display.VideoProperties()?;
            video.SetTitle(&HSTRING::from(&s.item.title))?;
            video.SetSubtitle(&HSTRING::from(
                s.item.subtitle.as_deref().unwrap_or_default(),
            ))?;
            match &s.item.artwork {
                Some(url) => display.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(
                    &Uri::CreateUri(&HSTRING::from(url))?,
                )?)?,
                None => display.SetThumbnail(None)?,
            }
            display.Update()?;
            self.shown = shown;
        }

        let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
        let end = TimeSpan::from(s.duration.unwrap_or_default());
        timeline.SetStartTime(TimeSpan::default())?;
        timeline.SetMinSeekTime(TimeSpan::default())?;
        timeline.SetEndTime(end)?;
        timeline.SetMaxSeekTime(end)?;
        timeline.SetPosition(TimeSpan::from(s.position))?;
        self.controls.UpdateTimelineProperties(&timeline)
    }
}

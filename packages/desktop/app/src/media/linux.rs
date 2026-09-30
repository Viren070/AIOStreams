//! MPRIS, which desktops read for their media widget and route the media keys through.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use aiostreams_desktop_core::now_playing::{self, MediaKey, Snapshot};
use gtk4::gio::{self, DBusConnection};
use gtk4::glib::variant::ToVariant;
use gtk4::glib::{self, Variant, VariantDict};

const BUS_NAME: &str = "org.mpris.MediaPlayer2.aiostreams";
const PATH: &str = "/org/mpris/MediaPlayer2";
const ROOT: &str = "org.mpris.MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const TRACK_PREFIX: &str = "/io/github/viren070/aiostreams/track/";
/// A position this far from where playback should be is announced as a seek.
const SEEK_MS: f64 = 1500.0;

const XML: &str = r#"<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek"><arg name="Offset" type="x" direction="in"/></method>
    <method name="SetPosition">
      <arg name="TrackId" type="o" direction="in"/>
      <arg name="Position" type="x" direction="in"/>
    </method>
    <method name="OpenUri"><arg name="Uri" type="s" direction="in"/></method>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>"#;

#[derive(Default)]
struct Shown {
    title: Option<String>,
    subtitle: Option<String>,
    artwork: Option<String>,
    length_us: i64,
    track: u64,
    playing: bool,
    next: bool,
    previous: bool,
    /// The position and when it was reported, from which the current one follows.
    position_ms: f64,
    at: Option<Instant>,
}

impl Shown {
    fn position_ms(&self) -> f64 {
        match self.at {
            Some(at) if self.playing => self.position_ms + at.elapsed().as_secs_f64() * 1000.0,
            _ => self.position_ms,
        }
    }

    fn track_path(&self) -> String {
        format!("{TRACK_PREFIX}{}", self.track)
    }

    fn metadata(&self) -> Variant {
        let dict = VariantDict::new(None);
        if let Some(title) = &self.title {
            let track = glib::variant::ObjectPath::try_from(self.track_path())
                .expect("a valid object path");
            dict.insert_value("mpris:trackid", &track.to_variant());
            dict.insert_value("xesam:title", &title.to_variant());
            if let Some(subtitle) = &self.subtitle {
                dict.insert_value("xesam:artist", &vec![subtitle.clone()].to_variant());
            }
            if let Some(art) = &self.artwork {
                dict.insert_value("mpris:artUrl", &art.to_variant());
            }
            if self.length_us > 0 {
                dict.insert_value("mpris:length", &self.length_us.to_variant());
            }
        }
        dict.end()
    }

    fn status(&self) -> &'static str {
        match (&self.title, self.playing) {
            (None, _) => "Stopped",
            (Some(_), true) => "Playing",
            (Some(_), false) => "Paused",
        }
    }

    fn player_property(&self, name: &str) -> Option<Variant> {
        let active = self.title.is_some();
        Some(match name {
            "PlaybackStatus" => self.status().to_variant(),
            "Rate" | "Volume" | "MinimumRate" | "MaximumRate" => 1.0f64.to_variant(),
            "Metadata" => self.metadata(),
            "Position" => ((self.position_ms() * 1000.0) as i64).to_variant(),
            "CanGoNext" => self.next.to_variant(),
            "CanGoPrevious" => self.previous.to_variant(),
            "CanPlay" | "CanPause" | "CanSeek" => active.to_variant(),
            "CanControl" => true.to_variant(),
            _ => return None,
        })
    }
}

type Keys = Arc<dyn Fn(MediaKey)>;

/// Call on the GTK thread; `keys` runs there too.
pub fn start(keys: impl Fn(MediaKey) + 'static) {
    let shown = Arc::new(Mutex::new(Shown::default()));
    let bus: Arc<Mutex<Option<DBusConnection>>> = Arc::default();
    let keys: Keys = Arc::new(keys);
    let node = match gio::DBusNodeInfo::for_xml(XML) {
        Ok(node) => node,
        Err(e) => return log::warn!("media controls: {e}"),
    };

    let (acquired, acquired_bus) = (shown.clone(), bus.clone());
    gio::bus_own_name(
        gio::BusType::Session,
        BUS_NAME,
        gio::BusNameOwnerFlags::NONE,
        move |connection, _| {
            for interface in [ROOT, PLAYER] {
                let Some(info) = node.lookup_interface(interface) else {
                    continue;
                };
                let (props, keys) = (acquired.clone(), keys.clone());
                let registered = connection
                    .register_object(PATH, &info)
                    .method_call(move |_, _, _, _, method, args, invocation| {
                        call(&keys, method, &args);
                        invocation.return_value(None);
                    })
                    .property(move |_, _, _, interface, name| {
                        if interface == ROOT {
                            return root_property(name);
                        }
                        let shown = props.lock().expect("media state");
                        shown
                            .player_property(name)
                            .unwrap_or_else(|| false.to_variant())
                    })
                    .build();
                if let Err(e) = registered {
                    log::warn!("media controls: {e}");
                }
            }
            if let Ok(mut bus) = acquired_bus.lock() {
                *bus = Some(connection);
            }
        },
        |_, _| {},
        |_, name| log::warn!("media controls: lost the bus name {name}"),
    );

    now_playing::start(move |snapshot| {
        let Ok(mut shown) = shown.lock() else { return };
        let seeked = update(&mut shown, snapshot);
        let Some(connection) = bus.lock().ok().and_then(|b| b.clone()) else {
            return;
        };
        let changed = VariantDict::new(None);
        for name in [
            "PlaybackStatus",
            "Metadata",
            "CanGoNext",
            "CanGoPrevious",
            "CanPlay",
            "CanPause",
            "CanSeek",
        ] {
            if let Some(value) = shown.player_property(name) {
                changed.insert_value(name, &value);
            }
        }
        let args = (PLAYER, changed.end(), Vec::<String>::new()).to_variant();
        let emit = |interface: &str, signal: &str, args: &Variant| {
            if let Err(e) = connection.emit_signal(None, PATH, interface, signal, Some(args)) {
                log::debug!("media controls: {e}");
            }
        };
        emit(
            "org.freedesktop.DBus.Properties",
            "PropertiesChanged",
            &args,
        );
        if seeked {
            let position = (shown.position_ms() * 1000.0) as i64;
            emit(PLAYER, "Seeked", &(position,).to_variant());
        }
    });
}

/// Whether the position jumped, which listeners have to be told of.
fn update(shown: &mut Shown, snapshot: Option<&Snapshot>) -> bool {
    let Some(s) = snapshot else {
        let track = shown.track;
        *shown = Shown {
            track,
            ..Shown::default()
        };
        return false;
    };
    let expected = shown.position_ms();
    let position = s.position.as_secs_f64() * 1000.0;
    let same =
        shown.title.as_deref() == Some(s.item.title.as_str()) && shown.subtitle == s.item.subtitle;
    if !same {
        shown.track += 1;
    }
    shown.title = Some(s.item.title.clone());
    shown.subtitle = s.item.subtitle.clone();
    shown.artwork = s.item.artwork.clone();
    shown.length_us = s.duration.map_or(0, |d| d.as_micros() as i64);
    shown.next = s.item.next;
    shown.previous = s.item.previous;
    shown.playing = s.playing;
    shown.position_ms = position;
    shown.at = Some(Instant::now());
    same && (expected - position).abs() > SEEK_MS
}

fn root_property(name: &str) -> Variant {
    match name {
        "Identity" => "AIOStreams".to_variant(),
        "DesktopEntry" => "io.github.viren070.aiostreams".to_variant(),
        "SupportedUriSchemes" | "SupportedMimeTypes" => Vec::<String>::new().to_variant(),
        _ => false.to_variant(),
    }
}

fn call(keys: &Keys, method: &str, args: &Variant) {
    let micros = |i: usize| args.try_child_value(i).and_then(|v| v.get::<i64>());
    let key = match method {
        "Play" => MediaKey::Play,
        "Pause" => MediaKey::Pause,
        "PlayPause" => MediaKey::Toggle,
        "Stop" => MediaKey::Stop,
        "Next" => MediaKey::Next,
        "Previous" => MediaKey::Previous,
        "Seek" => match micros(0) {
            Some(offset) => MediaKey::Skip {
                offset: offset / 1000,
            },
            None => return,
        },
        "SetPosition" => match micros(1) {
            Some(position) => MediaKey::Seek {
                position: position / 1000,
            },
            None => return,
        },
        _ => return,
    };
    keys(key);
}

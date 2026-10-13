import { settings, type PassthroughFormat } from '../../settings';
import { appBridge } from './bridge';

/** The sound settings each app applies to its own player, sent in `player-options`. */
export function soundOptions() {
  const { dialogueBoost, nightMode, ac3Encode } = settings.sound;
  return {
    dialogueBoost: dialogueBoost.read(),
    nightMode: nightMode.read(),
    ac3Encode: ac3Encode.read(),
  };
}

/** mpv's `audio-spdif` list for the formats left on; `dts-hd` passes DTS's core too. */
function spdifList(formats: Record<PassthroughFormat, boolean>): string {
  return [
    formats.ac3 && 'ac3',
    formats.eac3 && 'eac3',
    formats.dts && (formats['dts-hd'] ? 'dts-hd' : 'dts'),
    formats.truehd && 'truehd',
  ]
    .filter(Boolean)
    .join(',');
}

/** The Android app turns `auto:<list>` into the listed formats the audio output decodes. */
export function passthroughValue(): string {
  const list = spdifList(settings.sound.passthroughFormats.read());
  if (appBridge()?.platform !== 'android')
    return settings.desktop.passthrough.read() ? list : '';
  return { off: '', auto: `auto:${list}`, always: list }[
    settings.android.passthrough.read()
  ];
}

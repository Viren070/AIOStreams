import { settings, type PassthroughFormat } from '../../settings';

/** The formats left on, as mpv names them; `dts-hd` passes DTS's core too. */
function formatList(formats: Record<PassthroughFormat, boolean>): string[] {
  return [
    formats.ac3 && 'ac3',
    formats.eac3 && 'eac3',
    formats.dts && (formats['dts-hd'] ? 'dts-hd' : 'dts'),
    formats.truehd && 'truehd',
  ].filter((f): f is string => !!f);
}

/** `passthroughAuto` keeps only the formats the Android app's audio output decodes. */
export function passthroughFormats(): {
  passthrough: string[];
  passthroughAuto?: boolean;
} {
  const mode = settings.audio.passthrough.read();
  return {
    passthrough:
      mode === 'off'
        ? []
        : formatList(settings.audio.passthroughFormats.read()),
    passthroughAuto: mode === 'auto',
  };
}

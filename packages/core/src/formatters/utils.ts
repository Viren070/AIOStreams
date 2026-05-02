export function formatBytes(
  bytes: number,
  k: 1024 | 1000,
  round: boolean = false
): string {
  if (bytes === 0) return '0 B';
  const sizes =
    k === 1024
      ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  let value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  if (round) {
    value = Math.round(value);
  }
  return value + ' ' + sizes[i];
}

export function formatSmartBytes(bytes: number, k: 1024 | 1000): string {
  if (bytes === 0) return '0 B';
  const sizes =
    k === 1024
      ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const rawValue = bytes / Math.pow(k, i);
  const integerPart = Math.floor(rawValue);

  let value: number;
  let formattedValue: string;

  if (integerPart >= 100) {
    value = Math.round(rawValue);
    formattedValue = value.toString();
  } else if (integerPart >= 10) {
    value = parseFloat(rawValue.toFixed(1));
    formattedValue = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  } else {
    value = parseFloat(rawValue.toFixed(2));
    formattedValue = value.toString();
  }

  return formattedValue + ' ' + sizes[i];
}

export function formatBitrate(bitrate: number, round: boolean = false): string {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const i = Math.min(
    sizes.length - 1,
    Math.max(0, Math.floor(Math.log(bitrate) / Math.log(k)))
  );
  let value = bitrate / Math.pow(k, i);
  value = round ? Math.round(value) : parseFloat(value.toFixed(2));
  return `${value} ${sizes[i]}`;
}

export function formatSmartBitrate(bitrate: number): string {
  if (!Number.isFinite(bitrate) || bitrate <= 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const i = Math.min(
    sizes.length - 1,
    Math.max(0, Math.floor(Math.log(bitrate) / Math.log(k)))
  );
  const rawValue = bitrate / Math.pow(k, i);
  const integerPart = Math.floor(rawValue);

  let value: number;
  let formattedValue: string;
  if (integerPart >= 100) {
    value = Math.round(rawValue);
    formattedValue = value.toString();
  } else if (integerPart >= 10) {
    value = parseFloat(rawValue.toFixed(1));
    formattedValue = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  } else {
    value = parseFloat(rawValue.toFixed(2));
    formattedValue = value.toString();
  }
  return `${formattedValue} ${sizes[i]}`;
}

export function formatDuration(durationInMs: number): string {
  const seconds = Math.floor(durationInMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const formattedSeconds = seconds % 60;
  const formattedMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h:${formattedMinutes}m:${formattedSeconds}s`;
  } else if (formattedSeconds > 0) {
    return `${formattedMinutes}m:${formattedSeconds}s`;
  } else {
    return `${formattedMinutes}m`;
  }
}

/**
 *
 * @param hours - number of hours
 * @returns formatted string in days or hours e.g. "23h", "1d", "1023d"
 */
export function formatHours(hours: number): string {
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function makeSmall(code: string): string {
  return code
    .split('')
    .map((char) => SMALL_CAPS_MAP[char.toUpperCase()] || char)
    .join('');
}

const SMALL_CAPS_MAP: Record<string, string> = {
  A: 'ᴀ', // U+1D00
  B: 'ʙ', // U+0299
  C: 'ᴄ', // U+1D04
  D: 'ᴅ', // U+1D05
  E: 'ᴇ', // U+1D07
  F: 'ꜰ', // U+A730
  G: 'ɢ', // U+0262
  H: 'ʜ', // U+029C
  I: 'ɪ', // U+026A
  J: 'ᴊ', // U+1D0A
  K: 'ᴋ', // U+1D0B
  L: 'ʟ', // U+029F
  M: 'ᴍ', // U+1D0D
  N: 'ɴ', // U+0274
  O: 'ᴏ', // U+1D0F
  P: 'ᴘ', // U+1D18
  Q: 'ꞯ', // U+A7AF
  R: 'ʀ', // U+0280
  S: 'ꜱ', // U+A731
  T: 'ᴛ', // U+1D1B
  U: 'ᴜ', // U+1D1C
  V: 'ᴠ', // U+1D20
  W: 'ᴡ', // U+1D21
  // There is no widely supported small-cap X; fall back to "x".
  X: 'x',
  Y: 'ʏ', // U+028F
  Z: 'ᴢ', // U+1D22
};

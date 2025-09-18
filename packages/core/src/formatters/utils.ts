import { FULL_LANGUAGE_MAPPING } from '../utils/languages.js';

export function formatBytes(bytes: number, k: 1024 | 1000): string {
  if (bytes === 0) return '0 B';
  const sizes =
    k === 1024
      ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
      : ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

export function makeSmall(code: string): string {
  return code
    .split('')
    .map((char) => SMALL_CAPS_MAP[char.toUpperCase()] || char)
    .join('');
}

export function languageToEmoji(language: string): string | undefined {
  return languageEmojiMap[language.toLowerCase()];
}

export function languageToCode(language: string): string | undefined {
  const extractLanguage = (lang: string) => lang.split('(')[0].trim();
  const possibleLangs = FULL_LANGUAGE_MAPPING.filter(
    (lang) =>
      extractLanguage(lang.english_name).toLowerCase() ===
        language.toLowerCase() ||
      (lang.internal_english_name &&
        extractLanguage(lang.internal_english_name).toLowerCase() ===
          language.toLowerCase()) ||
      lang.name.toLowerCase() === language.toLowerCase()
  );
  if (possibleLangs.length === 0) {
    return undefined;
  }
  const selectedLang =
    possibleLangs.find((lang) => lang.flag_priority) ?? possibleLangs[0];
  if (selectedLang && selectedLang.iso_639_1) {
    return selectedLang.iso_639_1.toUpperCase();
  }
  return undefined;
}

export function emojiToLanguage(emoji: string): string | undefined {
  return Object.entries(languageEmojiMap).find(
    ([_, value]) => value === emoji
  )?.[0];
}
/**
 * A mapping of language names to their corresponding emoji flags.
 *
 * This mapping was adapted from the g0ldy/comet project.
 * https://github.com/g0ldyy/comet/blob/de5413425ac30a9d88bc7176862a7ff02027eb7f/comet/utils/general.py#L19C1-L19C18
 */
const languageEmojiMap: Record<string, string> = {
  multi: '🌎',
  english: '🇬🇧',
  japanese: '🇯🇵',
  chinese: '🇨🇳',
  russian: '🇷🇺',
  arabic: '🇸🇦',
  portuguese: '🇵🇹',
  spanish: '🇪🇸',
  french: '🇫🇷',
  german: '🇩🇪',
  italian: '🇮🇹',
  korean: '🇰🇷',
  hindi: '🇮🇳',
  bengali: '🇧🇩',
  punjabi: '🇵🇰',
  marathi: '🇮🇳',
  gujarati: '🇮🇳',
  tamil: '🇮🇳',
  telugu: '🇮🇳',
  kannada: '🇮🇳',
  malayalam: '🇮🇳',
  thai: '🇹🇭',
  vietnamese: '🇻🇳',
  indonesian: '🇮🇩',
  turkish: '🇹🇷',
  hebrew: '🇮🇱',
  persian: '🇮🇷',
  ukrainian: '🇺🇦',
  greek: '🇬🇷',
  lithuanian: '🇱🇹',
  latvian: '🇱🇻',
  estonian: '🇪🇪',
  polish: '🇵🇱',
  czech: '🇨🇿',
  slovak: '🇸🇰',
  hungarian: '🇭🇺',
  romanian: '🇷🇴',
  bulgarian: '🇧🇬',
  serbian: '🇷🇸',
  croatian: '🇭🇷',
  slovenian: '🇸🇮',
  dutch: '🇳🇱',
  danish: '🇩🇰',
  finnish: '🇫🇮',
  swedish: '🇸🇪',
  norwegian: '🇳🇴',
  malay: '🇲🇾',
  latino: '💃🏻',
  Latino: '🇲🇽',
};

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

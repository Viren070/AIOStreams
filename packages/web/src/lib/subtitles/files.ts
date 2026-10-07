import { parseAssCues, parseCues, type SubtitleCue } from './cues';

const MAX_BYTES = 10 * 1024 * 1024;

/** The legacy encodings subtitles in a language most often come in. */
const LEGACY: Record<string, string> = {
  ar: 'windows-1256',
  be: 'windows-1251',
  bg: 'windows-1251',
  cs: 'windows-1250',
  el: 'windows-1253',
  et: 'windows-1257',
  fa: 'windows-1256',
  he: 'windows-1255',
  hr: 'windows-1250',
  hu: 'windows-1250',
  ja: 'shift_jis',
  ko: 'euc-kr',
  lt: 'windows-1257',
  lv: 'windows-1257',
  mk: 'windows-1251',
  pl: 'windows-1250',
  ro: 'windows-1250',
  ru: 'windows-1251',
  sk: 'windows-1250',
  sl: 'windows-1250',
  sr: 'windows-1251',
  th: 'windows-874',
  tr: 'windows-1254',
  uk: 'windows-1251',
  vi: 'windows-1258',
  zh: 'gb18030',
  'zh-HK': 'big5',
  'zh-TW': 'big5',
};

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Throws why a player can't take the file. */
export function checkSubtitleFile(file: File, types: readonly string[]): void {
  if (!types.includes(extension(file.name))) {
    const names = types.map((t) => `.${t}`);
    throw new Error(
      `Only ${names.slice(0, -1).join(', ')} or ${names.at(-1)} files can be added`
    );
  }
  if (file.size > MAX_BYTES) throw new Error('That file is too big');
}

/** A file neither marked nor valid as UTF-8 is read in the browser language's legacy encoding. */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const { language } = navigator;
    const legacy = LEGACY[language] ?? LEGACY[language.split('-')[0]];
    return new TextDecoder(legacy ?? 'windows-1252').decode(bytes);
  }
}

export async function readSubtitleCues(file: File): Promise<SubtitleCue[]> {
  const text = await readText(file);
  const cues = ['ass', 'ssa'].includes(extension(file.name))
    ? parseAssCues(text)
    : parseCues(text);
  if (!cues.length) throw new Error('No subtitles were found in that file');
  return cues;
}

export function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Heuristic: is a filename "probably obfuscated" (a random/hashy name a release
 * group used to hide the real title)? Faithful port of SABnzbd's (GPL)
 * `deobfuscate_filenames.py` `is_probably_obfuscated`. Used to decide whether to
 * replace an archive's single inner-file name with the release name (the inner
 * *path* (the open selector) is never changed; only the display name is).
 *
 * source: https://github.com/sabnzbd/sabnzbd/blob/master/sabnzbd/deobfuscate_filenames.py
 */
export function isProbablyObfuscated(filename: string): boolean {
  // Basename without directory or extension.
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

  // --- Certainly obfuscated ---
  // 32 hex digits, e.g. b082fa0beaa644d3aa01045d5b8d0b36
  if (/^[a-f0-9]{32}$/.test(base)) return true;
  // 40+ lower-case hex digits and/or dots
  if (/^[a-f0-9.]{40,}$/.test(base)) return true;
  // square brackets plus 30+ hex digits
  if (/[a-f0-9]{30}/.test(base) && (base.match(/\[\w+\]/g)?.length ?? 0) >= 2)
    return true;
  // starts with 'abc.xyz'
  if (/^abc\.xyz/.test(base)) return true;

  // --- Signals of a clear, non-obfuscated name ---
  const decimals = (base.match(/\p{Nd}/gu) ?? []).length;
  const upper = (base.match(/\p{Lu}/gu) ?? []).length;
  const lower = (base.match(/\p{Ll}/gu) ?? []).length;
  const spacesDots = (base.match(/[ ._]/g) ?? []).length; // space-like symbols

  // "Great Distro"
  if (upper >= 2 && lower >= 2 && spacesDots >= 1) return false;
  // "this is a download"
  if (spacesDots >= 3) return false;
  // "Beast 2020"
  if (upper + lower >= 4 && decimals >= 4 && spacesDots >= 1) return false;
  // "Catullus": starts capital, mostly lower-case
  if (
    base.length > 0 &&
    /\p{Lu}/u.test(base[0]) &&
    lower > 2 &&
    upper / lower <= 0.25
  )
    return false;

  // Default: obfuscated.
  return true;
}

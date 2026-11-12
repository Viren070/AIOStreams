const ASS_FORMAT =
  'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';
const SSA_FORMAT =
  'Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';

/** Ends in an `[Events]` section with its format, which libass needs before events come one at a time. */
export function assHeader(header: string, ssa: boolean): string {
  let script = header.replace(/\r/g, '').trimEnd();
  if (!/^\[events\]/im.test(script)) script += '\n\n[Events]';
  const events = script.slice(/^\[events\]/im.exec(script)!.index);
  if (!/^format:/im.test(events))
    // eslint-disable-next-line lingui/no-unlocalized-strings -- script syntax
    script += `\nFormat: ${ssa ? SSA_FORMAT : ASS_FORMAT}`;
  return `${script}\n`;
}

export function scriptFamilies(script: string): Set<string> {
  const families = new Set<string>();
  const add = (name: string) => {
    const family = name.trim().replace(/^@/, '').toLowerCase();
    if (family) families.add(family);
  };
  let fontAt = -1;
  for (const row of script.split('\n')) {
    const line = row.trim();
    const format = /^format:(.*)$/i.exec(line);
    if (format && fontAt < 0) {
      const fields = format[1].split(',').map((f) => f.trim().toLowerCase());
      if (fields.includes('fontname')) fontAt = fields.indexOf('fontname');
    }
    const style = /^style:(.*)$/i.exec(line);
    if (style && fontAt >= 0) add(style[1].split(',')[fontAt] ?? '');
  }
  for (const match of script.matchAll(/\\fn([^\\}]*)/g)) add(match[1]);
  return families;
}

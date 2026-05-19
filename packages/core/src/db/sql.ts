/**
 * Tagged template helper for composing parameterized SQL.
 *
 * Usage:
 *   sql`SELECT * FROM users WHERE uuid = ${uuid}`
 *
 * Values are pushed as positional `?` placeholders, in order. Nested
 * `SqlFragment` values are inlined verbatim and their params merged.
 * Use `raw` for trusted strings (identifiers, keywords) that must not
 * be parameterized.
 */
export class SqlFragment {
  constructor(
    readonly text: string,
    readonly params: readonly unknown[]
  ) {}
}

export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlFragment {
  let text = '';
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v instanceof SqlFragment) {
        text += v.text;
        params.push(...v.params);
      } else {
        text += '?';
        params.push(v);
      }
    }
  }
  return new SqlFragment(text, params);
}

export function raw(s: string): SqlFragment {
  return new SqlFragment(s, []);
}

export function join(
  fragments: readonly SqlFragment[],
  separator = ', '
): SqlFragment {
  let text = '';
  const params: unknown[] = [];
  fragments.forEach((f, i) => {
    if (i > 0) text += separator;
    text += f.text;
    params.push(...f.params);
  });
  return new SqlFragment(text, params);
}

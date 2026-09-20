/**
 * All must hold: `key` (truthy), `key=a|b` (equals one), `key~a|b` (contains
 * one). Case-insensitive; a leading `!` negates.
 *
 * A value may be `{section.property}`, which reads a list from the caller's
 * `resolve`. Without one, a reference contributes no values.
 */
export type VariableResolver = (path: string) => readonly string[] | undefined;
export type ObjectFilter = (
  object: object,
  resolve?: VariableResolver
) => boolean;

const CONDITION = /^(!?)\s*([A-Za-z]+)\s*(?:([=~])(.*))?$/;
const REFERENCE =
  /^\{\s*([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\}$/;

export function compileObjectFilter(
  conditions: readonly string[]
): ObjectFilter {
  const tests = conditions.map(compileCondition);
  return (object, resolve) => tests.every((test) => test(object, resolve));
}

/** Every `{section.property}` the conditions read, for validation. */
export function objectFilterReferences(
  conditions: readonly string[]
): string[] {
  const found = new Set<string>();
  for (const condition of conditions) {
    const match = CONDITION.exec(condition.trim());
    if (!match?.[4]) continue;
    for (const part of match[4].split('|')) {
      const reference = REFERENCE.exec(part.trim());
      if (reference) found.add(reference[1]);
    }
  }
  return [...found];
}

function compileCondition(condition: string): ObjectFilter {
  const match = CONDITION.exec(condition.trim());
  if (!match) throw new Error(`invalid condition '${condition}'`);
  const [, bang, key, operator, rawValue] = match;
  const negate = bang === '!';

  if (!operator) {
    return (object) => !!(object as Record<string, unknown>)[key] !== negate;
  }

  const parts = rawValue.split('|').map((value) => value.trim());
  const references = parts
    .map((part) => REFERENCE.exec(part)?.[1])
    .filter((path): path is string => path !== undefined);
  const literals = parts
    .filter((part) => !REFERENCE.test(part))
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  const test =
    operator === '='
      ? (values: string[], actual: string) => values.includes(actual)
      : (values: string[], actual: string) =>
          values.some((value) => actual.includes(value));

  return (object, resolve) => {
    const values = references.length
      ? [
          ...literals,
          ...references.flatMap((path) =>
            (resolve?.(path) ?? []).map((value) => value.toLowerCase())
          ),
        ]
      : literals;
    const actual = (object as Record<string, unknown>)[key];
    return (
      (actual != null && test(values, String(actual).toLowerCase())) !== negate
    );
  };
}

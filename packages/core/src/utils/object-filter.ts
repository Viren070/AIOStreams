/**
 * All must hold: `key` (truthy), `key=a|b` (equals one), `key~a|b` (contains
 * one). Case-insensitive; a leading `!` negates.
 */
export type ObjectFilter = (object: object) => boolean;

const CONDITION = /^(!?)\s*([A-Za-z]+)\s*(?:([=~])(.*))?$/;

export function compileObjectFilter(
  conditions: readonly string[]
): ObjectFilter {
  const tests = conditions.map(compileCondition);
  return (object) => tests.every((test) => test(object));
}

function compileCondition(condition: string): ObjectFilter {
  const match = CONDITION.exec(condition.trim());
  if (!match) throw new Error(`invalid condition '${condition}'`);
  const [, bang, key, operator, rawValue] = match;
  const negate = bang === '!';

  if (!operator) {
    return (object) => !!(object as Record<string, unknown>)[key] !== negate;
  }

  const values = rawValue
    .split('|')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const test =
    operator === '='
      ? (actual: string) => values.includes(actual)
      : (actual: string) => values.some((value) => actual.includes(value));

  return (object) => {
    const actual = (object as Record<string, unknown>)[key];
    return (actual != null && test(String(actual).toLowerCase())) !== negate;
  };
}

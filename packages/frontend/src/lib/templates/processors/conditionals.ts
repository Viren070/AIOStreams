/**
 * Pure functions for evaluating AIOStreams expressions in templates.
 */

/**
 * Internal sentinel returned by applyTemplateConditionals when an object
 * property should be removed from its parent object.
 */
const REMOVE_KEY: unique symbol = Symbol('aiostreams.remove');

/**
 * Resolve a dot-separated key path (e.g. "subsectionId.subOptionId") against
 * an inputs object, enabling subsection references like `inputs.proxy.url`.
 */
export function getNestedInputValue(
  inputVals: Record<string, any>,
  key: string
): any {
  const parts = key.split('.');
  let current: any = inputVals;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Evaluate a condition string from an `__if` field.
 *
 * Single-expression forms (all support optional leading `!` to negate):
 *   inputs.<key>                         — truthy check (undefined/null/''/ false/[] are falsy; 0 is truthy)
 *   inputs.<key> == <value>              — equality (string comparison)
 *   inputs.<key> != <value>              — inequality (string comparison)
 *   inputs.<key> includes <value>        — array/string contains
 *   inputs.<key> > <n>                   — numeric greater-than
 *   inputs.<key> >= <n>                  — numeric greater-than-or-equal
 *   inputs.<key> < <n>                   — numeric less-than
 *   inputs.<key> <= <n>                  — numeric less-than-or-equal
 *   services                             — any service selected (true when selectedSvcs is non-empty)
 *   services.<serviceId>                 — specific service selected
 *
 * Compound forms (evaluated before negation; each sub-expression may carry its own `!`):
 *   <expr> and <expr> [and ...]          — all must be true (highest precedence)
 *   <expr> xor <expr> [xor ...]         — odd number must be true
 *   <expr> or  <expr> [or  ...]         — at least one must be true (lowest precedence)
 */
export function evaluateTemplateCondition(
  condition: string,
  inputVals: Record<string, any>,
  selectedSvcs: string[]
): boolean {
  const trimmed = condition.trim();

  // Handle compound expressions first (split by lowest-precedence operator)
  const orParts = trimmed.split(/ or (?=!?(?:inputs|services)\b)/);
  if (orParts.length > 1) {
    return orParts.some((p) =>
      evaluateTemplateCondition(p.trim(), inputVals, selectedSvcs)
    );
  }
  const xorParts = trimmed.split(/ xor (?=!?(?:inputs|services)\b)/);
  if (xorParts.length > 1) {
    const count = xorParts.filter((p) =>
      evaluateTemplateCondition(p.trim(), inputVals, selectedSvcs)
    ).length;
    return count % 2 === 1;
  }
  const andParts = trimmed.split(/ and (?=!?(?:inputs|services)\b)/);
  if (andParts.length > 1) {
    return andParts.every((p) =>
      evaluateTemplateCondition(p.trim(), inputVals, selectedSvcs)
    );
  }

  const negated = trimmed.startsWith('!');
  const expr = negated ? trimmed.slice(1).trim() : trimmed;

  // Numeric comparison operators: inputs.<key> >= / <= / > / < <number>
  const numCmpMatch = expr.match(
    /^(\w+)\.(.+?)\s+(>=|<=|>|<)\s+(-?\d+(?:\.\d+)?)$/
  );
  if (numCmpMatch) {
    const [, ns, key, op, rawRhs] = numCmpMatch;
    const rhs = parseFloat(rawRhs);
    let result = false;
    if (ns === 'inputs') {
      const lhs = getNestedInputValue(inputVals, key);
      const num = typeof lhs === 'number' ? lhs : parseFloat(String(lhs ?? ''));
      if (!isNaN(num)) {
        if (op === '>=') result = num >= rhs;
        else if (op === '<=') result = num <= rhs;
        else if (op === '>') result = num > rhs;
        else if (op === '<') result = num < rhs;
      }
    }
    return negated ? !result : result;
  }

  // Operator form: "inputs.<key> <op> <value>"  (op: ==, !=, includes)
  const opMatch = expr.match(/^(\w+)\.(.+?)\s+(==|!=|includes)\s+(.+)$/);
  if (opMatch) {
    const [, ns, key, op, rawValue] = opMatch;
    const rhs = rawValue.trim();
    let result = false;
    if (ns === 'inputs') {
      const lhs = getNestedInputValue(inputVals, key);
      if (op === '==') {
        result = String(lhs ?? '') === rhs;
      } else if (op === '!=') {
        result = String(lhs ?? '') !== rhs;
      } else if (op === 'includes') {
        if (Array.isArray(lhs)) {
          result = lhs.includes(rhs);
        } else if (typeof lhs === 'string') {
          result = lhs.includes(rhs);
        }
      }
    }
    // services.* doesn't support operators — falls through to false
    return negated ? !result : result;
  }

  // Bare truthiness form: "inputs.<key>", "services.<key>", or bare "services"
  const dotIdx = expr.indexOf('.');
  if (dotIdx === -1) {
    if (expr === 'services') {
      return negated ? selectedSvcs.length === 0 : selectedSvcs.length > 0;
    }
    return negated;
  }
  const ns = expr.slice(0, dotIdx);
  const key = expr.slice(dotIdx + 1);
  let result = false;
  if (ns === 'inputs') {
    const val = getNestedInputValue(inputVals, key);
    result =
      val !== undefined &&
      val !== null &&
      val !== '' &&
      val !== false &&
      !(Array.isArray(val) && val.length === 0);
  } else if (ns === 'services') {
    result = selectedSvcs.includes(key);
  }
  return negated ? !result : result;
}

/**
 * Resolve an "inputs.<id>" or "services.<id>" reference to its runtime value.
 * The bare "services" reference resolves to the full selectedSvcs array
 */
export function resolveRef(
  ref: string,
  inputVals: Record<string, any>,
  selectedSvcs: string[]
): any {
  const trimmed = ref.trim();
  if (trimmed === 'services') {
    return selectedSvcs.slice();
  }
  if (trimmed.startsWith('inputs.')) {
    return getNestedInputValue(inputVals, trimmed.slice('inputs.'.length));
  }
  if (trimmed.startsWith('services.')) {
    return selectedSvcs.includes(trimmed.slice('services.'.length));
  }
  return undefined;
}

/**
 * Recursively walk a config value and evaluate all dynamic expressions:
 *   - `__if`                    — conditional item removal in arrays
 *   - `__if` + `__value`        — conditional key inclusion at the object-property
 *                                 level: true → key = value; false → key is dropped
 *   - `__value`                 — inject a primitive or spread an array into the
 *                                 parent array
 *   - `__switch`                — replace the whole object with the matching case
 *   - `__remove: true`          — unconditionally drop this key from its parent
 *                                 object (also works as a __switch case value)
 *   - `{{inputs.<id>}}`         — string interpolation; sole-token refs
 *                                 preserve the original type (array, number, …)
 *   - `{{services}}`            — resolves to the selected services array;
 *                                 sole-token refs return the array directly,
 *                                 multi-token refs join with ','
 *   - `{{services.<id>}}`       — resolves to a boolean (true if the specific
 *                                 service is selected); sole-token refs return
 *                                 the boolean directly, multi-token stringify it
 *   - `{{services.<id>.<key>}}` — credential ref: intentionally **preserved as a
 *                                 literal string** so that the final value can be
 *                                 filled in by `resolveCredentialRefs()` once the
 *                                 user's credential inputs are available
 */
export function applyTemplateConditionals(
  value: any,
  inputVals: Record<string, any>,
  selectedSvcs: string[]
): any {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (item && typeof item === 'object' && '__if' in item) {
          return evaluateTemplateCondition(item.__if, inputVals, selectedSvcs);
        }
        return true;
      })
      .flatMap((item) => {
        if (item && typeof item === 'object' && '__if' in item) {
          const { __if: _if, ...rest } = item;
          // __value: inject a primitive or spread an array into the parent
          if ('__value' in rest) {
            const val = applyTemplateConditionals(
              rest.__value,
              inputVals,
              selectedSvcs
            );
            return Array.isArray(val) ? val : [val];
          }
          return applyTemplateConditionals(rest, inputVals, selectedSvcs);
        }
        // __value without __if: always inject
        if (item && typeof item === 'object' && '__value' in item) {
          const val = applyTemplateConditionals(
            (item as any).__value,
            inputVals,
            selectedSvcs
          );
          return Array.isArray(val) ? val : [val];
        }
        const resolved = applyTemplateConditionals(
          item,
          inputVals,
          selectedSvcs
        );
        // If a string item (e.g. "{{inputs.languages}}") resolved to an array, spread it
        return Array.isArray(resolved) ? resolved : [resolved];
      });
  }

  if (value && typeof value === 'object') {
    // __switch: replace the whole object with the matching case value
    if ('__switch' in value) {
      const switchRef: string = value.__switch;
      const cases: Record<string, any> = value.cases ?? {};
      const defaultVal: any = value.default ?? null;
      const resolved = resolveRef(switchRef, inputVals, selectedSvcs);
      const key =
        resolved !== undefined && resolved !== null ? String(resolved) : null;
      const chosen = key !== null && key in cases ? cases[key] : defaultVal;
      return applyTemplateConditionals(chosen, inputVals, selectedSvcs);
    }

    // __if + __value at the object-property-value level
    if ('__if' in value && '__value' in value) {
      if (
        evaluateTemplateCondition((value as any).__if, inputVals, selectedSvcs)
      ) {
        return applyTemplateConditionals(
          (value as any).__value,
          inputVals,
          selectedSvcs
        );
      }
      return REMOVE_KEY;
    }

    // __remove: true → unconditionally drop this key from its parent object.
    if ((value as any).__remove === true) {
      return REMOVE_KEY;
    }

    // Regular property walk.
    // Keys whose resolved value is the REMOVE_KEY sentinel are silently dropped.
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const resolved = applyTemplateConditionals(v, inputVals, selectedSvcs);
      if (resolved !== (REMOVE_KEY as unknown)) {
        result[k] = resolved;
      }
    }
    return result;
  }

  // String interpolation: replace {{inputs.<id>}} and {{services.<id>}}.
  // If the entire string is a single {{...}} token, return the raw value
  // (preserving arrays, numbers, booleans) instead of stringifying.
  if (typeof value === 'string') {
    if (value === '{{services}}') return selectedSvcs.slice();
    const singleToken = value.match(/^\{\{(inputs|services)\.([^}]+)\}\}$/);
    if (singleToken) {
      const [, ns, key] = singleToken;
      if (ns === 'inputs') {
        const v = getNestedInputValue(inputVals, key);
        return v !== undefined && v !== null ? v : '';
      }
      if (ns === 'services') {
        // preserve two segment service reference for confirmLoadTemplate
        // where the actual credential value will be available.
        if (key.includes('.')) return `{{services.${key}}}`;
        return selectedSvcs.includes(key);
      }
    }
    return value
      .replace(/\{\{services\}\}/g, selectedSvcs.join(','))
      .replace(/\{\{(inputs|services)\.([^}]+)\}\}/g, (_, ns, key) => {
        if (ns === 'inputs') {
          const v = getNestedInputValue(inputVals, key);
          return v !== undefined && v !== null ? String(v) : '';
        }
        if (ns === 'services') {
          if (key.includes('.')) return `{{services.${key}}}`;
          return String(selectedSvcs.includes(key));
        }
        return '';
      });
  }

  return value;
}

/**
 * Safely extract an array from a template config field that may be either
 * a resolved array or an unresolved template directive
 */
export function asConfigArray<T = any>(value: any): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray(value.__value)
  ) {
    return value.__value as T[];
  }
  return [];
}

/**
 * Replace all `{{services.<serviceId>.<credKey>}}` placeholders that were
 * **preserved** (not resolved) by `applyTemplateConditionals` with the actual
 * credential values from the provided lookup map.
 */
export function resolveCredentialRefs(
  value: any,
  credentialValues: Record<string, string>
): any {
  if (typeof value === 'string') {
    return value.replace(
      /\{\{services\.(\w[\w-]*)\.(\w[\w-]*)\}\}/g,
      (_: string, serviceId: string, credKey: string) =>
        credentialValues[`service_${serviceId}_${credKey}`] ?? ''
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveCredentialRefs(item, credentialValues));
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      value[k] = resolveCredentialRefs(value[k], credentialValues);
    }
  }
  return value;
}

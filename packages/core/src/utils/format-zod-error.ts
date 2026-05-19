import { z, ZodError } from 'zod';

type ZodIssue = ZodError['issues'][number];

export interface FormatZodErrorOptions {
  /**
   * Prepended to every line *after the first*. Useful when embedding the
   * formatted error inside a log banner where the first line already starts
   * after a label like `Error:       ` — pass enough whitespace to align
   * continuation lines with the start of the message.
   */
  continuationIndent?: string;
  /**
   * Collapse the formatted output to a single line by joining issue lines
   * with `; `. Useful for contexts that strip newlines (toasts, single-line
   * log fields). Indentation from nested unions is dropped.
   */
  singleLine?: boolean;
}

/**
 * Format a Zod v4 error into a human-readable multi-line string.
 *
 * `z.prettifyError` does not recurse into `invalid_union` issues — it just
 * prints "Invalid input" for the whole union without telling you which
 * branches failed and why. This formatter walks `issue.errors` (the per-branch
 * issue arrays attached to union failures) so each branch is printed
 * individually under a "variant N" header.
 *
 * Output style:
 *   - root issues are printed as `<path>: <message> (<code>)`
 *   - empty paths are rendered as `<root>`
 *   - union failures are followed by an indented block per branch
 *
 * Works for non-union schemas too — they just produce the flat list.
 */
export function formatZodError(
  error: ZodError | unknown,
  options: FormatZodErrorOptions = {}
): string {
  if (!(error instanceof ZodError)) return String(error);
  const raw = formatIssues(error.issues, 0);
  if (options.singleLine) {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('; ');
  }
  if (options.continuationIndent) {
    const indent = options.continuationIndent;
    return raw
      .split('\n')
      .map((line, idx) => (idx === 0 ? line : indent + line))
      .join('\n');
  }
  return raw;
}

function formatIssues(issues: readonly ZodIssue[], depth: number): string {
  return issues.map((issue) => formatIssue(issue, depth)).join('\n');
}

function formatIssue(issue: ZodIssue, depth: number): string {
  const indent = '  '.repeat(depth);
  const path = issue.path?.length ? issue.path.join('.') : '<root>';

  // Union: each entry in `issue.errors` is the issue list for one branch.
  if (issue.code === 'invalid_union') {
    const branches = (issue as { errors?: readonly (readonly ZodIssue[])[] })
      .errors;
    if (Array.isArray(branches) && branches.length > 0) {
      const header = `${indent}${path}: ${issue.message} (invalid_union); none of the variants matched:`;
      const lines = branches.map((branchIssues, idx) => {
        const variantHeader = `${indent}  variant ${idx + 1}:`;
        const sub = formatIssues(branchIssues, depth + 2);
        return `${variantHeader}\n${sub}`;
      });
      return [header, ...lines].join('\n');
    }
  }

  return `${indent}${path}: ${issue.message} (${issue.code})`;
}

/**
 * Best-effort: re-export the legacy prettifier in case any caller wants the
 * single-line form. New code should prefer {@link formatZodError}.
 */
export const prettifyZodError = (error: ZodError) => z.prettifyError(error);

// Run from the repository root: pnpm exec tsx --import ./packages/core/test/setup.ts packages/core/scripts/benchmark-title-matching.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { partial_ratio } from 'fuzzball';
import { normaliseTitle, titleMatchWithLang } from '../src/parser/utils.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = execFileSync(
  'git',
  ['rev-parse', process.env.BENCH_BASE ?? 'origin/main'],
  { cwd: root, encoding: 'utf8' }
).trim();
const temporary = fileURLToPath(
  new URL(
    `../src/parser/.title-match-baseline-${process.pid}.ts`,
    import.meta.url
  )
);
const source = execFileSync(
  'git',
  ['show', `${base}:packages/core/src/parser/utils.ts`],
  { cwd: root, encoding: 'utf8' }
);
const count = Number(process.env.BENCH_COUNT ?? 2000);
assert(Number.isSafeInteger(count) && count > 0);
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Public title fixtures plus deliberately synthetic distractors; no provider data or credentials.
const cases = [
  ['Endgame', 'Avengers: Endgame', 'Vingadores: Ultimato'],
  [
    'Fellowship',
    'The Lord of the Rings: The Fellowship of the Ring',
    'La Communauté de l’anneau',
  ],
  ['Dune Part Two', 'Dune: Part Two', 'Duna: Parte Dois'],
  ['Poor Things', 'Poor Things', 'Pobres Criaturas'],
  ['The Last of Us S1E1', 'The Last of Us', 'Одни из нас'],
  ['Stranger Things S1E1', 'Stranger Things', 'Очень странные дела'],
  ['The Bear S1E1', 'The Bear', 'Медведь'],
];

writeFileSync(temporary, source, { flag: 'wx' });
try {
  const baseline = await import(pathToFileURL(temporary).href);
  const results = [];
  for (const [label, english, alternate] of cases) {
    const titles = [
      { title: english, language: 'en' },
      { title: alternate, language: 'other' },
      ...Array.from({ length: 92 }, (_, i) => ({
        title: `Synthetic unrelated title ${i}`,
        language: 'xx',
      })),
    ];
    const variants = [
      english,
      alternate,
      `${english} Extended`,
      `${english} IMAX Encore`,
      'Completely different film',
      english.slice(0, -2),
    ];
    const queries = Array.from({ length: count }, (_, i) =>
      normaliseTitle(variants[i % variants.length])
    );
    const options = {
      threshold: 0.75,
      scorer: partial_ratio,
      limitTitles: 100,
    };
    const run = (match: typeof titleMatchWithLang) => {
      const start = performance.now();
      const decisions = queries.map((query) => match(query, titles, options));
      return { ms: performance.now() - start, decisions };
    };
    // Assert every decision/language before timing; the same metadata array exercises cache reuse.
    const expected = run(baseline.titleMatchWithLang).decisions;
    assert.deepEqual(run(titleMatchWithLang).decisions, expected, label);
    const before: number[] = [],
      after: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      for (const candidate of pass % 2 ? [true, false] : [false, true]) {
        const result = run(
          candidate ? titleMatchWithLang : baseline.titleMatchWithLang
        );
        assert.deepEqual(result.decisions, expected, label);
        (candidate ? after : before).push(result.ms);
      }
    }
    results.push({
      label,
      candidates: count,
      metadata_titles: titles.length,
      baseline_ms: before,
      patched_ms: after,
      baseline_median_ms: median(before),
      patched_median_ms: median(after),
      improvement_percent: 100 * (1 - median(after) / median(before)),
      decision_or_language_differences: 0,
    });
  }
  const before = results.reduce((sum, x) => sum + x.baseline_median_ms, 0);
  const after = results.reduce((sum, x) => sum + x.patched_median_ms, 0);
  console.log(
    JSON.stringify(
      {
        node: process.version,
        baseline_commit: base,
        cpu: cpus()[0]?.model,
        logical_cpus: cpus().length,
        fixture_type:
          'synthetic; matcher only, warm choices; not end-to-end latency',
        passes: 3,
        results,
        aggregate_baseline_median_sum_ms: before,
        aggregate_patched_median_sum_ms: after,
        aggregate_improvement_percent: 100 * (1 - after / before),
      },
      null,
      2
    )
  );
} finally {
  unlinkSync(temporary);
}

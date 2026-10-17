import assert from 'node:assert/strict';
import { test } from 'node:test';
import postcss from 'postcss';
import { expandIs, legacyCss } from './legacy-css.ts';

test('expands :is() into a selector list', () => {
  assert.deepEqual(expandIs('body.app :is(input,textarea)'), [
    'body.app input',
    'body.app textarea',
  ]);
  assert.deepEqual(expandIs(':is(.a,.b) :is(.c,.d):not(.e)'), [
    '.a .c:not(.e)',
    '.a .d:not(.e)',
    '.b .c:not(.e)',
    '.b .d:not(.e)',
  ]);
  assert.deepEqual(expandIs('.dark\\:border:is(.dark *)'), [
    '.dark .dark\\:border',
  ]);
  assert.deepEqual(expandIs('.plain'), ['.plain']);
});

test('refuses :is() it cannot expand faithfully', () => {
  assert.throws(() => expandIs('.a:not(:is(.b,.c))'));
  assert.throws(() => expandIs('.a:is(img)'));
});

test('adds fallbacks without touching the original rules', async () => {
  const { css } = await postcss([legacyCss()]).process(
    '.flex-col{flex-direction:column}.gap-2{gap:.5rem}.h-dvh{height:100dvh}' +
      '.gap-x-3{column-gap:.75rem}.gap-y-1{row-gap:.25rem}.flex-wrap{flex-wrap:wrap}' +
      '@media (min-width:640px){.sm\\:flex-row{flex-direction:row}}' +
      '.aspect-\\[2\\/3\\]{aspect-ratio:2/3}' +
      '.before\\:aspect-video:before{aspect-ratio:16/9}' +
      'html[data-x] :focus-visible{outline:0}.ring:focus-visible{outline:1px}' +
      'html:not([data-p]) .\\[html_\\&\\:focus-visible\\]\\:x:focus-visible{color:red}',
    { from: undefined }
  );
  assert.match(css, /\.gap-2\{gap:\.5rem\}/);
  assert.match(
    css,
    /\.no-flex-gap \.flex\.gap-2:not\(\.flex-col\)>:not\(:last-child\)/
  );
  assert.match(
    css,
    /\.no-flex-gap \.flex-col\.gap-2>:not\(:last-child\)\{margin-bottom:\s*\.5rem\}/
  );
  assert.match(
    css,
    /@media \(min-width:640px\)\{.*\.no-flex-gap \.sm\\:flex-row\.sm\\:flex-row\.gap-2>:not\(:last-child\)\{margin-inline-end:\s*\.5rem;\s*margin-bottom:\s*0\}/
  );
  // A vertical-only gap leaves the horizontal margin to the gap-x class.
  assert.doesNotMatch(css, /\.gap-y-1:not\(\.flex-col\)/);
  assert.match(
    css,
    /\.flex-col\.gap-y-1>:not\(:last-child\)\{margin-bottom:\s*\.25rem\}/
  );
  assert.match(
    css,
    /\.flex\.gap-x-3:not\(\.flex-col\)>:not\(:last-child\)[^{]*\{margin-inline-end:\s*\.75rem\}/
  );
  assert.match(
    css,
    /\.flex-wrap\.flex-wrap\.flex-wrap\.gap-y-1>\*\{margin-bottom:\s*\.25rem\}/
  );
  assert.doesNotMatch(css, /\.flex-wrap\.flex-wrap\.flex-wrap\.gap-x-3/);
  assert.match(css, /height:\s*100vh;\s*height:100dvh/);
  assert.match(
    css,
    /\.no-aspect-ratio \.aspect-\\\[2\\\/3\\\]:before\{content:\s*"";\s*float:\s*left;\s*padding-top:\s*150%\}/
  );
  // A pseudo-element sizes itself by its own padding instead.
  assert.match(
    css,
    /\.no-aspect-ratio \.before\\:aspect-video:before\{height:\s*0;\s*padding-top:\s*56\.25%\}/
  );
  assert.match(css, /html\.no-focus-visible\[data-x\] :focus\{/);
  assert.match(css, /\.no-focus-visible \.ring:focus\{/);
  // The class name keeps its escaped `\:focus-visible`; only the pseudo-class changes.
  assert.match(
    css,
    /html\.no-focus-visible:not\(\[data-p\]\) \.\\\[html_\\&\\:focus-visible\\\]\\:x:focus\{/
  );
});

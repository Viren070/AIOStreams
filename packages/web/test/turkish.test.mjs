import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parsePoFile } from '@lingui/format-po';
import { setupI18n } from '@lingui/core';
import ts from 'typescript';

// Use the compiler shipped with the runtime so these checks match the app.
const require = createRequire(import.meta.resolve('@lingui/core'));
const { compileMessageOrThrow } = await import(
  pathToFileURL(require.resolve('@lingui/message-utils/compileMessage'))
);

const catalog = (locale) =>
  parsePoFile(
    readFileSync(
      new URL(`../src/locales/${locale}.po`, import.meta.url),
      'utf8'
    )
  ).items.filter((entry) => entry.msgid && !entry.obsolete);
const key = (entry) => JSON.stringify([entry.msgctxt ?? '', entry.msgid]);
const source = catalog('en-GB');
const turkish = catalog('tr');
const translated = new Map(turkish.map((entry) => [key(entry), entry]));

// Product names, physical keys, standard technical terms and value-only strings.
const unchanged = new Set([
  '{help} {bytes}.',
  '{r}×',
  '{shown}×',
  '+{amount} ms',
  '+{db} dB',
  '+{time}',
  '−{amount} ms',
  '−{time}',
  'Alt',
  'Ctrl',
  'Discord',
  'Dolby Vision',
  'Enter',
  'Esc',
  'Jellyfin API',
  'Normal',
  'Page Down',
  'Page Up',
  'PIN',
  'Shift',
  'Stereo',
  'Tab',
  'Video',
  'Win',
]);

function argumentsOf(tokens, found = new Map()) {
  for (const token of tokens) {
    if (!Array.isArray(token)) continue;
    const [name, type, format] = token;
    found.set(name, type ?? 'argument');
    if (['plural', 'selectordinal', 'select'].includes(type)) {
      assert.ok(Object.hasOwn(format, 'other'), 'Missing ICU other case');
      for (const [choice, value] of Object.entries(format))
        if (choice !== 'offset') argumentsOf(value, found);
    }
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function tagsOf(text) {
  const stack = [];
  const tags = [...text.matchAll(/<(\/?)(\d+)(\/?)>/g)].map((match) => {
    if (match[1])
      assert.equal(stack.pop(), match[2], 'Mismatched rich-text tag');
    else if (!match[3]) stack.push(match[2]);
    return match[0];
  });
  assert.equal(stack.length, 0, 'Unclosed rich-text tag');
  return tags.sort();
}

test('Turkish covers every source message without empty, fuzzy or English fallback text', () => {
  assert.equal(translated.size, turkish.length, 'Duplicate message');
  assert.equal(turkish.length, source.length, 'Catalog sizes differ');
  for (const entry of source) {
    const target = translated.get(key(entry));
    assert.ok(target, `Missing: ${entry.msgid}`);
    assert.ok(target.msgstr[0]?.trim(), `Empty: ${entry.msgid}`);
    assert.ok(!target.flags?.fuzzy, `Fuzzy: ${entry.msgid}`);
    if (target.msgstr[0] === entry.msgid)
      assert.ok(unchanged.has(entry.msgid), `English fallback: ${entry.msgid}`);
  }
});

test('Turkish preserves ICU arguments and rich-text tags and renders numeric cases', () => {
  for (const entry of source) {
    const text = translated.get(key(entry)).msgstr[0];
    const original = compileMessageOrThrow(entry.msgid);
    const message = compileMessageOrThrow(text);
    const args = argumentsOf(original);
    assert.deepEqual(argumentsOf(message), args, entry.msgid);
    assert.deepEqual(tagsOf(text), tagsOf(entry.msgid), entry.msgid);
    const i18n = setupI18n({ locale: 'tr', messages: { tr: { message } } });
    for (const count of [0, 1, 2, 5, 100]) {
      const values = Object.fromEntries(
        args.map(([name, type]) => [
          name,
          ['plural', 'selectordinal'].includes(type) ? count : `DEĞER_${name}`,
        ])
      );
      const result = i18n._('message', values);
      assert.ok(!/\{[^{}]+,\s*(plural|select)/.test(result), entry.msgid);
      if (entry.msgid.startsWith('{count, plural, one {# second}'))
        assert.equal(result, `${count} saniye`);
      if (entry.msgid === 'Cast') assert.equal(result, 'Oyuncular');
      if (entry.msgid === '{left} left')
        assert.equal(result, 'DEĞER_left kaldı');
      if (entry.msgid === 'Volume {percent}%')
        assert.equal(result, 'Ses düzeyi %DEĞER_percent');
      if (entry.msgid === '{extra, plural, one {# more} other {# more}}')
        assert.equal(result, `${count} tane daha`);
      if (
        entry.msgid === '{unaired, plural, one {# unaired} other {# unaired}}'
      )
        assert.equal(result, `${count} bölüm yayınlanmadı`);
    }
  }
});

test('Android Turkish resources cover notifications and preserve format arguments', () => {
  const resources = (locale) => {
    const xml = readFileSync(
      new URL(
        `../../android/app/src/main/res/${locale}/strings.xml`,
        import.meta.url
      ),
      'utf8'
    );
    const entries = [
      ...xml.matchAll(
        /<(string|plurals)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g
      ),
    ];
    return new Map(
      entries.map(([, type, name, text]) => [name, { type, text }])
    );
  };
  const english = resources('values');
  const target = resources('values-tr');
  assert.equal(english.size, 16);
  assert.deepEqual([...target.keys()].sort(), [...english.keys()].sort());
  const argumentsOf = (text) =>
    [...text.matchAll(/%(?:\d+\$)?[sd]/g)].map(([arg]) => arg).sort();
  for (const [name, original] of english) {
    const translated = target.get(name);
    assert.equal(translated.type, original.type, name);
    assert.ok(translated.text.trim(), name);
    assert.notEqual(
      translated.text,
      original.text,
      `English fallback: ${name}`
    );
    assert.deepEqual(
      argumentsOf(translated.text),
      argumentsOf(original.text),
      name
    );
    if (original.type === 'plurals')
      assert.match(translated.text, /quantity="other"/);
    assert.doesNotMatch(
      translated.text,
      /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i,
      name
    );
  }
});

test('Readable JSX text goes through Trans instead of bypassing the catalogs', () => {
  const failures = [];
  const visitDirectory = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = new URL(entry.name, dir);
      if (entry.isDirectory()) {
        if (entry.name !== 'locales')
          visitDirectory(new URL(`${entry.name}/`, dir));
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      const source = ts.createSourceFile(
        file.pathname,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const visit = (node) => {
        if (ts.isJsxText(node) && /\p{L}/u.test(node.getText(source))) {
          let ancestor = node.parent;
          while (
            ancestor &&
            !(
              ts.isJsxElement(ancestor) &&
              ancestor.openingElement.tagName.getText(source) === 'Trans'
            )
          )
            ancestor = ancestor.parent;
          if (!ancestor) {
            const { line } = source.getLineAndCharacterOfPosition(
              node.getStart()
            );
            failures.push(
              `${file.pathname}:${line + 1}: ${node.getText(source).trim()}`
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  visitDirectory(new URL('../src/', import.meta.url));
  assert.deepEqual(failures, [], 'Untranslated JSX text');
});

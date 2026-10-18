// CSS fallbacks for the Tizen 6 build (`--env-mode tizen6`). Chromium 76 drops
// any rule whose selector it can't parse and any declaration it doesn't know,
// so each feature it lacks gets a form it reads. The aim is the page Tizen 7
// (Chromium 94) draws: what that misses too (`:has()`, `dvh`) is left alone.
// Flex `gap` and element `aspect-ratio` need layout, so `tizen6/legacy.js` in
// the smart-tv package fills those in at run time.
import isPseudoClass from '@csstools/postcss-is-pseudo-class';

/** `min(`/`max(`, but not `minmax(`. */
const MIN_MAX = /(?<![\w-])(?:min|max)\(/;

/** Splits on top-level commas or spaces. */
function split(value, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (separator === ' ' ? /\s/.test(c) : c === ',')) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

/** Each `min()`/`max()` replaced by its first argument, the size the rule starts from. */
function firstArguments(value) {
  for (let match; (match = MIN_MAX.exec(value));) {
    const open = match.index + match[0].length;
    let depth = 1;
    let end = open;
    while (depth && end < value.length) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')') depth--;
      end++;
    }
    const [first] = split(value.slice(open, end - 1), ',');
    value = value.slice(0, match.index) + first + value.slice(end);
  }
  return value;
}

/** `inset` as the four sides it sets. */
function insetSides(value) {
  const [top, right = top, bottom = top, left = right] = split(value, ' ');
  return { top, right, bottom, left };
}

const PSEUDO_ELEMENT = /::?(?:before|after)\b/;

/**
 * Logical properties Chromium 76 lacks (insets 87, the inline and block
 * shorthands 87, the corner radii 89), as the physical ones a TV, which draws
 * left to right, takes them for. Left logical, the minifier would write each
 * out with `:is(:lang(…))`, which this engine can't parse either.
 */
const PHYSICAL = {
  'inset-inline-start': ['left'],
  'inset-inline-end': ['right'],
  'inset-inline': ['left', 'right'],
  'inset-block-start': ['top'],
  'inset-block-end': ['bottom'],
  'inset-block': ['top', 'bottom'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'border-start-start-radius': ['border-top-left-radius'],
  'border-start-end-radius': ['border-top-right-radius'],
  'border-end-start-radius': ['border-bottom-left-radius'],
  'border-end-end-radius': ['border-bottom-right-radius'],
};

/** A two-sided shorthand's value for each side it sets. */
function sides(value, count) {
  if (count === 1) return [value];
  const [first, second = first] = split(value, ' ');
  return [first, second];
}

function legacyFallbacks() {
  return {
    postcssPlugin: 'aiostreams-legacy-fallbacks',
    Once(root, { Rule }) {
      // A card's artwork scaling on focus, or a shade fading over it, runs on
      // a layer of its own that this engine leaves unclipped by the frame's
      // rounded corners, which show square until it ends. Set at once, they
      // stay painted inside the frame.
      const still = new Rule({
        selector: [
          '[data-ui=artwork]',
          '[data-ui=artwork-fallback]',
          '[data-ui$=-shade]',
          '[data-ui=wide-card-play]',
        ].join(','),
      });
      still.append(
        { prop: 'transition', value: 'none', important: true },
        { prop: 'transform', value: 'none', important: true }
      );
      // The frame grows on focus instead, eased: a layer of its own then
      // holds the artwork inside its rounded corners.
      const FRAMES = '[data-ui=poster-card-image],[data-ui=wide-card-image]';
      const frames = new Rule({ selector: FRAMES });
      frames.append({
        prop: 'transition',
        value: 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
      });
      const grown = new Rule({
        selector: [
          'html:not([data-pointer-focus]) [data-ui=poster-card]:focus [data-ui=poster-card-image]',
          'html:not([data-pointer-focus]) .group\\/wide-link:focus [data-ui=wide-card-image]',
        ].join(','),
      });
      grown.append({ prop: 'transform', value: 'scale(1.04)' });
      // A card's ring goes round its frame as an outline, which this engine
      // draws square past the frame's rounded corners: a shadow there.
      const ring = new Rule({
        selector:
          'html:not([data-pointer-focus]) [data-focus=own]:focus [data-focus-frame]',
      });
      ring.append(
        { prop: 'outline', value: 'none', important: true },
        { prop: 'box-shadow', value: '0 0 0 3px var(--ring)' }
      );
      // Once, in the app's own stylesheet rather than each font's.
      if (/[\\/]src[\\/]styles\.css$/.test(root.source?.input.file ?? ''))
        root.append(still, frames, grown, ring);
      root.walkRules((rule) => {
        // `:where()` as `:is()`, which the next plugin writes out. Its rules
        // gain the specificity `:where()` held back; they are resets.
        // `:focus-visible` (Chromium 86) as `:focus`: on a TV focus comes from
        // the remote, and the app marks pointer focus with `data-pointer-focus`.
        // Only pseudo-classes: a class name such as Tailwind's
        // `[&:focus-visible]:…` holds them escaped (`\:`), and must stay as
        // the markup writes it.
        rule.selector = rule.selector
          .replace(/(?<!\\):where\(/g, ':is(')
          .replace(/(?<!\\):focus-visible/g, ':focus');
      });
      root.walkDecls((decl) => {
        const { prop, value } = decl;
        const physical = PHYSICAL[prop];
        if (physical) {
          const values = sides(value, physical.length);
          physical.forEach((side, i) =>
            decl.cloneBefore({ prop: side, value: values[i] })
          );
          decl.remove();
        } else if (
          prop === 'backdrop-filter' ||
          prop === '-webkit-backdrop-filter'
        ) {
          // A blur of what lies behind a bar or a sheet costs a TV's GPU each
          // frame anything under it moves; their tinted backgrounds stay.
          decl.remove();
        } else if (prop === 'inset') {
          for (const [side, v] of Object.entries(insetSides(value)))
            decl.cloneBefore({ prop: side, value: v });
        } else if (/^overflow(-[xy])?$/.test(prop) && value === 'clip') {
          // Chromium 90. The minifier would drop a fallback before it.
          decl.value = 'hidden';
        } else if (
          prop === 'aspect-ratio' &&
          decl.parent.type === 'rule' &&
          PSEUDO_ELEMENT.test(decl.parent.selector)
        ) {
          // A positioned pseudo-element takes its height from padding, which
          // is a share of the width. Elements get theirs from legacy.js.
          const [w, h = '1'] = value.split('/').map(Number);
          if (!(w > 0 && h > 0)) return;
          const fallback = new Rule({
            selector: decl.parent.selector
              .split(',')
              .map((s) => `html.no-aspect-ratio ${s.trim()}`)
              .join(','),
          });
          fallback.append({
            prop: 'padding-top',
            value: `${+((h / w) * 100).toFixed(4)}%`,
          });
          decl.parent.after(fallback);
        } else if (MIN_MAX.test(value)) {
          // `min()`/`max()` are Chromium 79. A custom property takes the last
          // value whatever it holds, so it is rewritten rather than preceded.
          if (prop.startsWith('--')) decl.value = firstArguments(value);
          else decl.cloneBefore({ value: firstArguments(value) });
        }
      });
    },
  };
}
legacyFallbacks.postcss = true;

export default function legacyCss() {
  return [
    legacyFallbacks(),
    isPseudoClass({ preserve: false, onComplexSelector: 'warning' }),
  ];
}

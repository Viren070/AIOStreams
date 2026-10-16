import type { Plugin, Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

/**
 * Keeps the standalone build working on Chromium 69 (2020 Samsung TVs), which
 * drops whole rules over selectors it doesn't know. `:is()` lists are
 * expanded; `:focus-visible`, flex `gap` and `aspect-ratio` get stand-ins that apply under the
 * classes the TV apps' `boot.js` puts on `<html>` when the engine lacks them.
 * `:where()` rules are left out: unwrapped, Tailwind's form resets would
 * outrank the utilities.
 */
export function legacyCss(): Plugin {
  return {
    postcssPlugin: 'aiostreams-legacy-css',
    OnceExit(root) {
      root.walkRules((rule) => {
        if (rule.selector.includes(':is(')) {
          rule.selectors = [...new Set(rule.selectors.flatMap(expandIs))];
        }
        // A class name's escaped `\:focus-visible` isn't the pseudo-class.
        const focusVisible = /(?<!\\):focus-visible/g;
        if (focusVisible.test(rule.selector)) {
          rule.cloneAfter({
            selectors: rule.selectors.map((s) =>
              under('no-focus-visible', s.replace(focusVisible, ':focus'))
            ),
          });
        }
      });
      root.walkDecls((decl) => {
        if (/\ddvh\b/.test(decl.value)) {
          decl.cloneBefore({ value: decl.value.replace(/(\d)dvh\b/g, '$1vh') });
        }
      });
      root.walkDecls('aspect-ratio', (decl) => {
        const rule = decl.parent as Rule;
        if (rule.type !== 'rule') return;
        const [width, height = '1'] = decl.value
          .split('/')
          .map((n) => n.trim());
        const percent = (Number(height) / Number(width)) * 100;
        if (!Number.isFinite(percent)) return;
        const padding = `${+percent.toFixed(4)}%`;
        // A single-class utility's pseudo-element, as `before:aspect-video`, can't take
        // another; its own padding sizes it, as one spanning its box's width does.
        if (/^\.(?:[^\s,>+~:\\]|\\.)+::?(before|after)$/.test(rule.selector)) {
          rule
            .cloneAfter({
              selectors: [under('no-aspect-ratio', rule.selector)],
            })
            .removeAll()
            .append(
              { prop: 'height', value: '0' },
              { prop: 'padding-top', value: padding }
            );
          return;
        }
        // Single-class utilities only.
        if (!/^\.(?:[^\s,>+~:\\]|\\.)+$/.test(rule.selector)) return;
        // A float's padding gives the box its height; the content sits over it.
        rule
          .cloneAfter({
            selectors: [under('no-aspect-ratio', `${rule.selector}:before`)],
          })
          .removeAll()
          .append(
            { prop: 'content', value: '""' },
            { prop: 'float', value: 'left' },
            { prop: 'padding-top', value: padding }
          );
        rule
          .cloneAfter({
            selectors: [under('no-aspect-ratio', `${rule.selector}:after`)],
          })
          .removeAll()
          .append(
            { prop: 'content', value: '""' },
            { prop: 'display', value: 'block' },
            { prop: 'clear', value: 'both' }
          );
      });
      // Breakpoint variants that turn a flex box, e.g. `.sm\:flex-row`.
      const directions: { rule: Rule; row: boolean }[] = [];
      root.walkDecls('flex-direction', (decl) => {
        const rule = decl.parent as Rule;
        if (
          rule.parent?.type === 'atrule' &&
          /^\.[\w-]+\\:flex-(row|col)$/.test(rule.selector)
        )
          directions.push({ rule, row: decl.value === 'row' });
      });
      // `.flex-wrap` and its breakpoint variants.
      const wraps: Rule[] = [];
      root.walkDecls('flex-wrap', (decl) => {
        const rule = decl.parent as Rule;
        if (
          decl.value === 'wrap' &&
          /^\.([\w-]+\\:)?flex-wrap$/.test(rule.selector)
        )
          wraps.push(rule);
      });
      root.walkDecls(/^(gap|row-gap|column-gap)$/, (decl) => {
        const rule = decl.parent as Rule;
        // Only Tailwind's single-class utilities, e.g. `.gap-2` or `.sm\:gap-x-4`.
        if (rule.type !== 'rule' || !/^\.[^\s,>+~]+$/.test(rule.selector))
          return;
        const [rowGap, columnGap = rowGap] = decl.value.split(/\s+/);
        // Each class sets only its own axis' margin, so `gap-x-2 gap-y-1` combine.
        const right = decl.prop !== 'row-gap';
        const bottom = decl.prop !== 'column-gap';
        const margins = (r?: string, b?: string) => ({
          ...(right && r !== undefined && { 'margin-right': r }),
          ...(bottom && b !== undefined && { 'margin-bottom': b }),
        });
        const sel = rule.selector;
        const items = '>:not(:last-child)';
        const add = (
          after: Rule,
          selectors: string[],
          decls: Record<string, string>
        ) => {
          if (!Object.keys(decls).length) return;
          after
            .cloneAfter({
              selectors: selectors.map((s) => under('no-flex-gap', s)),
            })
            .removeAll()
            .append(
              ...Object.entries(decls).map(([prop, value]) => ({ prop, value }))
            );
        };
        add(
          rule,
          [
            `.flex${sel}:not(.flex-col)${items}`,
            `.inline-flex${sel}:not(.flex-col)${items}`,
          ],
          margins(columnGap)
        );
        add(rule, [`.flex-col${sel}${items}`], margins(undefined, rowGap));
        // Later in the sheet with equal weight, so a variant beats the box's
        // base direction; it also undoes that direction's margin.
        if (rule.parent?.type !== 'root') return;
        for (const { rule: variant, row } of directions) {
          const twice = variant.selector + variant.selector;
          add(
            variant,
            [`${twice}${sel}${items}`],
            row ? margins(columnGap, '0') : margins('0', rowGap)
          );
        }
        // shortcut: a wrapping row spaces every item below, the last line too.
        for (const wrap of wraps) {
          const thrice = wrap.selector.repeat(3);
          add(wrap, [`${thrice}${sel}>*`], margins(undefined, rowGap));
        }
      });
    },
  };
}

/** `selector` limited to pages whose `<html>` has `className`. */
function under(className: string, selector: string): string {
  return /^html(?![\w-])/.test(selector)
    ? selector.replace('html', `html.${className}`)
    : `.${className} ${selector}`;
}

/** One selector without `:is()`, as the list of selectors it stands for. */
export function expandIs(selector: string): string[] {
  const pseudos: selectorParser.Pseudo[] = [];
  selectorParser((root) => {
    root.walkPseudos((pseudo) => {
      if (pseudo.value === ':is') pseudos.push(pseudo);
    });
  }).processSync(selector);
  const found = pseudos[0];
  if (!found) return [selector];
  const start = found.sourceIndex;
  const text = found.toString().trim();
  const before = selector.slice(0, start);
  const after = selector.slice(start + text.length);
  // Inside another pseudo (`:not(:is(a,b))`), a list of selectors would mean something else.
  const open = before.split('(').length - before.split(')').length;
  if (selector.slice(start, start + text.length) !== text || open > 0) {
    throw new Error(`legacy-css: cannot expand ${text} in ${selector}`);
  }
  return found.nodes.flatMap((arg) => {
    const inner = arg.toString().trim();
    // Tailwind's dark variant, `:is(.dark *)`: inside `.dark`.
    const ancestor = /^(\S+) \*$/.exec(inner);
    if (ancestor) return expandIs(`${ancestor[1]} ${before}${after}`);
    if (
      /[\s>+~]/.test(inner) ||
      (/^[a-z*]/i.test(inner) && /[^\s>+~(]$/.test(before))
    ) {
      throw new Error(`legacy-css: cannot expand ${inner} in ${selector}`);
    }
    return expandIs(before + inner + after);
  });
}

// Tizen 6 package only, after boot.js and in the same plain syntax. Fills in
// two layout features its Chromium (76 on 6.0, 85 on 6.5) lacks and CSS alone
// can't stand in for:
// - `gap` between flex items (Chromium 84): each flex container with a Tailwind
//   `gap-*` class gets margins on its items instead.
// - `aspect-ratio` (Chromium 88): an element with an `aspect-*` class gets the
//   height its width calls for. Pseudo-elements get theirs from the build's CSS
//   (web/legacy-css.js), under the `no-aspect-ratio` class set here.
(function () {
  var root = document.documentElement;

  function flexGapWorks() {
    var box = document.createElement('div');
    box.style.cssText =
      'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    box.appendChild(document.createElement('div'));
    box.appendChild(document.createElement('div'));
    root.appendChild(box);
    var works = box.scrollHeight === 1;
    root.removeChild(box);
    return works;
  }

  var noGap = !flexGapWorks();
  var noAspect = !(
    window.CSS &&
    CSS.supports &&
    CSS.supports('aspect-ratio', '1')
  );
  if (!noGap && !noAspect) return;
  if (noGap) root.classList.add('no-flex-gap');
  if (noAspect) root.classList.add('no-aspect-ratio');

  var style = document.createElement('style');
  document.head.appendChild(style);
  var rules = {};

  // Items an author places or spaces themselves keep their margins.
  var ITEM =
    ':not([hidden]):not(.hidden):not(.absolute):not(.fixed):not(.sr-only)';
  var SIDE = {
    row: 'left',
    'row-reverse': 'right',
    column: 'top',
    'column-reverse': 'bottom',
  };
  /** Items pushed apart by an `auto` margin on the gap's side keep it. */
  var AUTO = {
    left: ':not(.ml-auto):not(.mx-auto):not(.m-auto)',
    right: ':not(.mr-auto):not(.mx-auto):not(.m-auto)',
    top: ':not(.mt-auto):not(.my-auto):not(.m-auto)',
    bottom: ':not(.mb-auto):not(.my-auto):not(.m-auto)',
  };

  /** A class for this direction and spacing, with its rule written once. */
  function gapKey(direction, wrap, x, y) {
    var key = 'fg-' + direction + (wrap ? '-w' : '') + '-' + x + '-' + y;
    key = key.replace(/[^\w-]/g, '_');
    if (rules[key]) return key;
    rules[key] = true;
    var css;
    if (wrap) {
      // Rows of a wrapping box aren't known here: every item takes the gap
      // after it, and the box loses the last row's and column's at its edges.
      css =
        '[data-fg=' +
        key +
        ']>' +
        ITEM +
        '{margin-right:' +
        x +
        ';margin-bottom:' +
        y +
        '}';
    } else {
      var side = SIDE[direction] || 'left';
      var size = side === 'left' || side === 'right' ? x : y;
      css =
        '[data-fg=' +
        key +
        ']>' +
        ITEM +
        '~' +
        ITEM +
        AUTO[side] +
        '{margin-' +
        side +
        ':' +
        size +
        '}';
    }
    style.appendChild(document.createTextNode(css + '\n'));
    return key;
  }

  function gapOf(value) {
    return !value || value === 'normal' ? '0px' : value;
  }

  function fillGap(el) {
    var computed = getComputedStyle(el);
    var flex = /flex$/.test(computed.display);
    var x = gapOf(computed.columnGap);
    var y = gapOf(computed.rowGap);
    if (!flex || (x === '0px' && y === '0px')) {
      if (el.hasAttribute('data-fg')) el.removeAttribute('data-fg');
      return;
    }
    var key = gapKey(
      computed.flexDirection,
      computed.flexWrap !== 'nowrap',
      x,
      y
    );
    if (el.getAttribute('data-fg') !== key) el.setAttribute('data-fg', key);
  }

  var RATIO = { 'aspect-video': 16 / 9, 'aspect-square': 1 };

  function ratioOf(el) {
    var classes = el.classList;
    for (var i = 0; i < classes.length; i++) {
      var name = classes[i];
      if (RATIO[name]) return RATIO[name];
      var custom = /^aspect-\[(\d*\.?\d+)\/(\d*\.?\d+)\]$/.exec(name);
      if (custom) return +custom[1] / +custom[2];
    }
    return 0;
  }

  var ratios = typeof WeakMap === 'function' ? new WeakMap() : null;
  var sizer =
    noAspect && ratios && window.ResizeObserver
      ? new ResizeObserver(function (entries) {
          for (var i = 0; i < entries.length; i++)
            sizeToRatio(entries[i].target);
        })
      : null;

  function sizeToRatio(el) {
    var ratio = ratios.get(el);
    var width = el.offsetWidth;
    if (ratio && width) el.style.height = width / ratio + 'px';
  }

  function fillAspect(el) {
    var ratio = ratioOf(el);
    var had = ratios.get(el);
    if (ratio === (had || 0)) return;
    if (ratio) {
      ratios.set(el, ratio);
      if (!had) sizer.observe(el);
      sizeToRatio(el);
    } else {
      ratios.delete(el);
      sizer.unobserve(el);
      el.style.height = '';
    }
  }

  // The classes each element was last filled in for: reading its style again
  // costs a layout, which React's many class changes would repeat.
  var seen = typeof WeakMap === 'function' ? new WeakMap() : null;

  function visit(el) {
    var name = el.getAttribute && el.getAttribute('class');
    if (!name) return;
    if (seen) {
      if (seen.get(el) === name) return;
      seen.set(el, name);
    }
    if (noGap && name.indexOf('gap-') >= 0) fillGap(el);
    if (sizer && name.indexOf('aspect-') >= 0) fillAspect(el);
  }

  function visitTree(node) {
    if (node.nodeType !== 1) return;
    visit(node);
    var found = node.querySelectorAll('[class*="gap-"],[class*="aspect-"]');
    for (var i = 0; i < found.length; i++) visit(found[i]);
  }

  /** Stops sizing what left the page; it starts again if it comes back. */
  function forget(node) {
    if (!sizer || node.nodeType !== 1) return;
    var found = [node].concat(
      Array.prototype.slice.call(node.querySelectorAll('[class*="aspect-"]'))
    );
    for (var i = 0; i < found.length; i++) {
      if (!ratios.has(found[i])) continue;
      sizer.unobserve(found[i]);
      ratios.delete(found[i]);
      if (seen) seen.delete(found[i]);
    }
  }

  // Changes are taken in once a frame, after React has written them all.
  var pending = [];
  var scheduled = false;

  function flush() {
    scheduled = false;
    var batch = pending;
    pending = [];
    for (var i = 0; i < batch.length; i++) {
      var m = batch[i];
      if (m.type === 'attributes') visit(m.target);
      else {
        for (var j = 0; j < m.removedNodes.length; j++)
          forget(m.removedNodes[j]);
        for (var k = 0; k < m.addedNodes.length; k++)
          visitTree(m.addedNodes[k]);
      }
    }
  }

  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) pending.push(mutations[i]);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
})();

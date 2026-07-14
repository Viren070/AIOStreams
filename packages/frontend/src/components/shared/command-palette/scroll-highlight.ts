/** Scroll a command-palette target into view and pulse it. Shared by both palettes. */

/** Must match the `command-target-pulse` animation duration in globals.css. */
const HIGHLIGHT_MS = 1600;
/** Give the destination panel this long to mount before giving up. */
const FIND_TIMEOUT_MS = 3000;

let activeTarget: HTMLElement | null = null;
let activeTimer: number | null = null;

function findTarget(ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    const matches = document.querySelectorAll<HTMLElement>(
      `#${CSS.escape(id)}`
    );
    for (const el of matches) {
      // The configure page's MenuTabs renders a mobile accordion and a desktop
      // tab strip with the same ids: only one of the two is laid out, and
      // inactive panels are marked inert. `closest` includes `el` itself.
      if (el.offsetParent === null) continue;
      if (el.closest('[inert]')) continue;
      return el;
    }
  }
  return null;
}

/**
 * Document-space Y of the element's *layout* box.
 *
 * Every page mounts inside PageWrapper's `motion.div`, which springs from
 * `y: 60` to `y: 0` over ~1s, and tab panels slide in on top of that. A CSS
 * transform moves what you see but not the layout box, so `getBoundingClientRect`
 * reports a position that is still in flight while `offsetTop` already reports
 * where the element is going to come to rest. Measuring the resting position
 * means we never have to wait for an animation to finish.
 */
function layoutTop(el: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

function pulse(el: HTMLElement) {
  if (activeTarget) activeTarget.removeAttribute('data-command-target');
  if (activeTimer !== null) window.clearTimeout(activeTimer);

  el.setAttribute('data-command-target', 'true');
  activeTarget = el;
  activeTimer = window.setTimeout(() => {
    el.removeAttribute('data-command-target');
    activeTarget = null;
    activeTimer = null;
  }, HIGHLIGHT_MS);
}

/**
 * Scroll to the first of `ids` that resolves to a visible element, then pulse
 * it. Polls until the destination panel has mounted, so it is safe to call
 * immediately after navigating.
 */
export function scrollAndHighlight(ids: readonly string[]): void {
  const started = performance.now();

  const step = () => {
    const el = findTarget(ids);
    if (!el) {
      if (performance.now() - started < FIND_TIMEOUT_MS) {
        requestAnimationFrame(step);
      }
      return;
    }

    const centred =
      layoutTop(el) - Math.max(0, (window.innerHeight - el.offsetHeight) / 2);
    window.scrollTo({ top: Math.max(0, centred), behavior: 'smooth' });
    pulse(el);
  };

  requestAnimationFrame(step);
}

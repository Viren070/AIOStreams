/** Scroll a command-palette target into view and pulse it. Shared by both palettes. */

/** Must match the `command-target-pulse` animation duration in globals.css. */
const HIGHLIGHT_MS = 1600;
/** Give the destination panel this long to mount before giving up. */
const FIND_TIMEOUT_MS = 3000;
/** Give the page this long to stop growing under the scroll before giving up. */
const SETTLE_TIMEOUT_MS = 1500;
/** Frames the page height must hold still before we call it settled. */
const STABLE_FRAMES = 3;
/** Don't mistake an animation that has not started yet for one that has ended. */
const SETTLE_GRACE_MS = 120;

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
 * How far down the page we want to be, clamped to how far it currently allows.
 */
function reachableTop(el: HTMLElement, pageHeight: number): number {
  const desired =
    layoutTop(el) - Math.max(0, (window.innerHeight - el.offsetHeight) / 2);
  const max = Math.max(0, pageHeight - window.innerHeight);
  return Math.min(Math.max(0, desired), max);
}

/**
 * Scroll to the first of `ids` that resolves to a visible element, then pulse
 * it. Polls until the destination panel has mounted, so it is safe to call
 * immediately after navigating.
 */
export function scrollAndHighlight(ids: readonly string[]): void {
  const started = performance.now();
  let el: HTMLElement | null = null;
  let foundAt = 0;
  let issued = -1;
  let pageHeight = -1;
  let stableFrames = 0;

  const step = () => {
    const now = performance.now();

    if (!el) {
      el = findTarget(ids);
      if (!el) {
        if (now - started < FIND_TIMEOUT_MS) requestAnimationFrame(step);
        return;
      }
      // Settle timing runs from here, not from the call: the panel can take a
      // long frame to mount, and that should not eat the budget below.
      foundAt = now;
      pulse(el);
    }

    // Re-aim every frame the page changes size under us, because one shot at the
    // moment the panel appears lands against a page that has not grown yet.
    const height = document.documentElement.scrollHeight;
    if (height !== pageHeight) {
      pageHeight = height;
      stableFrames = 0;
    } else {
      stableFrames++;
    }

    const reachable = reachableTop(el, height);
    if (Math.abs(reachable - issued) > 1) {
      issued = reachable;
      window.scrollTo({ top: reachable, behavior: 'smooth' });
    }

    const sinceFound = now - foundAt;
    const settled =
      stableFrames >= STABLE_FRAMES && sinceFound >= SETTLE_GRACE_MS;
    if (!settled && sinceFound < SETTLE_TIMEOUT_MS) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

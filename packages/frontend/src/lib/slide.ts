import { flushSync } from 'react-dom';

// Held at the end: going back, the old page is on top until the transition ends.
const SLIDE = {
  duration: 350,
  easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  fill: 'forwards',
} as const;
const UNDER_SHIFT = 'translateX(-25%)';
const UNDER_OPACITY = 0.6;
/** Named in globals.css, which clips it to its own column. */
const SCOPE = 'slide-page';

/** One started during another captures the page mid-slide, so it waits. */
let active: ViewTransition | null = null;

/**
 * Runs `go` as a page sliding in over this one, or off it with `back`. With
 * `scoped`, only the element marked `data-slide-scope` moves, beneath those
 * marked `data-slide-above`.
 */
export function slide(
  go: () => void,
  options: { back?: boolean; scoped?: boolean } = {}
): void {
  if (active) {
    active.skipTransition();
    void active.finished.finally(() => slide(go, options));
    return;
  }
  const { back = false, scoped = false } = options;
  const scope = scoped
    ? document.querySelector<HTMLElement>('[data-slide-scope]')
    : null;
  if (
    !('startViewTransition' in document) ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (scoped && !scope)
  ) {
    go();
    return;
  }
  const root = document.documentElement;
  const name = scope ? SCOPE : 'root';
  // Unnamed, they'd be part of the page beneath the sliding one. Toasts never
  // move; each is named, as their list is an empty box they hang outside of.
  const above = [
    ...(scope
      ? document.querySelectorAll<HTMLElement>('[data-slide-above]')
      : []),
    ...document.querySelectorAll<HTMLElement>('[data-sonner-toast]'),
  ];
  if (scope) scope.style.viewTransitionName = SCOPE;
  above.forEach((el, i) => (el.style.viewTransitionName = `slide-above-${i}`));
  root.dataset.slide = back ? 'back' : 'open';
  root.dataset.slideScope = scope ? 'page' : 'root';
  const transition = document.startViewTransition(() => flushSync(go));
  active = transition;
  const old = `::view-transition-old(${name})`;
  const next = `::view-transition-new(${name})`;
  const animations: Animation[] = [];
  transition.ready
    .then(() => {
      animations.push(
        root.animate(
          {
            transform: back
              ? ['none', 'translateX(100%)']
              : ['translateX(100%)', 'none'],
          },
          { ...SLIDE, pseudoElement: back ? old : next }
        ),
        root.animate(
          {
            transform: back ? [UNDER_SHIFT, 'none'] : ['none', UNDER_SHIFT],
            opacity: back ? [UNDER_OPACITY, 1] : [1, UNDER_OPACITY],
          },
          { ...SLIDE, pseudoElement: back ? next : old }
        )
      );
    })
    .catch(() => undefined);
  void transition.finished.finally(() => {
    active = null;
    // Held frames would otherwise land on the next slide's same-named parts.
    for (const animation of animations) animation.cancel();
    delete root.dataset.slide;
    delete root.dataset.slideScope;
    if (scope) scope.style.viewTransitionName = '';
    for (const el of above) el.style.viewTransitionName = '';
  });
}

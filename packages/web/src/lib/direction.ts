/** Whether the page is laid out right to left. */
export const pageRtl = () => document.documentElement.dir === 'rtl';

/**
 * How far `el` starts from the start of `box`, its offset parent: from the
 * right, right to left.
 */
export const startOf = (el: HTMLElement, box: HTMLElement) =>
  pageRtl() ? box.clientWidth - el.offsetLeft - el.offsetWidth : el.offsetLeft;

/** How far a scroller is from its start, whichever way it runs. */
export const scrolled = (el: HTMLElement) => Math.abs(el.scrollLeft);

export const scrollToStart = (el: HTMLElement, at: number) => {
  el.scrollLeft = pageRtl() ? -at : at;
};

import React from 'react';

/** Outlasts index.html's exit animations. */
const EXIT_MS = 750;

export function endSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.ending !== undefined) return;
  splash.dataset.ending = '';
  const root = document.getElementById('root');
  if (root) root.dataset.arriving = '';
  setTimeout(() => {
    splash.remove();
    if (root) delete root.dataset.arriving;
  }, EXIT_MS);
}

export function SplashEnd(): null {
  React.useEffect(endSplash, []);
  return null;
}

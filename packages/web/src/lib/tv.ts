import { currentHost } from './hosts';

/**
 * A TV lays the page out at 1280 x 720 whatever its resolution, a size read
 * from across a room, which also gives it the wide layout.
 */
export function setupTv(): void {
  if (!currentHost().tv) return;
  document.documentElement.dataset.tv = '';
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', 'width=1280, viewport-fit=cover');
}


import { currentHost } from './hosts';
import { isTextField } from './input/focus';

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
  keyboardOnSelect();
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const asField = (target: EventTarget | null): Field | null =>
  (target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement) &&
  isTextField(target)
    ? target
    : null;

/**
 * Android TV opens the keyboard as soon as a field takes focus, and the
 * keyboard then takes the remote. A field stays read-only until Select, which
 * the WebView only hands the page for a field it can't type in.
 */
function keyboardOnSelect(): void {
  const waiting = new WeakSet<Field>();
  let opening: Field | null = null;
  const release = (field: Field) => {
    if (!waiting.delete(field)) return;
    field.readOnly = false;
  };
  document.addEventListener('focusin', (e) => {
    const field = asField(e.target);
    if (!field || field === opening || field.readOnly) return;
    field.readOnly = true;
    waiting.add(field);
  });
  document.addEventListener(
    'keydown',
    (e) => {
      const field = asField(e.target);
      if (e.key !== 'Enter' || !field || !waiting.has(field)) return;
      // In an open list's filter, Enter picks the highlighted option.
      if (field.getAttribute('aria-expanded') === 'true') return;
      e.preventDefault();
      e.stopPropagation();
      release(field);
      // Focus again on an editable field opens the keyboard.
      opening = field;
      field.blur();
      field.focus();
      opening = null;
    },
    true
  );
  document.addEventListener('focusout', (e) => {
    const field = asField(e.target);
    if (field) release(field);
  });
}

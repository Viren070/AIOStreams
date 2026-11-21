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
  // webOS opens its keyboard on Select, and a read-only field never gets that.
  if (currentHost().name !== 'webos') keyboardOnSelect();
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const asField = (target: EventTarget | null): Field | null =>
  (target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement) &&
  isTextField(target)
    ? target
    : null;

const highlighted = (field: Field) =>
  !!document
    .getElementById(field.getAttribute('aria-controls') ?? '')
    ?.querySelector('[aria-selected="true"]');

/**
 * Android TV opens the keyboard as soon as a field takes focus, and the
 * keyboard then takes the remote. A field stays read-only until Select, which
 * the WebView only hands the page for a field it can't type in.
 */
function keyboardOnSelect(): void {
  const waiting = new WeakSet<Field>();
  let opening: Field | null = null;
  const hold = (field: Field) => {
    field.readOnly = true;
    waiting.add(field);
  };
  const release = (field: Field) => {
    if (!waiting.delete(field)) return;
    field.readOnly = false;
  };
  document.addEventListener('focusin', (e) => {
    const field = asField(e.target);
    if (!field || field === opening || field.readOnly) return;
    hold(field);
  });
  document.addEventListener(
    'keydown',
    (e) => {
      const field = asField(e.target);
      if (!field) return;
      // Moving through an open list's options leaves Select to pick one.
      if (
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
        field.getAttribute('aria-expanded') === 'true' &&
        !field.readOnly
      )
        hold(field);
      if (e.key !== 'Enter') return;
      // In an open list's filter, Enter picks the highlighted option; with none, it types.
      if (field.getAttribute('aria-expanded') === 'true' && highlighted(field))
        return;
      if (!waiting.has(field)) {
        // The keyboard's own Enter puts it away, leaving the field read-only.
        if (field instanceof HTMLInputElement) {
          field.blur();
          field.focus();
        }
        return;
      }
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

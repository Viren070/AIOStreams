function toSubmit(root: Element): void {
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>('button[type=button]'),
  ];
  if (root instanceof HTMLButtonElement && root.type === 'button')
    buttons.push(root);
  for (const button of buttons) if (!button.form) button.type = 'submit';
}

/**
 * Once the page has had a press or tap, Android's Chromium walks up to 50
 * focusable elements each way from a focused form control, looking for the
 * keyboard's next field, which a TV feels on every move. A submit button ends
 * the walk, and outside a form it acts as any other button.
 */
export function startSubmitButtons(): () => void {
  if (!/Android/.test(navigator.userAgent)) return () => {};
  toSubmit(document.body);
  const observer = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes)
        if (node instanceof Element) toSubmit(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

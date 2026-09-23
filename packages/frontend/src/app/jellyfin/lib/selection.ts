/** A click that ends a text selection is not a tap. */
export function hasSelection(): boolean {
  return !!window.getSelection()?.toString();
}

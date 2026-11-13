/**
 * Leading tags providers put on channel names to sort them: `UK | BBC One`,
 * `|UK| BBC One`, `|| UK || BBC One` and `[UK] BBC One`. Each is short, so a
 * name that merely holds a bar later on is left as it is.
 */
const TAG =
  /^\s*(?:\|{1,2}\s*[^|\][]{1,12}?\s*\|{1,2}|[A-Za-z0-9 ]{1,6}\|(?!\|)|\[[^\][]{1,12}\])\s*/;

/** A channel's name without its leading tag, and with spaces tidied. */
export function cleanName(name: string): string {
  const cleaned = name.replace(TAG, '').replace(/\s+/g, ' ').trim();
  // A name that is only a tag keeps it, as an empty one is not a channel.
  return cleaned || name;
}

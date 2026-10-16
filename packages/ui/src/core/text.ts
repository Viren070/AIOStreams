/**
 * What the components say themselves: English until an app sets its own
 * language's words with `setUiText`.
 */
export const uiText = {
  previous: 'Previous',
  next: 'Next',
  pickColour: 'Pick a colour',
  defaultColour: 'Default',
  white: 'White',
  yellow: 'Yellow',
  cyan: 'Cyan',
  green: 'Green',
  magenta: 'Magenta',
  red: 'Red',
  blue: 'Blue',
  grey: 'Grey',
  black: 'Black',
  unnamed: 'Unnamed',
  select: 'Select',
  areYouSure: 'Are you sure you want to continue?',
  confirm: 'Confirm',
  cancel: 'Cancel',
  oops: 'Oops!',
  retry: 'Retry',
  dialog: 'Dialog',
  drawer: 'Drawer',
  openMenu: 'Open main menu',
  donateTitle: 'Support AIOStreams',
  donateHeading: 'Donate to Me',
  donateBody:
    'AIOStreams is a solo project built and maintained by me in my free time. If you find it useful, please consider supporting my work. Your donation helps me keep the project alive and improve it for everyone!',
};

export function setUiText(text: typeof uiText): void {
  Object.assign(uiText, text);
}

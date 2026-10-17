import { i18n, type Messages } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { setFormatLocale } from '@aiostreams/ui/core/format';
import { setUiText, type uiText } from '@aiostreams/ui/core/text';
import { messages as sourceMessages } from '../locales/en-GB.po';
import { onSettingsChange, settings, signedIn } from './settings';
import { storage } from './storage';

/** The language the app is written in. */
export const SOURCE_LOCALE = 'en-GB';

/** Test languages: longer accented text, and the same laid out right to left. */
export const PSEUDO_LOCALES = ['en-XA', 'ar-XB'];

// Each catalog loads on its own when chosen; English is in the bundle.
const catalogs = import.meta.webpackContext('../locales', {
  regExp: /\.po$/,
  recursive: false,
  mode: 'lazy',
  chunkName: 'locale-[request]',
});

/** Every language with a catalog, the test ones included. */
export const LOCALES = [
  ...new Set(
    catalogs
      .keys()
      .filter((key) => key.startsWith('./'))
      .map((key) => key.slice(2, -'.po'.length))
  ),
];

const RTL = new Set([
  'ar',
  'ckb',
  'dv',
  'fa',
  'he',
  'ks',
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
]);

const languageOf = (tag: string) => tag.split('-')[0].toLowerCase();

export const isRtl = (locale: string) => RTL.has(languageOf(locale));

/** The catalog for a language tag: its own, else one in the same language. */
function catalogFor(tag: string): string | undefined {
  const real = LOCALES.filter((l) => !PSEUDO_LOCALES.includes(l));
  const lower = tag.toLowerCase();
  return (
    real.find((l) => l.toLowerCase() === lower) ??
    real.find((l) => l.toLowerCase() === languageOf(tag)) ??
    real.find((l) => languageOf(l) === languageOf(tag))
  );
}

function systemTags(): readonly string[] {
  return navigator.languages?.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
}

/** The system's language, among those the app has. */
export function systemLocale(): string {
  for (const tag of systemTags()) {
    const found = catalogFor(tag);
    if (found) return found;
  }
  return SOURCE_LOCALE;
}

/** A language's name in itself, as a list of languages shows it. */
export function localeName(locale: string): string {
  // Test languages, which only development builds list.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (locale === 'en-XA') return 'Pseudo (accented)';
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (locale === 'ar-XB') return 'Pseudo (right to left)';
  const name =
    new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** `auto`, or a language that has no catalog any more, follows the system. */
export function chosenLocale(choice: string): string {
  return LOCALES.includes(choice) ? choice : systemLocale();
}

let formatTag = SOURCE_LOCALE;

/**
 * What dates and numbers are written in: the system's own region where it
 * speaks the app's language, so British English still shows US dates in the US.
 */
export function formatLocale(): string {
  return formatTag;
}

function formatTagFor(locale: string): string {
  const language = languageOf(locale);
  return systemTags().find((tag) => languageOf(tag) === language) ?? locale;
}

/** What the shared components say themselves. */
const uiWords = (): typeof uiText => ({
  previous: t`Previous`,
  next: t`Next`,
  pickColour: t`Pick a colour`,
  defaultColour: t({ comment: 'No colour of its own', message: 'Default' }),
  white: t`White`,
  yellow: t`Yellow`,
  cyan: t`Cyan`,
  green: t`Green`,
  magenta: t`Magenta`,
  red: t`Red`,
  blue: t`Blue`,
  grey: t`Grey`,
  black: t`Black`,
  unnamed: t`Unnamed`,
  select: t`Select`,
  areYouSure: t`Are you sure you want to continue?`,
  confirm: t`Confirm`,
  cancel: t`Cancel`,
  oops: t`Oops!`,
  retry: t`Retry`,
  dialog: t`Dialog`,
  drawer: t`Drawer`,
  openMenu: t`Open main menu`,
  donateTitle: t`Support AIOStreams`,
  donateHeading: t`Donate to Me`,
  donateBody: t`AIOStreams is a solo project built and maintained by me in my free time. If you find it useful, please consider supporting my work. Your donation helps me keep the project alive and improve it for everyone!`,
});

let latest: string | undefined;

export async function activate(requested: string): Promise<void> {
  latest = requested;
  let locale = requested;
  let messages: Messages = sourceMessages;
  if (locale !== SOURCE_LOCALE) {
    try {
      ({ messages } = (await catalogs(`./${locale}.po`)) as {
        messages: Messages;
      });
    } catch {
      locale = SOURCE_LOCALE;
    }
  }
  // Another language was chosen while this one loaded.
  if (latest !== requested) return;
  formatTag = formatTagFor(locale);
  setFormatLocale(formatTag);
  i18n.loadAndActivate({ locale, messages });
  setUiText(uiWords());
  const html = document.documentElement;
  html.lang = locale;
  html.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

const LAST_LANGUAGE = 'aiostreams-web-last-language';

/**
 * The signed-in user's choice, or with nobody signed in the one this device
 * last showed, so the next start opens in it before the user's settings load.
 */
function choice(): string {
  const last = storage.get<string>(LAST_LANGUAGE) ?? 'auto';
  if (!signedIn()) return last;
  const mine = settings.interface.language.read();
  if (mine !== last) {
    if (mine === 'auto') storage.remove(LAST_LANGUAGE);
    else storage.set(LAST_LANGUAGE, mine);
  }
  return mine;
}

/** Activates the chosen language, and follows changes to it or to the system's. */
export async function startI18n(): Promise<void> {
  const follow = () => {
    const next = chosenLocale(choice());
    if (next !== i18n.locale) void activate(next);
  };
  await activate(chosenLocale(choice()));
  onSettingsChange(follow);
  window.addEventListener('languagechange', follow);
}
